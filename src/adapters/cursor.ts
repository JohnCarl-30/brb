import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { oneLine } from '../text';
import type { Session, SessionEvent } from '../types';
import { ERROR_MAX, TITLE_MAX, isBackgroundCwd, isMissing, listFolder, parseJsonLines, readHeadTail, readText, recentFiles, str, textOf } from './files';
import type { RecentFile } from './files';

// Cursor's app and its CLI both keep a transcript of every agent chat, as
// <cursor>/projects/<project folder>/agent-transcripts/<chat id>/<chat id>.jsonl (older ones sit one level up, as
// <chat id>.jsonl). A line is { role: 'user' | 'assistant', message: { content } }, where the content holds `text`
// blocks and `tool_use` blocks ({ name, input }), or a control line such as { type: 'turn_ended', status }.
// The transcript is thin: no line has a time, a tool call has no result, and newer files have no turn_ended line.
// The shapes are from the Cursor CLI's own writer (2026.11.22) and from transcripts people have posted. They were
// not checked against a live Cursor.

// The tools that change a file, and the input fields that name it.
const EDIT_TOOLS = new Set(['Write', 'StrReplace', 'Delete', 'EditNotebook', 'MultiEdit', 'Edit']);
const FILE_FIELDS = ['path', 'file_path', 'target_notebook', 'target_file'];
// The tools that stop and wait for the human. CreatePlan is from Cursor's plan mode and is in no sample seen so far.
const QUESTION_TOOL = 'AskQuestion';
const PLAN_TOOL = 'CreatePlan';

// A prompt starts with the minute it was sent: <timestamp>Thursday, Jul 23, 2026, 11:20 PM (UTC+2)</timestamp>.
// About one transcript in five has none.
const STAMP = /<timestamp>([\s\S]*?)<\/timestamp>/;
const STAMP_PARTS = /([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\s*\(UTC(?:([+-])(\d{1,2})(?::?(\d{2}))?)?\)/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// What the human typed sits inside this tag, after the stamp.
const QUERY = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/;

function promptTime(text: string): number | undefined {
  const m = STAMP_PARTS.exec(STAMP.exec(text)?.[1] ?? '');
  const month = MONTHS.indexOf(m?.[1].toLowerCase() ?? '');
  if (!m || month === -1) return undefined;
  const hour = m[7] ? (Number(m[4]) % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0) : Number(m[4]);
  const offsetMinutes = (m[8] === '-' ? -1 : 1) * (Number(m[9] ?? 0) * 60 + Number(m[10] ?? 0));
  const at = Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0)) - offsetMinutes * 60_000;
  return Number.isNaN(at) ? undefined : at;
}

function promptText(text: string): string {
  const rest = text.replace(STAMP, '');
  return (QUERY.exec(rest)?.[1] ?? rest.replace(/<\/?user_query>/g, '')).trim();
}

// Cursor writes the model's thinking into the same text block, and `[REDACTED]` where the provider withheld it.
const saidText = (text: string): string => text.split('\n').filter((line) => line.trim() !== '[REDACTED]').join('\n').trim();

interface Transcript {
  cwd: string;
  events: SessionEvent[];
  clock: number | undefined;  // the time of the newest prompt read so far
  started: number;            // when the file was made: the time of a first prompt that has no stamp
  changed: number;            // when the file last changed
  ask: SessionEvent | undefined; // a question or plan in the newest line, which nothing has followed yet
  humanPromptInTail: boolean;
}

function addToolUse(t: Transcript, block: any, at: number): void {
  const name = str(block?.name);
  const input = typeof block?.input === 'object' && block.input !== null ? block.input : {};
  if (name === undefined) return;
  if (name === 'Shell') {
    const command = str(input.command);
    // The transcript never says how a command ended, so none of them reads as failed.
    if (command?.trim()) t.events.push({ kind: 'command', at, command, ok: true, output: '' });
  } else if (EDIT_TOOLS.has(name)) {
    const file = FILE_FIELDS.map((field) => str(input[field])).find((f) => f !== undefined);
    if (file) t.events.push({ kind: 'edit', at, files: [resolve(t.cwd, file)] });
  } else if (name === QUESTION_TOOL) {
    const question = str(input.questions?.[0]?.prompt) ?? str(input.title) ?? 'has a question for you';
    t.ask = { kind: 'ask', at, reason: 'question', text: oneLine(question, ERROR_MAX) };
  } else if (name === PLAN_TOOL) {
    t.ask = { kind: 'ask', at, reason: 'plan', text: '' };
  }
}

