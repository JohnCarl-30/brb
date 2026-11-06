import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { oneLine } from './text';

export interface Change { file: string; added: number; removed: number; mtimeMs: number }
export interface Todo { file: string; line: number; text: string }
export interface GitSnapshot { root: string; branch: string | null; changes: Change[] }

const MAX_SCAN_BYTES = 1_000_000;
const TODO = /\b(?:TODO|FIXME)\b[:\s-]*(.*)$/;
// Pinned so the owner's git config (colors, path prefixes, quoting, external diff tools) can't change what we parse.
// shortcut: a path with a tab, quote, backslash or newline in its name is still quoted by git, so its TODOs are missed. Unquote if that ever matters.
const PATCH = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', 'HEAD', '-U0'];

// Read-only: only rev-parse, status, diff and ls-files. Null when the command fails (not a repo, no HEAD yet, git missing).
function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const headExists = (root: string): boolean => git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null;

function countLines(file: string): number {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('\0')) return 0; // binary, like the "-" git prints
    return text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0); // a last line with no newline still counts
  } catch {
    return 0;
  }
}

export function readGit(cwd: string): GitSnapshot | null {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (top === null) return null;
  const root = top.replace(/\r?\n$/, '');
  // Paths from status and diff are relative to the root, so every call below runs there.
  const name = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
  const branch = name && name !== 'HEAD' ? name : null; // "HEAD" means detached
  const hasHead = headExists(root);

  // -z entries are "XY path"; a rename or copy is followed by one more entry, its original path.
  const entries = (git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) ?? '').split('\0');
  const files: { file: string; untracked: boolean }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === '') continue;
    const xy = entry.slice(0, 2);
    if (/[RC]/.test(xy)) i++; // skip the original path
    if (!xy.includes('D')) files.push({ file: entry.slice(3), untracked: xy === '??' });
  }

  // -z entries are "added\tremoved\tpath"; a rename is "added\tremoved\t", then its old and new paths as separate entries.
  const counts = new Map<string, [number, number]>();
  const numstat = hasHead ? (git(root, ['diff', 'HEAD', '--numstat', '-z']) ?? '').split('\0') : [];
  for (let i = 0; i < numstat.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(numstat[i]);
    if (!match) continue;
    let file = match[3];
    if (file === '') {
      file = numstat[i + 2]; // the rename's new path
      i += 2;
    }
    counts.set(file, [Number(match[1]) || 0, Number(match[2]) || 0]); // "-" is NaN, so 0
  }

  const changes: Change[] = [];
  for (const { file, untracked } of files) {
    const abs = path.join(root, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue; // gone since git looked
    }
    if (!stat.isFile()) continue; // a submodule or a nested repo
    const [added, removed] = hasHead && !untracked ? (counts.get(file) ?? [0, 0]) : [countLines(abs), 0];
    changes.push({ file, added, removed, mtimeMs: stat.mtimeMs });
  }
  changes.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { root, branch, changes };
}

const todosIn = (file: string, line: number, text: string): Todo[] => {
  const match = TODO.exec(text);
  return match ? [{ file, line, text: oneLine(match[1], 60) }] : [];
};

// A file git has no earlier version of (untracked, or no commit yet): every line is new.
function scanWhole(root: string, file: string): Todo[] {
  try {
    const abs = path.join(root, file);
    if (fs.statSync(abs).size > MAX_SCAN_BYTES) return [];
    const text = fs.readFileSync(abs, 'utf8');
    if (text.includes('\0')) return [];
    return text.split('\n').flatMap((line, i) => todosIn(file, i + 1, line));
  } catch {
    return []; // gone, a folder, or unreadable
  }
}

// Reads the added lines of a -U0 patch. Inside a hunk every line starts with +, - or \, so "diff --git", "@@" and "+++ " at the start of a line outside one are headers.
function patchTodos(patch: string): Map<string, Todo[]> {
  const byFile = new Map<string, Todo[]>();
  let file = '';
  let line = 0;
  let inHunk = false;
  for (const text of patch.split('\n')) {
    if (text.startsWith('diff --git ')) {
      file = '';
      inHunk = false;
    } else if (text.startsWith('@@ ')) {
      line = Number(/\+(\d+)/.exec(text)?.[1]); // "@@ -41,0 +42,2 @@": new lines start at 42
      inHunk = true;
    } else if (inHunk) {
      if (text.startsWith('+')) {
        const found = todosIn(file, line++, text.slice(1));
        if (found.length > 0) byFile.set(file, [...(byFile.get(file) ?? []), ...found]);
      }
    } else if (text.startsWith('+++ b/')) {
      file = text.slice(6).replace(/\t$/, ''); // git adds a tab after a name with spaces
    }
  }
  return byFile;
}

export function addedTodos(root: string, files: string[]): Todo[] {
  // Files in the index can be compared with HEAD. The rest (untracked, or no HEAD at all) are scanned whole.
  const inIndex = new Set(
    files.length > 0 && headExists(root) ? (git(root, ['ls-files', '-z', '--', ...files]) ?? '').split('\0') : [],
  );
  const compared = files.filter((file) => inIndex.has(file));
  const patch = compared.length > 0 ? patchTodos(git(root, [...PATCH, '--', ...compared]) ?? '') : new Map<string, Todo[]>();
  return files.flatMap((file) => (inIndex.has(file) ? (patch.get(file) ?? []) : scanWhole(root, file)));
}
