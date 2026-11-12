import * as path from 'node:path';
import { classify } from './classify';
import type { Change, Todo } from './git';
import { projectFor, realpath, type Project } from './projects';
import { seenKey } from './seen';
import { oneLine } from './text';
import type { PermissionRequest, Session, Status, Tool } from './types';

export interface Row {
  tool: Tool; sessionId: string; title: string; status: Status; detail: string; summary?: string;
  asked?: string;    // your latest prompt, when the title doesn't already say it
  at: number; project: Project; cwd: string; branch?: string;
  files: string[];   // files this session edited, relative to its cwd (else absolute with ~), ≤ 5
  resume: string;    // exact command to jump back in
  longText: string;  // source text for an AI one-liner; never printed
  file?: string;     // the session's history file, for its recap page; never printed
}
export interface NextStep { label: string; command: string }
export interface CatchUp {
  now: number; awayMs: number | null; warnings: string[];
  sessions: number;  // how many sessions were considered, moved or not (0 means brb found none)
  here: { project: Project; branch: string | null; rows: Row[]; you: { changes: Change[]; todos: Todo[] } | null } | null;
  elsewhere: Row[];
  next: NextStep[];
}
export interface CatchUpInput {
  now: number; cwd: string; home: string;
  sessions: Session[];
  permissions: Map<string, PermissionRequest>;   // keyed by Claude session id
  seen?: Map<string, number>;                    // when you last picked each session, keyed by seenKey
  git: { root: string; branch: string | null; yours: Change[]; todos: Todo[] } | null;  // HERE only; yours already excludes agent edits
  excludeSessionId?: string; sinceMs?: number; warnings: string[];
}

export const TOOL_NAME: Record<Tool, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', kiro: 'Kiro' };

