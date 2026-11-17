import * as os from 'node:os';
import * as path from 'node:path';
import { loadAllSessions, resolveRoots } from './adapters';
import { boardConfig, readBoard, type Fetch } from './board';
import { agentEditedFiles, buildCatchUp, FIRST_RUN_MS, type CatchUp } from './catchup';
import { addedTodos, readGit } from './git';
import { hooksHaveRun, readPermissionRequests } from './pending';
import { projectFor, realpath } from './projects';
import { readSeen } from './seen';

export async function computeCatchUp(o: { env: NodeJS.ProcessEnv; cwd: string; now: number; excludeSessionId?: string; sinceMs?: number; skipGit?: boolean; board?: boolean; fetch?: Fetch }): Promise<CatchUp> {
  const roots = resolveRoots(o.env);
  const { sessions, warnings } = await loadAllSessions(roots, o.now);

  const snapshot = o.skipGit ? null : readGit(o.cwd);
  let git = null;
  if (snapshot) {
    // "You" is what git shows minus what an agent edited, so a file an agent touched isn't blamed on you.
    const agent = agentEditedFiles(sessions, projectFor(o.cwd).key);
    const yours = snapshot.changes.filter((c) => !agent.has(realpath(path.resolve(snapshot.root, c.file))));
    git = { root: snapshot.root, branch: snapshot.branch, yours, todos: addedTodos(snapshot.root, yours.map((c) => c.file)) };
  }

  const c = buildCatchUp({
    now: o.now, cwd: o.cwd, home: o.env.HOME ?? os.homedir(), sessions, permissions: readPermissionRequests(roots.brb, o.now), seen: readSeen(roots.brb), hooksOff: !hooksHaveRun(roots.brb), git,
    excludeSessionId: o.excludeSessionId, sinceMs: o.sinceMs, warnings,
  });
  const config = o.board ? boardConfig(o.env) : null;
  if (config && 'error' in config) c.warnings.push(`OpenCrawl board: ${config.error}`);
  else if (config) {
    // The same window as the sessions: --since, else since you last typed a prompt here, else the first-run look-back.
    const since = o.sinceMs !== undefined ? o.now - o.sinceMs : o.now - (c.awayMs ?? FIRST_RUN_MS);
    const { board, warning } = await readBoard({ config, since, fetch: o.fetch });
    if (board) c.board = board;
    if (warning) c.warnings.push(warning);
  }
  return c;
}
