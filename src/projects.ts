import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Project { key: string; name: string }

const WORKTREES = '/.git/worktrees/'; // git writes forward slashes in the pointer file on every platform
const cache = new Map<string, Project>();

const realpath = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p; // the folder is gone (a removed worktree), so the recorded path stays
  }
};

// The repo root `dir` belongs to, if it has a `.git`, else null.
function rootAt(dir: string): string | null {
  const git = path.join(dir, '.git');
  let isFolder: boolean;
  try {
    isFolder = fs.statSync(git).isDirectory();
  } catch {
    return null; // no .git here
  }
  if (isFolder) return dir;
  // A worktree's .git file points into the main repo: `gitdir: <main>/.git/worktrees/<name>` (relative if git was told so).
  let text = '';
  try {
    text = fs.readFileSync(git, 'utf8');
  } catch {
    // unreadable: treated like any other .git file
  }
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1] ?? '';
  const at = pointer.indexOf(WORKTREES);
  return at >= 0 ? path.resolve(dir, pointer.slice(0, at)) : dir; // any other .git file (a submodule) is its own project
}

export function projectFor(cwd: string): Project {
  let project = cache.get(cwd);
  if (!project) {
    let key = cwd;
    for (let dir = cwd; ; dir = path.dirname(dir)) {
      const root = rootAt(dir);
      if (root !== null) { key = root; break; }
      if (path.dirname(dir) === dir) break;
    }
    key = realpath(key);
    project = { key, name: path.basename(key) };
    cache.set(cwd, project);
  }
  return project;
}
