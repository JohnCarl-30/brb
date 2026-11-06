import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { oneLine } from '../text';
import type { Session, SessionEvent } from '../types';
import { isSummaryCwd, parseJsonLines, recentFiles } from './files';
import type { RecentFile } from './files';

const TITLE_MAX = 60;
// errorLine is linear in the output and classify only reads its end, so a huge build log is never kept whole.
const OUTPUT_KEEP_CHARS = 4_000;
// A rollout is named rollout-<time>-<session id>.jsonl, and the id is a UUID.
const ID_IN_FILE_NAME = /([0-9a-f-]{36})\.jsonl$/;

// Everything gathered from one file's lines.
interface Transcript {
  events: SessionEvent[];
  id?: string;
  cwd?: string;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const isRecord = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

// A file's text, or null when it does not exist (it was removed since it was listed). Any other error throws.
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

// A string as it is, or the text of every block that has some, joined with newlines. Other blocks (images) add nothing.
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => typeof block?.text === 'string').map((block) => block.text).join('\n');
}

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

function addItem(t: Transcript, item: unknown, at: number): void {
  if (!isRecord(item)) return;
  if (item.type === 'UserMessage') addSaid(t, 'user', textOf(item.content), at);
  else if (item.type === 'AgentMessage') addSaid(t, 'agent', textOf(item.content), at);
  else if (item.type === 'CommandExecution') addCommand(t, item, at);
  else if (item.type === 'FileChange') addEdit(t, item.changes, at);
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
  // Current files wrap each finished thing in item_completed. Older ones have an event type for each.
  if (payload.type === 'item_completed') addItem(t, payload.item, at);
  else if (payload.type === 'user_message') addSaid(t, 'user', textOf(payload.message), at);
  else if (payload.type === 'agent_message') addSaid(t, 'agent', textOf(payload.message), at);
  else if (payload.type === 'exec_command_end') addCommand(t, payload, at);
  else if (payload.type === 'task_complete') t.events.push({ kind: 'turn-end', at });
  else if (payload.type === 'turn_aborted') t.events.push({ kind: 'error', at, text: 'interrupted' });
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
  const t: Transcript = { events: [] };
  for (const line of parseJsonLines(text.split('\n'))) addLine(t, line);

  const id = t.id ?? ID_IN_FILE_NAME.exec(basename(file.path))?.[1];
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
