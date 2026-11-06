import { open, readdir, readFile, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, join } from 'node:path';

// Only files changed within this long ago are read at all (waiting sessions stay visible for 7 days).
export const SCAN_MS = 7 * 86_400_000;
// A session file is read as its first HEAD_BYTES and last TAIL_BYTES, so the cost never grows with a long history.
export const HEAD_BYTES = 16_384;
export const TAIL_BYTES = 65_536;
// A session's title is cut to this many characters.
export const TITLE_MAX = 60;
// errorLine is linear in the output and classify only reads its end, so a huge build log is never kept whole.
export const OUTPUT_KEEP_CHARS = 4_000;

export interface RecentFile { path: string; mtimeMs: number }

// Whether a read failed because the file or folder isn't there (it was removed, or the tool isn't installed).
export const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

// What a folder holds. A folder that isn't there has nothing; any other error throws.
export async function listFolder(folder: string) {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return []; // the tool isn't installed, or the folder was removed while we looked
    throw error;
  }
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch (error) {
    if (isMissing(error)) return null; // removed since it was listed
    throw error;
  }
}

// The files under `dir` whose name matches and that changed after `sinceMs` (an epoch cutoff, not a duration).
// `maxDepth` counts path segments below `dir`: 1 is its own files, 2 adds one level of folders, and so on.
// A missing folder gives []. Any other error throws, so the caller can say the tool's files couldn't be read.
export async function recentFiles(dir: string, name: RegExp, sinceMs: number, maxDepth: number): Promise<RecentFile[]> {
  async function walk(folder: string, depth: number): Promise<RecentFile[]> {
    const found = await Promise.all((await listFolder(folder)).map(async (entry): Promise<RecentFile[]> => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        return entry.name !== 'subagents' && depth < maxDepth ? walk(path, depth + 1) : [];
      }
      if (!entry.isFile() || !name.test(entry.name)) return [];
      const mtimeMs = await mtimeOf(path);
      return mtimeMs !== null && mtimeMs > sinceMs ? [{ path, mtimeMs }] : [];
    }));
    return found.flat();
  }
  return walk(dir, 1);
}

async function readRange(handle: FileHandle, position: number, length: number): Promise<string> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break; // the file is shorter than when it was measured
    filled += bytesRead;
  }
  return buffer.toString('utf8', 0, filled);
}

const toLines = (text: string): string[] => text.split('\n').filter((line) => line !== '');

// The lines of a session file: all of them when it fits in HEAD_BYTES + TAIL_BYTES, otherwise the head's lines
// followed by the tail's, with `tailStart` the index in `lines` of the first tail line. Then the middle was
// skipped, so what happened there is unseen. `tailStart` is null when the whole file was read.
// The line a window cuts in half stays in `lines` as a fragment, and so does a line still being written;
// parseJsonLines drops both. A file that was removed after it was listed has no lines; any other error throws.
export async function readHeadTail(path: string): Promise<{ lines: string[]; tailStart: number | null }> {
  let handle: FileHandle;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if (isMissing(error)) return { lines: [], tailStart: null };
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size <= HEAD_BYTES + TAIL_BYTES) {
      return { lines: toLines(await readRange(handle, 0, size)), tailStart: null };
    }
    const head = toLines(await readRange(handle, 0, HEAD_BYTES));
    const tail = toLines(await readRange(handle, size - TAIL_BYTES, TAIL_BYTES));
    return { lines: [...head, ...tail], tailStart: head.length };
  } finally {
    await handle.close();
  }
}

// A whole file's text, for a tool whose files are small. A file that was removed after it was listed gives null;
// any other error throws.
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

// The value when it is a non-empty string, else undefined: a field that is missing, empty or of another type is one case.
export const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

// The JSON objects among the lines. A line that doesn't parse (a fragment, or one still being written) or
// that isn't an object is dropped, so a reader never has to guard against a null or a number.
export function parseJsonLines(lines: string[]): any[] {
  const objects: any[] = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (typeof value === 'object' && value !== null) objects.push(value);
    } catch {
      // not JSON
    }
  }
  return objects;
}

// brb's own AI summaries run inside <tmpdir>/brb-summaries, and those sessions must never show up as work.
export function isSummaryCwd(cwd: string): boolean {
  return basename(cwd) === 'brb-summaries';
}