// A line has no time of its own, so it takes its prompt's: a prompt's stamp when it has one, else the time before it.
// The lines of the last turn are given the file's time afterwards, since the file changes as they are written.
function addLine(t: Transcript, line: any, inTail: boolean): void {
  t.ask = undefined; // whatever the line before asked, this line came after it
  if (line.type === 'turn_ended') {
    const at = t.clock ?? t.started;
    if (line.status === 'success') {
      if (t.events.at(-1)?.kind !== 'turn-end') t.events.push({ kind: 'turn-end', at });
    } else if (line.status === 'aborted') {
      t.events.push({ kind: 'error', at, text: 'interrupted' });
    } else if (line.status === 'error') {
      t.events.push({ kind: 'error', at, text: oneLine(str(line.error) ?? '', ERROR_MAX) || 'Cursor stopped with an error' });
    }
    return;
  }
  const blocks: any[] = Array.isArray(line.message?.content) ? line.message.content : [];
  const text = textOf(blocks.filter((b) => b?.type === 'text'));
  if (line.role === 'user') {
    const stamped = promptTime(text);
    // Never past the file's own time, and never back before an earlier prompt.
    t.clock = stamped === undefined ? (t.clock ?? t.started) : Math.min(t.changed, Math.max(t.clock ?? -Infinity, stamped));
    const asked = promptText(text);
    if (asked !== '') t.events.push({ kind: 'user', at: t.clock, text: asked });
    if (inTail) t.humanPromptInTail = true;
  } else if (line.role === 'assistant') {
    const at = t.clock ?? t.started;
    const said = saidText(text);
    if (said !== '') t.events.push({ kind: 'agent', at, text: said });
    const calls = blocks.filter((b) => b?.type === 'tool_use');
    for (const call of calls) addToolUse(t, call, at);
    // A step that calls no tool is the last of its turn, which is all a newer file says about a turn ending.
    if (said !== '' && calls.length === 0) t.events.push({ kind: 'turn-end', at });
  }
}

// `whole` reads every line, for a recap; the list reads only the head and tail. The file's times are read here and
// not taken from `file`, so a recap, which is handed no time, dates the last turn the same way.
export async function readSession(file: RecentFile, cwd: string, whole = false): Promise<Session | null> {
  let times;
  try {
    times = await stat(file.path);
  } catch (error) {
    if (isMissing(error)) return null; // removed since it was listed
    throw error;
  }
  const changed = times.mtimeMs;
  const started = times.birthtimeMs > 0 && times.birthtimeMs <= changed ? times.birthtimeMs : changed;

  const { lines, tailStart } = whole
    ? { lines: ((await readText(file.path)) ?? '').split('\n'), tailStart: null }
    : await readHeadTail(file.path);
  const t: Transcript = { cwd, events: [], clock: undefined, started, changed, ask: undefined, humanPromptInTail: false };
  const headLines = tailStart === null ? lines : lines.slice(0, tailStart);
  for (const line of parseJsonLines(headLines)) addLine(t, line, false);
  if (tailStart !== null) for (const line of parseJsonLines(lines.slice(tailStart))) addLine(t, line, true);
  if (t.ask) t.events.push(t.ask);
  const lastPrompt = t.events.map((e) => e.kind).lastIndexOf('user');
  for (const event of t.events.slice(lastPrompt + 1)) event.at = changed;

  const firstPrompt = t.events.find((e) => e.kind === 'user');
  const session: Session = {
    tool: 'cursor',
    id: basename(file.path, '.jsonl'),
    cwd,
    title: oneLine(firstPrompt?.kind === 'user' ? firstPrompt.text : '', TITLE_MAX) || 'untitled session',
    events: t.events,
    lastActivityAt: changed,
    file: file.path,
  };
  // Without a human prompt in the tail, the last turn began in the part that was skipped.
  if (tailStart !== null && !t.humanPromptInTail) session.partialTurn = true;
  return session;
}

