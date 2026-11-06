import { basename, isAbsolute, join, resolve } from 'node:path';
import { oneLine } from '../text';
import type { Session, SessionEvent } from '../types';
import { ERROR_MAX, OUTPUT_KEEP_CHARS, TITLE_MAX, isSummaryCwd, parseJsonLines, readText, recentFiles, str, textOf } from './files';
import type { RecentFile } from './files';

// A rollout is named rollout-<time>-<session id>.jsonl, and the id is a UUID.
const ID_IN_FILE_NAME = /([0-9a-f-]{36})\.jsonl$/;
// The kinds of item_completed that become events here. Items of other kinds (Plan, ...) don't count as the file saying
// these things: real older files hold Plan items next to legacy events, and those events are all they say.
const READ_ITEMS = new Set(['UserMessage', 'AgentMessage', 'CommandExecution', 'FileChange']);
// A patch or file change with one of these statuses changed nothing.
const NOT_APPLIED = new Set(['failed', 'declined']);

// Everything gathered from one file's lines.
interface Transcript {
  events: SessionEvent[];
  id?: string;
  cwd?: string;
  // Whether the file holds item_completed items of the kinds above. Then it says everything the legacy events
  // (see addLegacy) say, so those are not read, and nothing counts twice.
  hasItems: boolean;
  // The files of each patch_apply_begin by its call id, for a patch_apply_end that doesn't name its own.
  begun: Map<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isReadItem = (line: any): boolean => line.type === 'event_msg' && line.payload?.type === 'item_completed' && READ_ITEMS.has(line.payload.item?.type);

// Whether a patch took effect. A FileChange item says `status` and an older patch_apply_end says `success` (newer ones
// say both). A patch that failed or was declined changed nothing; a field that is missing doesn't count against it.
const applied = (source: Record<string, any>): boolean => source.success !== false && !NOT_APPLIED.has(source.status);

// A command is a string, or the words of one.
function commandText(command: unknown): string {
  if (typeof command === 'string') return command;
  return Array.isArray(command) ? command.filter((word) => typeof word === 'string').join(' ') : '';
}

function addSaid(t: Transcript, kind: 'user' | 'agent', text: string, at: number): void {
  if (text.trim() !== '') t.events.push({ kind, at, text });
}

// `source` is a CommandExecution item or an exec_command_end event: they name these fields alike.
function addCommand(t: Transcript, source: Record<string, any>, at: number): void {
  const command = commandText(source.command);
  if (command.trim() === '') return;
  const output = typeof source.aggregated_output === 'string' ? source.aggregated_output : '';
  t.events.push({ kind: 'command', at, command, ok: source.exit_code === 0, output: output.slice(-OUTPUT_KEEP_CHARS) });
}

// The keys of `changes` are the files. They are made absolute from the folder the turn ran in; while no folder is
// known yet, only the ones that already are absolute can be kept.
function addEdit(t: Transcript, changes: unknown, at: number): void {
  if (!isRecord(changes)) return;
  const files = Object.keys(changes).map((file) => (t.cwd === undefined ? file : resolve(t.cwd, file))).filter(isAbsolute);
  if (files.length > 0) t.events.push({ kind: 'edit', at, files });
}

// A patch in an older file is its patch_apply_end. It names its files or, when it doesn't, they are the ones the
// patch_apply_begin with the same call id named. Every end in real files names its own and none has a begin (checked
// 2026-11-05), so the fallback is for versions not seen.
function addPatch(t: Transcript, end: Record<string, any>, at: number): void {
  if (!applied(end)) return;
  const own = isRecord(end.changes) && Object.keys(end.changes).length > 0;
  const begun = typeof end.call_id === 'string' ? t.begun.get(end.call_id) : undefined;
  addEdit(t, own ? end.changes : begun, at);
}

function addItem(t: Transcript, item: unknown, at: number): void {
  if (!isRecord(item)) return;
  if (item.type === 'UserMessage') addSaid(t, 'user', textOf(item.content), at);
  else if (item.type === 'AgentMessage') addSaid(t, 'agent', textOf(item.content), at);
  else if (item.type === 'CommandExecution') addCommand(t, item, at);
  else if (item.type === 'FileChange' && applied(item)) addEdit(t, item.changes, at);
}

// What older files say with an event of its own, where current ones use the items above.
function addLegacy(t: Transcript, payload: Record<string, any>, at: number): void {
  if (payload.type === 'user_message') addSaid(t, 'user', textOf(payload.message), at);
  else if (payload.type === 'agent_message') addSaid(t, 'agent', textOf(payload.message), at);
  else if (payload.type === 'exec_command_end') addCommand(t, payload, at);
  else if (payload.type === 'patch_apply_begin') {
    const callId = str(payload.call_id);
    if (callId !== undefined) t.begun.set(callId, payload.changes);
  } else if (payload.type === 'patch_apply_end') addPatch(t, payload, at);
}

function addLine(t: Transcript, line: any): void {
  const payload = line.payload;
  if (!isRecord(payload)) return;

  // A file can hold more than one session_meta (a forked session carries its parent's), and the first is its own.
  if (line.type === 'session_meta') t.id ??= str(payload.id);
  if (line.type === 'session_meta' || line.type === 'turn_context') t.cwd = str(payload.cwd) ?? t.cwd;
  if (line.type !== 'event_msg') return;

  const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
  if (Number.isNaN(at)) return;
  // The end of a turn, an interrupt and an error read the same in both formats. The rest is items or legacy events.
  if (payload.type === 'item_completed') addItem(t, payload.item, at);
  else if (payload.type === 'task_complete') t.events.push({ kind: 'turn-end', at });
  else if (payload.type === 'turn_aborted') t.events.push({ kind: 'error', at, text: 'interrupted' });
  else if (payload.type === 'error') t.events.push({ kind: 'error', at, text: oneLine(typeof payload.message === 'string' ? payload.message : '', ERROR_MAX) || 'error' });
  else if (!t.hasItems) addLegacy(t, payload, at);
}

// The latest thread name of each session in Codex's index. Older versions have no index, so a missing one names nothing.
// A name that is empty once cleaned names nothing either, so it never replaces a good one.
async function readTitles(file: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (const line of parseJsonLines(((await readText(file)) ?? '').split('\n'))) {
    const id = str(line.id);
    const name = oneLine(typeof line.thread_name === 'string' ? line.thread_name : '', TITLE_MAX);
    if (id !== undefined && name !== '') titles.set(id, name);
  }
  return titles;
}

// The thread name, else the first prompt that says anything.
function titleOf(t: Transcript, threadName: string | undefined): string {
  const firstPrompt = t.events.find((e) => e.kind === 'user');
  return threadName ?? (oneLine(firstPrompt?.kind === 'user' ? firstPrompt.text : '', TITLE_MAX) || 'untitled session');
}

// A rollout is read whole, since Codex's are small, so the session never has a partial last turn.
async function readSession(file: RecentFile, titles: Map<string, string>): Promise<Session | null> {
  const text = await readText(file.path);
  if (text === null) return null; // removed since it was listed
  const lines = parseJsonLines(text.split('\n'));
  const t: Transcript = { events: [], hasItems: lines.some(isReadItem), begun: new Map() };
  for (const line of lines) addLine(t, line);

  // The id in the file name is the session's own. The first session_meta is the fallback: a file can hold more than one.
  const id = ID_IN_FILE_NAME.exec(basename(file.path))?.[1] ?? t.id;
  if (id === undefined || t.cwd === undefined || isSummaryCwd(t.cwd)) return null;
  t.events.sort((a, b) => a.at - b.at); // stable, so events with the same time keep the order they were written in

  return {
    tool: 'codex',
    id,
    cwd: t.cwd,
    title: titleOf(t, titles.get(id)),
    events: t.events,
    lastActivityAt: t.events.at(-1)?.at ?? file.mtimeMs,
  };
}

// `root` is the Codex folder (~/.codex). `o.now` is unused here: every adapter takes the same options.
export async function readCodexSessions(root: string, o: { now: number; sinceMs: number }): Promise<Session[]> {
  const [files, titles] = await Promise.all([
    recentFiles(join(root, 'sessions'), /^rollout-.*\.jsonl$/, o.sinceMs, 4),
    readTitles(join(root, 'session_index.jsonl')),
  ]);
  const sessions = await Promise.all(files.map((file) => readSession(file, titles)));
  return sessions.filter((s): s is Session => s !== null);
}
