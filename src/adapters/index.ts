import * as os from 'node:os';
import * as path from 'node:path';
import type { Session } from '../types';
import { readClaudeSessions } from './claude';
import { readCodexSessions } from './codex';
import { SCAN_MS } from './files';
import { readGeminiSessions } from './gemini';

export interface Roots { claude: string; codex: string; gemini: string; brb: string }

export function resolveRoots(env: NodeJS.ProcessEnv): Roots {
  const home = env.HOME ?? os.homedir();
  return {
    claude: env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude'),
    codex: env.CODEX_HOME ?? path.join(home, '.codex'),
    gemini: path.join(home, '.gemini'), // Gemini CLI has no env override
    brb: env.BRB_HOME ?? path.join(home, '.brb'),
  };
}

const TOOLS = [
  { label: 'Claude Code', read: readClaudeSessions, root: (r: Roots) => r.claude },
  { label: 'Codex', read: readCodexSessions, root: (r: Roots) => r.codex },
  { label: 'Gemini CLI', read: readGeminiSessions, root: (r: Roots) => r.gemini },
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
