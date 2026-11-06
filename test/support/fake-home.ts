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
const changesOf = (paths: string[]) => Object.fromEntries(paths.map((p) => [p, { type: 'update' }]));

export const cx = {
  meta: (id: string, cwd: string, at: number) => ({ timestamp: iso(at), type: 'session_meta', payload: { id, cwd, timestamp: iso(at) } }),
  user: (text: string, at: number) => item(at, { type: 'UserMessage', content: [{ type: 'text', text }] }),
  say: (text: string, at: number) => item(at, { type: 'AgentMessage', content: [{ type: 'text', text }], phase: 'final_answer' }),
  run: (command: string, exitCode: number, output: string, at: number) => item(at, { type: 'CommandExecution', command, exit_code: exitCode, status: exitCode === 0 ? 'completed' : 'failed', aggregated_output: output }),
  change: (paths: string[], at: number) => item(at, { type: 'FileChange', changes: changesOf(paths), status: 'completed' }),
  started: (at: number) => ev(at, { type: 'task_started', turn_id: 't' }),
  done: (at: number) => ev(at, { type: 'task_complete', turn_id: 't', last_agent_message: null }),
  legacyUser: (text: string, at: number) => ev(at, { type: 'user_message', message: text }),
  legacySay: (text: string, at: number) => ev(at, { type: 'agent_message', message: text }),
  legacyRun: (command: string[], exitCode: number, output: string, at: number) => ev(at, { type: 'exec_command_end', command, exit_code: exitCode, aggregated_output: output }),
  legacyAbort: (at: number) => ev(at, { type: 'turn_aborted', reason: 'interrupted' }),
  // A patch in an older file: patch_apply_end, with the keys the real ones have (checked 2026-11-05). It names its files.
  legacyPatch: (paths: string[], success: boolean, at: number) => ev(at, { type: 'patch_apply_end', call_id: 'p1', turn_id: 't', stdout: success ? 'Success.' : '', stderr: success ? '' : 'Failed.', success, status: success ? 'completed' : 'failed', changes: changesOf(paths) }),
  // Real rollouts have no patch_apply_begin, so these two are the shape the fallback expects, not one seen on disk:
  // the begin names the files, and an end without its own `changes` says how the patch with the same call_id went.
  legacyBegin: (paths: string[], callId: string, at: number) => ev(at, { type: 'patch_apply_begin', call_id: callId, turn_id: 't', auto_approved: true, changes: changesOf(paths) }),
  legacyEnd: (callId: string, success: boolean, at: number) => ev(at, { type: 'patch_apply_end', call_id: callId, turn_id: 't', stdout: '', stderr: '', success }),
  // An error event, in either format.
  error: (message: string, at: number) => ev(at, { type: 'error', message, codex_error_info: 'other' }),
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

// ---- Gemini CLI: <gemini>/tmp/<project folder>/chats/session-<YYYY-MM-DDTHH-MM>-<first 8 of the id>.json
// The project's path is in <gemini>/tmp/<project folder>/.project_root. A chat is one JSON document that the CLI
// rewrites whole as the conversation goes on, with every message in `messages`. The message and tool-call shapes
// follow the plan's description of the format; they have not been checked against a real chat file.

export const gm = {
  user: (text: string, at: number) => ({ id: `m${at}`, timestamp: iso(at), type: 'user', content: [{ text }] }),
  say: (text: string, at: number, toolCalls?: object[]) => ({ id: `g${at}`, timestamp: iso(at), type: 'gemini', content: text, ...(toolCalls ? { toolCalls } : {}) }),
  call: (name: string, args: object, status: 'success' | 'error' | 'cancelled', at: number) => ({ id: `c${at}`, name, args, status, timestamp: iso(at), result: [] }),
  info: (text: string, at: number) => ({ id: `i${at}`, timestamp: iso(at), type: 'info', content: text }),
};

// The project folder is named after the last segment of `projectRoot`, so two roots that end alike share a folder.
// The chat file is named by the first message's time, in UTC so the name doesn't depend on the machine's time zone;
// two chats that start in the same minute need ids that differ in their first 8 characters. The file's mtime is
// `mtimeMs`, or else the newest timestamp. Returns the chat file's path.
export function writeGeminiSession(h: FakeHome, o: { id: string; projectRoot: string; messages: object[]; mtimeMs?: number }): string {
  const times = o.messages.map(timestampOf).filter((t): t is number => t !== undefined && !Number.isNaN(t));
  const newest = times.length > 0 ? Math.max(...times) : undefined;
  const mtime = o.mtimeMs ?? newest;
  const startTime = iso(times[0] ?? mtime ?? 0);

  const dir = path.join(h.gemini, 'tmp', path.basename(o.projectRoot));
  fs.mkdirSync(path.join(dir, 'chats'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.project_root'), o.projectRoot);

  const chat = { sessionId: o.id, projectHash: 'test', startTime, lastUpdated: iso(newest ?? mtime ?? 0), kind: 'main', messages: o.messages };
  const file = path.join(dir, 'chats', `session-${startTime.slice(0, 16).replace(':', '-')}-${o.id.slice(0, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify(chat, null, 2));
  if (mtime !== undefined) fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
}