const FIRST_RUN_MS = 8 * 60 * 60_000;
const MAX_FILES = 5;
const MAX_NEXT = 3;
const ASKED_MAX = 300;
const ORDER: Status[] = ['waiting', 'finished', 'failed', 'working', 'idle'];
// Session text ends up in commands people paste into a shell: quote what isn't plainly safe. A leading ~/ stays outside the quotes so it still expands.
const quote = (s: string): string => (/^[A-Za-z0-9._/~@+-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);
const quotePath = (p: string): string => (p.startsWith('~/') ? `~/${quote(p.slice(2))}` : quote(p));

const RESUME: Record<Tool, (id: string) => string> = {
  claude: (id) => `claude --resume ${quote(id)}`,
  codex: (id) => `codex resume ${quote(id)}`,
  gemini: (id) => `gemini --resume ${quote(id)}`,
  kiro: () => 'kiro .', // Kiro is an IDE: this opens the project, not the chat itself
};

const inside = (dir: string, p: string): boolean => p.startsWith(dir + path.sep);
const tilde = (p: string, home: string): string => (p === home || inside(home, p) ? `~${p.slice(home.length)}` : p);

// Newest edit first. A path is relative inside the session's folder, else absolute with the home folder as ~.
function editedFiles(s: Session, home: string): string[] {
  const newestFirst = [...s.events].reverse().flatMap((e) => (e.kind === 'edit' ? e.files : []));
  return [...new Set(newestFirst)]
    .slice(0, MAX_FILES)
    .map((file) => (inside(s.cwd, file) ? file.slice(s.cwd.length + 1) : tilde(file, home)));
}

// Your latest prompt, cut to one line. Nothing for a session with one prompt: its title already says what you asked.
// Nothing either when the reader skipped part of the last turn, since the prompt that started it wasn't read.
function latestAsk(s: Session): string | undefined {
  if (s.partialTurn) return undefined;
  const prompts = s.events.filter((e) => e.kind === 'user');
  const asked = prompts.length > 1 ? oneLine(prompts.at(-1)!.text, ASKED_MAX) : '';
  return asked === '' || asked === s.title ? undefined : asked;
}

// Real paths, so they match the files git reports even through a symlinked folder.
export function agentEditedFiles(sessions: Session[], projectKey: string): Set<string> {
  const files = new Set<string>();
  for (const s of sessions) {
    if (projectFor(s.cwd).key !== projectKey) continue;
    for (const e of s.events) if (e.kind === 'edit') e.files.forEach((file) => files.add(file));
  }
  return new Set([...files].map(realpath));
}

const byStatus = (a: Row, b: Row): number => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.at - a.at;

export function buildCatchUp(input: CatchUpInput): CatchUp {
  const { now, home, git } = input;
  const sessions = input.sessions.filter((s) => s.id !== input.excludeSessionId);
  const hereProject = projectFor(input.cwd);

  // Your last message per project. The window is per project, and not "since the last commit" because agents commit as you.
  // Not your uncommitted edits either: shell-command edits by agents land in "yours" too.
  const lastSeen = new Map<string, number>();
  const see = (key: string, at: number) => { if (at > (lastSeen.get(key) ?? -Infinity)) lastSeen.set(key, at); };
  for (const s of sessions) for (const e of s.events) if (e.kind === 'user') see(projectFor(s.cwd).key, e.at);
  const lastUserAnywhere = lastSeen.size > 0 ? Math.max(...lastSeen.values()) : undefined;

  const windowStart = (key: string): number => (input.sinceMs !== undefined ? now - input.sinceMs : (lastSeen.get(key) ?? now - FIRST_RUN_MS));
  const seenHere = lastSeen.get(hereProject.key) ?? lastUserAnywhere;
  const awayMs = input.sinceMs !== undefined || seenHere === undefined ? null : now - seenHere;

  const hereFolders = new Set([input.cwd, ...(git ? [git.root] : [])].map(realpath));
  const resumeFor = (s: Session): string =>
    (hereFolders.has(realpath(s.cwd)) ? '' : `cd ${quotePath(tilde(s.cwd, home))} && `) + RESUME[s.tool](s.id);

  const rows = sessions
    .flatMap((s): Row[] => {
      const project = projectFor(s.cwd);
      const verdict = classify(s, now, input.permissions.get(s.id));
      // A waiting session stays listed however old it is; the rest only if they moved since you were last here
      // and since you last picked them. --since asks for everything in that time, picked or not.
      const pickedAt = input.sinceMs === undefined ? (input.seen?.get(seenKey(s.tool, s.id)) ?? -Infinity) : -Infinity;
      if (verdict.status !== 'waiting' && s.lastActivityAt <= Math.max(windowStart(project.key), pickedAt)) return [];
      return [{
        tool: s.tool, sessionId: s.id, title: s.title, status: verdict.status, detail: verdict.detail, asked: latestAsk(s),
        at: s.lastActivityAt, project, cwd: s.cwd, branch: s.branch,
        files: editedFiles(s, home), resume: resumeFor(s), longText: verdict.longText, file: s.file,
      }];
    })
    .sort(byStatus);
  const hereRows = rows.filter((r) => r.project.key === hereProject.key);
  const elsewhere = rows.filter((r) => r.project.key !== hereProject.key);

  const branch = git?.branch ?? null;
  const you = git && git.yours.length > 0 ? { changes: git.yours, todos: git.todos } : null;
  const here = hereRows.length === 0 && !you ? null : { project: hereProject, branch, rows: hereRows, you };

  const next: NextStep[] = [
    ...[...hereRows, ...elsewhere].filter((r) => r.status === 'waiting').map((r) => ({ label: `answer ${TOOL_NAME[r.tool]}`, command: r.resume })),
    ...hereRows.filter((r) => r.status === 'failed').map((r) => ({ label: 'see what broke', command: r.resume })),
    ...hereRows
      .filter((r) => r.status === 'finished' && r.branch !== undefined && branch !== null && r.branch !== branch)
      .map((r) => ({ label: `review "${oneLine(r.title, 24)}"`, command: `git diff ${quote(branch!)}...${quote(r.branch!)}` })),
    ...(you?.todos[0] ? [{ label: 'pick up your TODO', command: `${you.todos[0].file}:${you.todos[0].line}` }] : []),
  ].slice(0, MAX_NEXT);

  return { now, awayMs, warnings: input.warnings, sessions: sessions.length, here, elsewhere, next };
}
