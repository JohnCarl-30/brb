import { dirname, isAbsolute, join, resolve } from 'node:path';
import { oneLine } from '../text';
import type { Session, SessionEvent } from '../types';
import { ERROR_MAX, OUTPUT_KEEP_CHARS, TITLE_MAX, isBackgroundCwd, parseJsonLines, readHeadTail, readText, recentFiles, str } from './files';
import type { RecentFile } from './files';

// A Kiro session is a folder, <kiro>/sessions/<workspace hash>/<session id>/, holding session.json (id, title, the
// workspace folder) and messages.jsonl, one `{ id, timestamp, payload: { type, ... } }` per line. A tool's call and
// its result are two lines that share a toolCallId. The shapes were count-checked on 2026-11-09 against the owner's
// sessions (field names and short labels only, no content read).

// The tools that run a shell command. Their call holds `args.command`, their result `success` and the output.
const COMMAND_TOOLS = new Set(['execute_bash', 'runCommand', 'executeBash']);
// Kiro labels every call with a kind; these change files.
const EDIT_KINDS = new Set(['edit', 'delete', 'move']);
// How turn_end says the turn stopped short. `end_turn` is a normal end.
const INTERRUPTED = new Set(['cancelled', 'aborted']);

interface Call { toolName?: string; kind?: string; args: Record<string, any>; filePath?: string }

interface Transcript {
  cwd: string;
  events: SessionEvent[];
  calls: Map<string, Call>;
  // Questions and permission prompts not answered yet, by tool call id.
  pending: Map<string, { at: number; text: string }>;
  humanPromptInTail: boolean;
}

const isRecord = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The files a call names, made absolute from the workspace. A move names both ends.
function filesOf(call: Call, cwd: string): string[] {
  const a = call.args;
  const named = [call.filePath, a.path, a.file, a.targetFile, a.sourcePath, a.destinationPath].map(str).filter((f): f is string => f !== undefined);
  return [...new Set(named.map((f) => resolve(cwd, f)))].filter(isAbsolute);
}

function addResult(t: Transcript, p: Record<string, any>, at: number): void {
  const call = t.calls.get(p.toolCallId);
  if (call === undefined) return; // its call was in the part of the file that was skipped
  const command = str(call.args.command);
  if (COMMAND_TOOLS.has(call.toolName ?? '') && command?.trim()) {
    const output = typeof p.content === 'string' ? p.content : '';
    t.events.push({ kind: 'command', at, command, ok: p.success === true, output: output.slice(-OUTPUT_KEEP_CHARS) });
  } else if (EDIT_KINDS.has(call.kind ?? '') && p.success === true) {
    const files = filesOf(call, t.cwd);
    if (files.length > 0) t.events.push({ kind: 'edit', at, files });
  }
}

function addLine(t: Transcript, line: any, inTail: boolean): void {
  const p = line.payload;
  const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
  if (!isRecord(p) || Number.isNaN(at)) return;
  const text = typeof p.content === 'string' ? p.content : '';
  switch (p.type) {
    case 'user':
      if (text.trim() !== '') t.events.push({ kind: 'user', at, text });
      if (inTail) t.humanPromptInTail = true;
      break;
    case 'assistant': // Reasoning and Summary messages aren't shown to the human
      if (p.operationType === 'Say' && text.trim() !== '') t.events.push({ kind: 'agent', at, text });
      break;
    case 'tool_call':
      if (typeof p.toolCallId === 'string') {
        t.calls.set(p.toolCallId, { toolName: str(p.toolName), kind: str(p.kind), args: isRecord(p.args) ? p.args : {}, filePath: str(p.filePath) });
      }
      break;
    case 'tool_result':
      addResult(t, p, at);
      break;
    case 'pending_interaction': // a permission prompt (tool_approval) or a question (user_input)
      if (typeof p.toolCallId === 'string') t.pending.set(p.toolCallId, { at, text: oneLine(str(p.question) ?? 'needs your approval', ERROR_MAX) });
      break;
    case 'interaction_resolved':
      t.pending.delete(p.toolCallId);
      break;
    case 'turn_end':
      t.pending.clear(); // an ended turn asks nothing any more
      if (p.stopReason === 'end_turn') t.events.push({ kind: 'turn-end', at });
      else t.events.push({ kind: 'error', at, text: INTERRUPTED.has(p.stopReason) ? 'interrupted' : 'Kiro stopped with an error' });
      break;
  }
}

// `whole` reads every line, for a recap; the list reads only the head and tail.
export async function readSession(file: RecentFile, whole = false): Promise<Session | null> {
  const meta = await readText(join(dirname(file.path), 'session.json'));
  let info: any;
  try {
    info = JSON.parse(meta ?? '');
  } catch {
    return null; // no session.json yet, or one being rewritten right now
  }
  // A session started outside any workspace (Kiro's _global folder) has no folder to show it under.
  const cwd = str(info?.workspacePaths?.[0]) ?? str(info?.rootPaths?.[0]);
  const id = str(info?.id);
  if (cwd === undefined || id === undefined || isBackgroundCwd(cwd)) return null;

  const { lines, tailStart } = whole
    ? { lines: ((await readText(file.path)) ?? '').split('\n'), tailStart: null }
    : await readHeadTail(file.path);
  const t: Transcript = { cwd, events: [], calls: new Map(), pending: new Map(), humanPromptInTail: false };
  const headLines = tailStart === null ? lines : lines.slice(0, tailStart);
  for (const line of parseJsonLines(headLines)) addLine(t, line, false);
  if (tailStart !== null) for (const line of parseJsonLines(lines.slice(tailStart))) addLine(t, line, true);
  for (const { at, text } of t.pending.values()) t.events.push({ kind: 'ask', at, reason: 'question', text });
  t.events.sort((a, b) => a.at - b.at); // stable, so events with the same time keep the order they were written in

  const firstPrompt = t.events.find((e) => e.kind === 'user');
  const session: Session = {
    tool: 'kiro',
    id,
    cwd,
    title: oneLine(str(info.title) ?? (firstPrompt?.kind === 'user' ? firstPrompt.text : ''), TITLE_MAX) || 'untitled session',
    events: t.events,
    lastActivityAt: t.events.at(-1)?.at ?? file.mtimeMs,
    file: file.path,
  };
  // Without a human prompt in the tail, the last turn began in the part that was skipped.
  if (tailStart !== null && !t.humanPromptInTail) session.partialTurn = true;
  return session;
}

// `root` is the Kiro folder (~/.kiro). `o.now` is unused here: every adapter takes the same options.
export async function readKiroSessions(root: string, o: { now: number; sinceMs: number }): Promise<Session[]> {
  const files = await recentFiles(join(root, 'sessions'), /^messages\.jsonl$/, o.sinceMs, 3);
  const sessions = await Promise.all(files.map((file) => readSession(file)));
  return sessions.filter((s): s is Session => s !== null);
}
