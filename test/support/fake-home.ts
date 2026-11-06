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

// ---- Codex CLI: <codex>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl, with thread names in <codex>/session_index.jsonl
// Two formats share this layout. Current files wrap each finished thing in an `item_completed` event;
// older ones have one event type per kind of thing (`user_message`, `exec_command_end`, ...).

const item = (at: number, it: object) => ({ timestamp: iso(at), type: 'event_msg', payload: { type: 'item_completed', item: it } });
const ev = (at: number, payload: object) => ({ timestamp: iso(at), type: 'event_msg', payload });

export const cx = {
  meta: (id: string, cwd: string, at: number) => ({ timestamp: iso(at), type: 'session_meta', payload: { id, cwd, timestamp: iso(at) } }),
  user: (text: string, at: number) => item(at, { type: 'UserMessage', content: [{ type: 'text', text }] }),
  say: (text: string, at: number) => item(at, { type: 'AgentMessage', content: [{ type: 'text', text }], phase: 'final_answer' }),
  run: (command: string, exitCode: number, output: string, at: number) => item(at, { type: 'CommandExecution', command, exit_code: exitCode, status: exitCode === 0 ? 'completed' : 'failed', aggregated_output: output }),
  change: (paths: string[], at: number) => item(at, { type: 'FileChange', changes: Object.fromEntries(paths.map((p) => [p, { type: 'update' }])), status: 'completed' }),
  started: (at: number) => ev(at, { type: 'task_started', turn_id: 't' }),
  done: (at: number) => ev(at, { type: 'task_complete', turn_id: 't', last_agent_message: null }),
  legacyUser: (text: string, at: number) => ev(at, { type: 'user_message', message: text }),
  legacySay: (text: string, at: number) => ev(at, { type: 'agent_message', message: text }),
  legacyRun: (command: string[], exitCode: number, output: string, at: number) => ev(at, { type: 'exec_command_end', command, exit_code: exitCode, aggregated_output: output }),
  legacyAbort: (at: number) => ev(at, { type: 'turn_aborted', reason: 'interrupted' }),
};

// The file is named and filed by the first line's time, in UTC so the path doesn't depend on the machine's time zone.
// `threadName` adds a line for the session to the index. The file's mtime is `mtimeMs`, or else the newest timestamp.
// Returns the file path.
export function writeCodexSession(h: FakeHome, o: { id: string; lines: object[]; threadName?: string; mtimeMs?: number }): string {
  const times = o.lines.map(timestampOf).filter((t): t is number => t !== undefined && !Number.isNaN(t));
  const mtime = o.mtimeMs ?? (times.length > 0 ? Math.max(...times) : undefined);

  const [date, time] = iso(times[0] ?? mtime ?? 0).slice(0, 19).split('T');
  const dir = path.join(h.codex, 'sessions', ...date.split('-'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-${date}T${time.replace(/:/g, '-')}-${o.id}.jsonl`);
  fs.writeFileSync(file, o.lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  if (mtime !== undefined) fs.utimesSync(file, new Date(mtime), new Date(mtime));

  if (o.threadName !== undefined) {
    const entry = { id: o.id, thread_name: o.threadName, updated_at: iso(mtime ?? 0) };
    fs.appendFileSync(path.join(h.codex, 'session_index.jsonl'), JSON.stringify(entry) + '\n');
  }
  return file;
}
