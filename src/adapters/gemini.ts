import { join, resolve } from 'node:path';
import { oneLine } from '../text';
import type { Session, SessionEvent } from '../types';
import { ERROR_MAX, OUTPUT_KEEP_CHARS, TITLE_MAX,isSummaryCwd, listFolder, readText, recentFiles, str, textOf } from './files';
import type { RecentFile } from './files';

// The tools that write a file. A call to one that succeeded is an edit.
const EDIT_TOOLS = new Set(['replace', 'write_file', 'edit']);

const timeOf = (stamp: unknown): number => (typeof stamp === 'string' ? Date.parse(stamp) : NaN);

// Lines Gemini adds around what a shell command printed. `Exit Code` is there only for a non-zero exit.
const SHELL_META = /^(Exit Code|Process Group PGID|Background PIDs): /;
const EXIT_CODE = /^Exit Code: (-?\d+)$/m;

// What a shell call's result says: the output and error strings of every part, without Gemini's own lines, and whether
// one of them gave a non-zero exit code. The call's status stays `success` on a non-zero exit, so only the text tells.
function readShellResult(result: unknown): { exitFailed: boolean; output: string } {
  const texts: string[] = [];
  let exitFailed = false;
  for (const part of Array.isArray(result) ? result : []) {
    const response = part?.functionResponse?.response;
    for (const [key, value] of [['output', str(response?.output)], ['error', str(response?.error)]] as const) {
      if (value === undefined) continue;
      const code = EXIT_CODE.exec(value)?.[1];
      if (code !== undefined && Number(code) !== 0) exitFailed = true;
      let text = value.split('\n').filter((line) => !SHELL_META.test(line)).join('\n');
      if (key === 'output') text = text.replace(/^Output: /, ''); // Gemini's label, once, in front of the output
      if (text !== '' && text !== '(empty)') texts.push(text); // `(empty)` is Gemini's word for a command that printed nothing
    }
  }
  return { exitFailed, output: texts.join('\n').slice(-OUTPUT_KEEP_CHARS) };
}

// A cancelled call is an error whatever the tool, so a cancelled command is never a failed command. Past that, an edit
// counts only when the call succeeded and a command says whether it did. A relative file is made absolute from the
// project folder.
function addToolCall(events: SessionEvent[], call: any, cwd: string, messageAt: number): void {
  const name = str(call?.name);
  if (name === undefined) return;
  // The call's own time is when it finished, after its message was written. A call that gives none takes its message's.
  const finishedAt = timeOf(call.timestamp);
  const at = Number.isNaN(finishedAt) ? messageAt : finishedAt;
  if (call.status === 'cancelled') {
    events.push({ kind: 'error', at, text: `${name} was cancelled` });
  } else if (name === 'run_shell_command') {
    const command = str(call.args?.command);
    if (command?.trim()) {
      const { exitFailed, output } = readShellResult(call.result);
      events.push({ kind: 'command', at, command, ok: call.status === 'success' && !exitFailed, output });
    }
  } else if (EDIT_TOOLS.has(name) && call.status === 'success') {
    const file = str(call.args?.file_path);
    if (file) events.push({ kind: 'edit', at, files: [resolve(cwd, file)] });
  }
}

// What the human typed, what the agent did and said, and an error the CLI recorded become events; the other kinds of
// message (info and warning notices) don't. A gemini message's tool calls come first, then its words, then the end of
// the turn when it asked for no tool.
function addMessage(events: SessionEvent[], message: any, cwd: string): void {
  const at = timeOf(message?.timestamp);
  if (Number.isNaN(at)) return;
  if (message.type === 'user') {
    const text = textOf(message.content);
    if (text.trim() !== '') events.push({ kind: 'user', at, text });
  } else if (message.type === 'gemini') {
    const calls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
    for (const call of calls) addToolCall(events, call, cwd, at);
    const text = textOf(message.content);
    if (text.trim() !== '') events.push({ kind: 'agent', at, text });
    if (calls.length === 0) events.push({ kind: 'turn-end', at });
  } else if (message.type === 'error') {
    events.push({ kind: 'error', at, text: oneLine(textOf(message.content), ERROR_MAX) || 'error' });
  }
}

// A chat is read whole, since it is one JSON document, so the session never has a partial last turn.
async function readSession(file: RecentFile, cwd: string): Promise<Session | null> {
  const text = await readText(file.path);
  if (text === null) return null; // removed since it was listed
  let chat: any;
  try {
    chat = JSON.parse(text);
  } catch {
    return null; // not JSON: a chat that is being rewritten right now, or not a chat at all
  }
  const id = str(chat?.sessionId);
  if (id === undefined) return null;
  const events: SessionEvent[] = [];
  for (const message of Array.isArray(chat.messages) ? chat.messages : []) addMessage(events, message, cwd);
  events.sort((a, b) => a.at - b.at); // stable, so events with the same time keep the order they were written in

  const firstPrompt = events.find((e) => e.kind === 'user');
  return {
    tool: 'gemini',
    id,
    cwd,
    title: oneLine(firstPrompt?.kind === 'user' ? firstPrompt.text : '', TITLE_MAX) || 'untitled session',
    events,
    lastActivityAt: events.at(-1)?.at ?? file.mtimeMs,
  };
}

// A project folder holds its chats, and in `.project_root` the folder the project lives in.
async function readProject(folder: string, sinceMs: number): Promise<Session[]> {
  const files = await recentFiles(join(folder, 'chats'), /^session-.*\.json$/, sinceMs, 1);
  if (files.length === 0) return []; // nothing recent, so there is no need to ask where the project lives
  const cwd = (await readText(join(folder, '.project_root')))?.trim();
  if (!cwd || isSummaryCwd(cwd)) return []; // a project that never said where it lives, or one of brb's own summary runs
  const sessions = await Promise.all(files.map((file) => readSession(file, cwd)));
  return sessions.filter((s): s is Session => s !== null);
}

// `root` is the Gemini folder (~/.gemini). `o.now` is unused here: every adapter takes the same options.
export async function readGeminiSessions(root: string, o: { now: number; sinceMs: number }): Promise<Session[]> {
  const tmp = join(root, 'tmp');
  const folders = (await listFolder(tmp)).filter((entry) => entry.isDirectory());
  const sessions = await Promise.all(folders.map((entry) => readProject(join(tmp, entry.name), o.sinceMs)));
  return sessions.flat();
}
