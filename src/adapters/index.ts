import * as os from 'node:os';
import * as path from 'node:path';
import type { Session, Tool } from '../types';
import { readClaudeSessions, readSession as readClaude } from './claude';
import { readCodexSessions, readSession as readCodex } from './codex';
import { readCursorSessions, readSession as readCursor } from './cursor';
import { SCAN_MS } from './files';
import { readGeminiSessions, readSession as readGemini } from './gemini';
import { readKiroSessions, readSession as readKiro } from './kiro';

export interface Roots { claude: string; codex: string; gemini: string; kiro: string; cursor: string; cursorChats: string; brb: string }

// A variable that is set but blank counts as unset, as it does for Cursor.
const set = (value: string | undefined): string | undefined => (value?.trim() ? value : undefined);

export function resolveRoots(env: NodeJS.ProcessEnv): Roots {
  const home = env.HOME ?? os.homedir();
  return {
    claude: env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'),
    codex: env.CODEX_HOME ?? path.join(home, '.codex'),
    gemini: path.join(env.GEMINI_CLI_HOME || home, '.gemini'), // GEMINI_CLI_HOME stands in for the home folder, not for ~/.gemini
    kiro: path.join(home, '.kiro'),
    // Cursor's app and CLI write transcripts under its data folder, and the CLI keeps its chats under its config folder.
    cursor: set(env.CURSOR_DATA_DIR) ?? path.join(home, '.cursor'),
    cursorChats: path.join(set(env.CURSOR_CONFIG_DIR) ?? (set(env.XDG_CONFIG_HOME) ? path.join(env.XDG_CONFIG_HOME!, 'cursor') : path.join(home, '.cursor')), 'chats'),
    brb: env.BRB_HOME ?? path.join(home, '.brb'),
  };
}

type Read = (r: Roots, o: { now: number; sinceMs: number }) => Promise<Session[]>;
const TOOLS: { label: string; read: Read }[] = [
  { label: 'Claude Code', read: (r, o) => readClaudeSessions(r.claude, o) },
  { label: 'Codex', read: (r, o) => readCodexSessions(r.codex, o) },
  { label: 'Gemini CLI', read: (r, o) => readGeminiSessions(r.gemini, o) },
  { label: 'Kiro', read: (r, o) => readKiroSessions(r.kiro, o) },
  { label: 'Cursor', read: (r, o) => readCursorSessions(r.cursor, r.cursorChats, o) },
];

// Adapters throw on anything but a missing folder; one tool failing costs only its own sessions and gives one warning.
export async function loadAllSessions(roots: Roots, now: number): Promise<{ sessions: Session[]; warnings: string[] }> {
  const results = await Promise.allSettled(TOOLS.map((t) => t.read(roots, { now, sinceMs: now - SCAN_MS })));
  const sessions: Session[] = [];
  const warnings: string[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      sessions.push(...result.value);
    } else {
      const err = result.reason;
      warnings.push(`Couldn't read ${TOOLS[i].label} sessions: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return { sessions, warnings };
}

// One session's file read whole, whatever its size, for its recap. `cwd` is where it ran (a Gemini or Cursor chat doesn't say).
// The mtime only matters for a session with no events, which a recap never shows.
export function readSessionFile(tool: Tool, file: string, cwd: string): Promise<Session | null> {
  const recent = { path: file, mtimeMs: 0 };
  if (tool === 'claude') return readClaude(recent, true);
  if (tool === 'codex') return readCodex(recent, new Map());
  if (tool === 'kiro') return readKiro(recent, true);
  if (tool === 'cursor') return readCursor(recent, cwd, true);
  return readGemini(recent, cwd);
}