// Cursor names a project's folder after its path with every run of other characters turned into one dash:
// /Users/me/my-app is Users-me-my-app. That can't be undone by reading it, so the folder is found by walking the
// disk for a path that would get the same name. Longer names are tried first, so my-app wins over my/app.
// shortcut: the walk starts at /, so a Windows path (C-Users-me-app) is never found. Start from the drive if that ever matters.
const slugOf = (name: string): string => name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');

async function findFolder(dir: string, slug: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return undefined; // not a folder, or one we may not read
  }
  const fits = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => ({ path: join(dir, entry.name), part: slugOf(entry.name) }))
    .filter(({ part }) => part !== '' && (slug === part || slug.startsWith(`${part}-`)))
    .sort((a, b) => b.part.length - a.part.length);
  for (const { path, part } of fits) {
    if (slug !== part) {
      const found = await findFolder(path, slug.slice(part.length + 1));
      if (found) return found;
    } else if ((await stat(path).catch(() => null))?.isDirectory()) {
      return path;
    }
  }
  return undefined;
}

// Where a project lives. The CLI writes the path down when you trust a folder; the app writes nothing, so its
// projects are found from the folder's name.
async function workspaceOf(project: string): Promise<string | undefined> {
  try {
    const trusted = str(JSON.parse((await readText(join(project, '.workspace-trusted'))) ?? '')?.workspacePath);
    if (trusted && isAbsolute(trusted)) return trusted;
  } catch {
    // no marker, or one that isn't JSON
  }
  return findFolder('/', basename(project));
}

// The ids of the chats the CLI can resume: it keeps one folder per chat, <chats>/<hash of the project path>/<chat id>.
async function cliChatIds(chats: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const project of await listFolder(chats).catch(() => [])) {
    if (!project.isDirectory()) continue;
    for (const chat of await listFolder(join(chats, project.name)).catch(() => [])) ids.add(chat.name);
  }
  return ids;
}

async function readProject(project: string, sinceMs: number, cliChats: () => Promise<Set<string>>): Promise<Session[]> {
  const folder = join(project, 'agent-transcripts');
  // <chat id>.jsonl, or <chat id>/<chat id>.jsonl. A subagent's transcript sits in a `subagents` folder, which is never walked.
  const files = (await recentFiles(folder, /\.jsonl$/, sinceMs, 2))
    .filter((file) => dirname(file.path) === folder || basename(dirname(file.path)) === basename(file.path, '.jsonl'));
  if (files.length === 0) return []; // nothing recent, so there is no need to find where the project lives
  const cwd = await workspaceOf(project);
  if (cwd === undefined || isBackgroundCwd(cwd)) return []; // a folder that is gone, or one of brb's own summary runs
  const resumable = await cliChats();
  const newest = new Map<string, Session>();
  for (const s of await Promise.all(files.map((file) => readSession(file, cwd)))) {
    if (s === null || s.lastActivityAt < (newest.get(s.id)?.lastActivityAt ?? -Infinity)) continue; // both layouts hold the chat: the newer file is it
    if (!resumable.has(s.id)) s.ide = true;
    newest.set(s.id, s);
  }
  return [...newest.values()];
}

// `root` is Cursor's folder (~/.cursor) and `chats` is where its CLI keeps the chats it can resume. `o.now` is
// unused here: every adapter takes the same options.
export async function readCursorSessions(root: string, chats: string, o: { now: number; sinceMs: number }): Promise<Session[]> {
  const projects = (await listFolder(join(root, 'projects'))).filter((entry) => entry.isDirectory());
  let ids: Promise<Set<string>> | undefined;
  const cliChats = (): Promise<Set<string>> => (ids ??= cliChatIds(chats)); // listed once, and only when a chat is recent
  const sessions = await Promise.all(projects.map((entry) => readProject(join(root, 'projects', entry.name), o.sinceMs, cliChats)));
  return sessions.flat();
}
