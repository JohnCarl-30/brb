import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { oneLine } from './text';

export interface Change { file: string; added: number; removed: number; mtimeMs: number }
export interface Todo { file: string; line: number; text: string }
export interface GitSnapshot { root: string; branch: string | null; changes: Change[] }

const MAX_SCAN_BYTES = 1_000_000;
const MAX_GIT_OUTPUT = 64 * 1024 * 1024;
const TODO = /\b(?:TODO|FIXME)\b[:\s-]*(.*)$/;
// Pinned so the owner's git config (colors, path prefixes, quoting, external diff tools) can't change what we parse.
const PATCH = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', 'HEAD', '-U0'];

// Read-only: only rev-parse, status, diff and ls-files. Null when the command fails (not a repo, no HEAD yet, git missing).
function git(cwd: string, args: string[]): string | null {
  try {
    // maxBuffer: the 1 MB default would throw on one big diff (a regenerated lockfile) and drop every result.
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_GIT_OUTPUT });
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
    // shortcut: an untracked file over 1 MB counts 0 lines, so a stray dump or video is never read. Count bytes instead if that ever matters.
    const [added, removed] = hasHead && !untracked ? (counts.get(file) ?? [0, 0]) : [stat.size > MAX_SCAN_BYTES ? 0 : countLines(abs), 0];
    changes.push({ file, added, removed, mtimeMs: stat.mtimeMs });
  }
  changes.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { root, branch, changes };
}

const todosIn = (file: string, line: number, text: string): Todo[] => {
  const match = TODO.exec(text.replace(/\r$/, '')); // `.` doesn't match the \r of a CRLF line
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

// A name that holds a quote, a backslash or a control character is quoted in a patch whatever the config says, the way
// C writes a string: "b/tab\there.ts". An octal escape is one byte of the name, so the bytes are put back together.
const ESCAPED: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };
function unquote(quoted: string): string {
  const bytes: number[] = [];
  for (const [, escape, plain] of quoted.matchAll(/\\([0-7]{3}|.)|([^\\]+)/gs)) {
    if (plain !== undefined) bytes.push(...Buffer.from(plain));
    else if (escape.length === 3) bytes.push(parseInt(escape, 8));
    else bytes.push(ESCAPED[escape] ?? escape.charCodeAt(0)); // \" and \\ stand for themselves
  }
  return Buffer.from(bytes).toString('utf8');
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
    } else if (text.startsWith('+++ "b/')) {
      file = unquote(/^\+\+\+ "b\/(.*)"\t?$/.exec(text)?.[1] ?? '');
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
