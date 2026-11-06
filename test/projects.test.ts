import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { projectFor } from '../src/projects';

// realpath, because the tmp folder is a symlink on macOS (/var -> /private/var) and project keys are real paths.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brb-projects-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('groups a worktree with its main repo', () => {
  fs.mkdirSync(path.join(tmp, 'main', '.git'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'wt', 'feature'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'wt', 'feature', '.git'), `gitdir: ${tmp}/main/.git/worktrees/feature\n`);
  expect(projectFor(path.join(tmp, 'wt', 'feature'))).toEqual({ key: path.join(tmp, 'main'), name: 'main' });
});

test('uses the repo root for a subfolder', () => {
  fs.mkdirSync(path.join(tmp, 'main', '.git'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'main', 'src', 'lib'), { recursive: true });
  expect(projectFor(path.join(tmp, 'main', 'src', 'lib')).key).toBe(path.join(tmp, 'main'));
});

test('falls back to the recorded path when the folder is gone', () => {
  expect(projectFor('/nonexistent/old-worktree')).toEqual({ key: '/nonexistent/old-worktree', name: 'old-worktree' });
});

test('a .git file that is not a worktree pointer is its own project', () => {
  fs.mkdirSync(path.join(tmp, 'outer', 'sub', 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'outer', 'sub', '.git'), `gitdir: ${tmp}/outer/.git/modules/sub\n`);
  expect(projectFor(path.join(tmp, 'outer', 'sub', 'src')).key).toBe(path.join(tmp, 'outer', 'sub'));
});
