import * as os from 'node:os';
import * as path from 'node:path';
import type { Session, Tool } from '../types';
import { readClaudeSessions, readSession as readClaude } from './claude';
import { readCodexSessions, readSession as readCodex } from './codex';
import { SCAN_MS } from './files';
import { readGeminiSessions, readSession as readGemini } from './gemini';
import { readKiroSessions, readSession as readKiro } from './kiro';

export interface Roots { claude: string; codex: string; gemini: string; kiro: string; brb: string }

export function resolveRoots(env: NodeJS.ProcessEnv): Roots {
  const home = env.HOME ?? os.homedir();
  return {
    claude: env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'),
    codex: env.CODEX_HOME ?? path.join(home, '.codex'),
    gemini: path.join(home, '.gemini'), // Gemini CLI has no env override
    kiro: path.join(home, '.kiro'),
    brb: env.BRB_HOME ?? path.join(home, '.brb'),
  };
}

const TOOLS = [
  { label: 'Claude Code', read: readClaudeSessions, root: (r: Roots) => r.claude },
  { label: 'Codex', read: readCodexSessions, root: (r: Roots) => r.codex },
  { label: 'Gemini CLI', read: readGeminiSessions, root: (r: Roots) => r.gemini },
  { label: 'Kiro', read: readKiroSessions, root: (r: Roots) => r.kiro },
];

// Adapters throw on anything but a missing folder; one tool failing costs only its own sessions and gives one warning.
export async function loadAllSessions(roots: Roots, now: number): Promise<{ sessions: Session[]; warnings: string[] }> {
  const results = await Promise.allSettled(TOOLS.map((t) => t.read(t.root(roots), { now, sinceMs: now - SCAN_MS })));
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

// One session's file read whole, whatever its size, for its recap. `cwd` is where it ran (a Gemini chat doesn't say).
// The mtime only matters for a session with no events, which a recap never shows.
export function readSessionFile(tool: Tool, file: string, cwd: string): Promise<Session | null> {
  const recent = { path: file, mtimeMs: 0 };
  if (tool === 'claude') return readClaude(recent, true);
  if (tool === 'codex') return readCodex(recent, new Map());
  if (tool === 'kiro') return readKiro(recent, true);
  return readGemini(recent, cwd);
}
