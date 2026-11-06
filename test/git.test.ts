import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { addedTodos, readGit } from '../src/git';

// realpath, because git reports real paths and the tmp folder is a symlink on macOS (/var -> /private/var).
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brb-git-')));
let count = 0;

// The owner's git config, hooks and a repo above the tmp folder must not change what these tests see.
beforeAll(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CEILING_DIRECTORIES', tmp);
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
const write = (dir: string, file: string, text: string) => fs.writeFileSync(path.join(dir, file), text);
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}\n`).join('');

function newRepo(): string {
  const dir = path.join(tmp, `repo${count++}`);
  fs.mkdirSync(dir);
  git(dir, 'init', '-q');
  return dir;
}
function commitAll(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c');
}

test('lists uncommitted and untracked files with line counts', () => {
  const root = newRepo();
  write(root, 'a.ts', 'one\ntwo\n');
  commitAll(root);
  write(root, 'a.ts', 'one\nx\ny\nz\n');
  write(root, 'b.ts', lines(4));

  const snapshot = readGit(root);
  expect(snapshot?.root).toBe(root);
  expect(snapshot?.changes).toMatchObject([
    { file: 'a.ts', added: 3, removed: 1, mtimeMs: expect.any(Number) },
    { file: 'b.ts', added: 4, removed: 0, mtimeMs: expect.any(Number) },
  ]);
});

test('finds TODOs you added, with line numbers', () => {
  const root = newRepo();
  write(root, 'a.ts', lines(9) + '// TODO: old\n' + lines(31));
  commitAll(root);
  fs.appendFileSync(path.join(root, 'a.ts'), '// TODO: reset count after a good login\n');

  expect(addedTodos(root, ['a.ts'])).toEqual([{ file: 'a.ts', line: 42, text: 'reset count after a good login' }]);
});

test('works in a repo with no commits yet', () => {
  const root = newRepo();
  write(root, 'x.ts', 'const a = 1;\n// FIXME: wire this up\n');

  const snapshot = readGit(root);
  expect(snapshot?.branch).toBeNull();
  expect(snapshot?.changes).toMatchObject([{ file: 'x.ts', added: 2, removed: 0 }]);
  expect(addedTodos(root, ['x.ts'])).toEqual([{ file: 'x.ts', line: 2, text: 'wire this up' }]);
});

test('returns null outside a repo', () => {
  const dir = path.join(tmp, 'not-a-repo');
  fs.mkdirSync(dir);
  expect(readGit(dir)).toBeNull();
  expect(readGit(path.join(tmp, 'gone'))).toBeNull();
});

test('reports the branch, and null when HEAD is detached', () => {
  const root = newRepo();
  write(root, 'a.ts', 'one\n');
  commitAll(root);
  git(root, 'switch', '-q', '-c', 'feature/login');
  expect(readGit(root)?.branch).toBe('feature/login');
  git(root, 'checkout', '-q', '--detach');
  expect(readGit(root)?.branch).toBeNull();
});

test('lists a renamed file once, under its new name', () => {
  const root = newRepo();
  write(root, 'old.ts', lines(10));
  commitAll(root);
  git(root, 'mv', 'old.ts', 'new.ts');
  fs.appendFileSync(path.join(root, 'new.ts'), 'extra\n');

  expect(readGit(root)?.changes).toMatchObject([{ file: 'new.ts', added: 1, removed: 0 }]);
});

test('skips deleted files', () => {
  const root = newRepo();
  write(root, 'keep.ts', 'one\n');
  write(root, 'gone.ts', 'one\n');
  commitAll(root);
  fs.rmSync(path.join(root, 'gone.ts'));
  write(root, 'keep.ts', 'one\ntwo\n');

  expect(readGit(root)?.changes.map((c) => c.file)).toEqual(['keep.ts']);
});

test('counts the last line of an untracked file with or without a trailing newline; binary and empty files count 0', () => {
  const root = newRepo();
  write(root, 'a.ts', 'one\n');
  commitAll(root);
  write(root, 'no-newline.txt', 'a\nb\nc');
  write(root, 'newline.txt', 'a\nb\nc\n');
  write(root, 'empty.txt', '');
  fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 10, 3]));

  const added = Object.fromEntries(readGit(root)!.changes.map((c) => [c.file, c.added]));
  expect(added).toEqual({ 'bin.dat': 0, 'empty.txt': 0, 'newline.txt': 3, 'no-newline.txt': 3 });
});

test('lists files in subfolders by their path from the repo root, even when run from a subfolder', () => {
  const root = newRepo();
  fs.mkdirSync(path.join(root, 'src'));
  write(root, 'src/a.ts', 'one\n');
  commitAll(root);
  write(root, 'src/a.ts', 'one\ntwo\n');
  write(root, 'src/b.ts', 'new\n');

  const snapshot = readGit(path.join(root, 'src'));
  expect(snapshot?.root).toBe(root);
  expect(snapshot?.changes).toMatchObject([
    { file: 'src/a.ts', added: 1, removed: 0 },
    { file: 'src/b.ts', added: 1, removed: 0 },
  ]);
});

test('finds TODOs in untracked files, in staged new files, and ignores TODOs that were already committed', () => {
  const root = newRepo();
  write(root, 'old.ts', '// TODO: committed long ago\n');
  commitAll(root);
  write(root, 'untracked.ts', 'a\n// FIXME - tidy this\n');
  write(root, 'staged.ts', 'a\nb\n// TODO fix\n');
  git(root, 'add', 'staged.ts');

  expect(addedTodos(root, ['old.ts', 'staged.ts', 'untracked.ts'])).toEqual([
    { file: 'staged.ts', line: 3, text: 'fix' },
    { file: 'untracked.ts', line: 2, text: 'tidy this' },
  ]);
});

test('finds TODOs in files whose names have spaces, brackets, colons and non-ASCII letters', () => {
  const root = newRepo();
  const names = [':odd.ts', '[id] page.tsx', 'café.ts'];
  for (const name of names) write(root, name, 'one\n');
  commitAll(root);
  for (const name of names) fs.appendFileSync(path.join(root, name), '// TODO: later\n');

  expect(addedTodos(root, names)).toEqual(names.map((file) => ({ file, line: 2, text: 'later' })));
});

test('skips untracked files over 1 MB when looking for TODOs', () => {
  const root = newRepo();
  write(root, 'a.ts', 'one\n');
  commitAll(root);
  write(root, 'big.txt', '// TODO: hidden\n' + 'x'.repeat(1_100_000));

  expect(addedTodos(root, ['big.txt'])).toEqual([]);
});
