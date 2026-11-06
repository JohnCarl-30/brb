import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Row } from './catchup';
import { oneLine } from './text';
import type { Tool } from './types';

export type Runner = (bin: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<{ code: number; stdout: string }>;

export const PROMPT = 'Summarize this AI coding session update for its developer in 8 words or fewer. Reply with only the summary.\n\n';

const MAX_JOBS = 8;
const MAX_TEXT = 2000;
const MAX_CACHED = 500;
const TIMEOUT_MS = 30_000;
const SUMMARY_WIDTH = 60;
const QUOTES = /^["'`“”‘’]+|["'`“”‘’]+$/g;

// Each tool answers one non-interactive question. --no-session-persistence and --ephemeral keep brb's own run out of the user's Claude and Codex history.
// The text can hold injected instructions (a failed command's output), so nothing may act on it: no tools, no MCP servers, or read-only.
// Claude's --tools takes a list, so --strict-mcp-config must follow it or the prompt would be read as a tool name.
export function commandFor(tool: Tool, prompt: string): { bin: string; args: string[] } {
  if (tool === 'claude') return { bin: 'claude', args: ['-p', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--strict-mcp-config', prompt] };
  if (tool === 'codex') return { bin: 'codex', args: ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', prompt] };
  return { bin: 'gemini', args: ['-p', prompt, '--approval-mode', 'plan'] };
}

export const summaryKey = (r: Row): string => `${r.tool}:${r.sessionId}:${r.at}`;

// Missing, unreadable or the wrong shape all mean "nothing cached yet".
function readCache(file: string): Record<string, string> {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

function reply(stdout: string): string {
  const last = stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
  return oneLine(last.replace(QUOTES, ''), SUMMARY_WIDTH);
}

// The folder's name is fixed (the adapters skip sessions that ran in it), so on a shared /tmp someone else could plant project
// config in it (hooks, GEMINI.md) that the user's agentic tools would then obey. Only use a folder that is ours and private.
// Never chmod or delete one that brb didn't make: an unsafe folder just means no AI.
function privateFolder(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') return true; // no owner or mode bits to check there
    const st = fs.lstatSync(dir); // lstat, so a symlink is not a directory
    return st.isDirectory() && st.uid === process.getuid!() && (st.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

// Rows come in display order (HERE first). A session's text goes only to the tool it came from, and only if that tool is installed.
export async function summarizeRows(
  rows: Row[],
  o: { brbHome: string; env: NodeJS.ProcessEnv; runner: Runner; which: (bin: string) => boolean; tmpDir?: string },
): Promise<Map<string, string>> {
  const jobs = rows.filter((r) => r.status === 'finished' || r.status === 'failed').slice(0, MAX_JOBS);
  const file = path.join(o.brbHome, 'cache', 'summaries.json');
  const cache = readCache(file);
  const result = new Map<string, string>();
  const fresh: Record<string, string> = {};
  const todo: Row[] = [];
  for (const r of jobs) {
    const hit = cache[summaryKey(r)];
    if (hit !== undefined) result.set(summaryKey(r), hit);
    else if (o.which(commandFor(r.tool, '').bin)) todo.push(r);
  }
  if (todo.length === 0) return result;

  // brb's own runs happen here, where the adapters skip them, with BRB_INTERNAL so the Claude hooks stay silent.
  const cwd = path.join(o.tmpDir ?? os.tmpdir(), 'brb-summaries');
  if (!privateFolder(cwd)) return result;
  const env = { ...o.env, BRB_INTERNAL: '1' };
  await Promise.all(todo.map(async (r) => {
    try {
      const { bin, args } = commandFor(r.tool, PROMPT + r.longText.slice(0, MAX_TEXT));
      const { code, stdout } = await o.runner(bin, args, { cwd, env, timeoutMs: TIMEOUT_MS });
      const line = code === 0 ? reply(stdout) : '';
      if (line !== '') fresh[summaryKey(r)] = line;
    } catch {
      // this session just gets no summary
    }
  }));

  for (const [key, line] of Object.entries(fresh)) result.set(key, line);
  if (Object.keys(fresh).length > 0) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); // private: the cache is digests of the user's work
      // Object keys keep insertion order, so the tail is the newest.
      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries({ ...cache, ...fresh }).slice(-MAX_CACHED))), { mode: 0o600 });
    } catch {
      // the cache is only a speed-up
    }
  }
  return result;
}

export const defaultRunner: Runner = (bin, args, o) =>
  new Promise((resolve) => {
    const child = execFile(bin, args, { cwd: o.cwd, env: o.env, timeout: o.timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      // A non-zero exit has a numeric code. A timeout, a missing program or a full buffer has none, and is a failure too.
      resolve({ code: err === null ? 0 : typeof err.code === 'number' ? err.code : 1, stdout });
    });
    // These tools read piped stdin to the end, so an open pipe would make them wait for input that never comes.
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });

export function onPath(bin: string, env: NodeJS.ProcessEnv): boolean {
  const names = process.platform === 'win32' ? [bin, `${bin}.cmd`, `${bin}.exe`] : [bin];
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue; // an empty entry would mean the current folder
    for (const name of names) {
      try {
        const file = path.join(dir, name);
        if (!fs.statSync(file).isFile()) continue;
        fs.accessSync(file, fs.constants.X_OK);
        return true;
      } catch {
        // not here
      }
    }
  }
  return false;
}
