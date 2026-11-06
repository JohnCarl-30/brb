import * as os from 'node:os';
import * as path from 'node:path';
import { loadAllSessions, resolveRoots } from './adapters';
import { agentEditedFiles, buildCatchUp, type CatchUp } from './catchup';
import { addedTodos, readGit } from './git';
import { readPermissionRequests } from './pending';
import { projectFor, realpath } from './projects';

export async function computeCatchUp(o: { env: NodeJS.ProcessEnv; cwd: string; now: number; excludeSessionId?: string; sinceMs?: number }): Promise<CatchUp> {
  const roots = resolveRoots(o.env);
  const { sessions, warnings } = await loadAllSessions(roots, o.now);

  const snapshot = readGit(o.cwd);
  let git = null;
  if (snapshot) {
    // "You" is what git shows minus what an agent edited, so a file an agent touched isn't blamed on you.
    const agent = agentEditedFiles(sessions, projectFor(o.cwd).key);
    const yours = snapshot.changes.filter((c) => !agent.has(realpath(path.resolve(snapshot.root, c.file))));
    git = { root: snapshot.root, branch: snapshot.branch, yours, todos: addedTodos(snapshot.root, yours.map((c) => c.file)) };
  }

  return buildCatchUp({
    now: o.now, cwd: o.cwd, home: o.env.HOME ?? os.homedir(), sessions, permissions: readPermissionRequests(roots.brb, o.now), git,
    excludeSessionId: o.excludeSessionId, sinceMs: o.sinceMs, warnings,
  });
}
