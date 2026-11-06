// Writes hand-made history files in each tool's on-disk format, under a throwaway home folder.
// One section per tool. The line shapes match the real formats (checked 2026-11-05); no line is copied from a real session.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface FakeHome { home: string; claude: string; codex: string; gemini: string; brb: string }

export function makeFakeHome(): FakeHome {
  // realpath, because the tmp folder is a symlink on macOS (/var -> /private/var) and brb works with real paths.
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'brb-home-'));
  return { home, claude: path.join(home, '.claude'), codex: path.join(home, '.codex'), gemini: path.join(home, '.gemini'), brb: path.join(home, '.brb') };
}

export const iso = (ms: number) => new Date(ms).toISOString();

// ---- Claude Code: <claude>/projects/<cwd with every non-alphanumeric as '-'>/<session id>.jsonl

export const cl = {
  user: (text: string, at: number) => ({ type: 'user', timestamp: iso(at), promptSource: 'sdk', turnOrigin: 'human', message: { role: 'user', content: text } }),
  notice: (text: string, at: number) => ({ type: 'user', timestamp: iso(at), promptSource: 'system', turnOrigin: 'task_notification', message: { role: 'user', content: text } }),
  say: (text: string, at: number, stop: 'end_turn' | 'tool_use' = 'end_turn') => ({ type: 'assistant', timestamp: iso(at), message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: stop } }),
  tool: (id: string, name: string, input: object, at: number) => ({ type: 'assistant', timestamp: iso(at), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' } }),
  result: (id: string, content: string, at: number, isError = false) => ({ type: 'user', timestamp: iso(at), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } }),
  title: (customTitle: string) => ({ type: 'custom-title', customTitle }),
  aiTitle: (aiTitle: string) => ({ type: 'ai-title', aiTitle }), // the title Claude Code writes itself, repeatedly, with no timestamp
  apiError: (at: number) => ({ type: 'system', subtype: 'api_error', timestamp: iso(at) }),
};

const PAD_TEXT = 'x'.repeat(4000);

const timestampOf = (line: object): number | undefined => {
  const stamp = (line as { timestamp?: unknown }).timestamp;
  return typeof stamp === 'string' ? Date.parse(stamp) : undefined;
};

// Every line gets the session's id, folder and branch plus a uuid, unless the line sets its own.
// `sidechain` lists the indexes (into `lines`) that are marked as a side agent's.
// `filler` pads the file with about that many bytes after the first line, to push a session past the read window.
// The file's mtime is `mtimeMs`, or else the newest timestamp. Returns the file path.
export function writeClaudeSession(
  h: FakeHome,
  o: { id: string; cwd: string; branch?: string; lines: object[]; sidechain?: number[]; mtimeMs?: number; filler?: number },
): string {
  const stamp = (line: object, uuid: string, sidechain: boolean): object => ({
    sessionId: o.id, cwd: o.cwd, gitBranch: o.branch ?? 'main', uuid, isSidechain: false,
    ...line,
    ...(sidechain ? { isSidechain: true } : {}),
  });
  const lines = o.lines.map((line, i) => stamp(line, `u${i}`, o.sidechain?.includes(i) ?? false));
  const times = o.lines.map(timestampOf).filter((t): t is number => t !== undefined);

  const pad: object[] = [];
  for (let bytes = 0; bytes < (o.filler ?? 0); ) {
    const line = stamp(cl.result('pad', PAD_TEXT, times[0] ?? 0), `pad${pad.length}`, false);
    pad.push(line);
    bytes += JSON.stringify(line).length + 1;
  }
  lines.splice(1, 0, ...pad);

  const dir = path.join(h.claude, 'projects', o.cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${o.id}.jsonl`);
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');

  const mtime = o.mtimeMs ?? (times.length > 0 ? Math.max(...times) : undefined);
  if (mtime !== undefined) fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
}
