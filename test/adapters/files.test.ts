import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { ERROR_MAX, HEAD_BYTES, OUTPUT_KEEP_CHARS, SCAN_MS, TAIL_BYTES, TITLE_MAX, isMissing, isSummaryCwd, parseJsonLines, readHeadTail, readText, recentFiles, str, textOf } from '../../src/adapters/files';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'brb-files-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the scan window is 7 days and the read windows are 16 KiB and 64 KiB', () => {
  expect([SCAN_MS, HEAD_BYTES, TAIL_BYTES]).toEqual([604_800_000, 16_384, 65_536]);
});

test('every adapter cuts a title at 60 characters, an error message at 200, and keeps the last 4,000 characters of a command output', () => {
  expect([TITLE_MAX, ERROR_MAX, OUTPUT_KEEP_CHARS]).toEqual([60, 200, 4_000]);
});

// recentFiles

const SINCE = Date.UTC(2026, 10, 5, 15, 0, 0);
const touch = (rel: string, mtimeMs: number): string => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
};

test('recentFiles returns an empty list for a missing folder', async () => {
  expect(await recentFiles(path.join(dir, 'nope'), /\.jsonl$/, 0, 2)).toEqual([]);
});

test('recentFiles keeps matching files changed after the cutoff', async () => {
  const fresh = touch('p1/a.jsonl', SINCE + 1_000);
  const other = touch('p2/b.jsonl', SINCE + 5_000);
  touch('p1/old.jsonl', SINCE - 1_000);
  touch('p1/at-the-cutoff.jsonl', SINCE); // only files changed after the cutoff count
  touch('p1/notes.txt', SINCE + 1_000);
  const found = await recentFiles(dir, /\.jsonl$/, SINCE, 2);
  expect(found.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
    { path: fresh, mtimeMs: SINCE + 1_000 },
    { path: other, mtimeMs: SINCE + 5_000 },
  ]);
});

test('recentFiles counts depth as path segments below the folder', async () => {
  const top = touch('top.jsonl', SINCE + 1_000);
  const one = touch('p1/one.jsonl', SINCE + 1_000);
  const two = touch('p1/p2/two.jsonl', SINCE + 1_000);
  const paths = async (depth: number) => (await recentFiles(dir, /\.jsonl$/, SINCE, depth)).map((f) => f.path).sort();
  expect(await paths(1)).toEqual([top]);
  expect(await paths(2)).toEqual([one, top].sort());
  expect(await paths(3)).toEqual([one, top, two].sort());
});

test('recentFiles never looks inside a folder named subagents', async () => {
  const kept = touch('p1/s1/main.jsonl', SINCE + 1_000);
  touch('p1/s1/subagents/agent-1.jsonl', SINCE + 1_000);
  expect((await recentFiles(dir, /\.jsonl$/, SINCE, 4)).map((f) => f.path)).toEqual([kept]);
});

test('recentFiles skips a file that is removed after it was listed', async () => {
  const gone = touch('p1/gone.jsonl', SINCE + 1_000);
  const kept = touch('p1/kept.jsonl', SINCE + 1_000);
  // The name check runs between listing a folder and reading a file's time, so removing the file there is that race.
  const removesGone = { test: (name: string) => (name === 'gone.jsonl' ? (fs.rmSync(gone), true) : true) } as unknown as RegExp;
  expect((await recentFiles(dir, removesGone, SINCE, 2)).map((f) => f.path)).toEqual([kept]);
});

test('recentFiles reports errors other than a missing folder', async () => {
  const file = touch('plain.txt', SINCE + 1_000);
  await expect(recentFiles(file, /\.jsonl$/, SINCE, 2)).rejects.toThrow(/ENOTDIR/);
});

// readHeadTail: 64-byte rows (63 characters and a newline), so the window edges land on row edges.
// 1280 rows are exactly HEAD_BYTES + TAIL_BYTES, which a file may be and still be read whole.

const ROW_BYTES = 64;
const row = (i: number) => String(i).padStart(6, '0') + 'x'.repeat(ROW_BYTES - 7);
const rows = (count: number) => Array.from({ length: count }, (_, i) => `${row(i)}\n`).join('');
const writeFile = (content: string) => {
  const file = path.join(dir, 'f.jsonl');
  fs.writeFileSync(file, content);
  return file;
};

test('readHeadTail reads a small file whole', async () => {
  const file = writeFile('{"a":1}\n{"b":2}\n');
  expect(await readHeadTail(file)).toEqual({ lines: ['{"a":1}', '{"b":2}'], tailStart: null });
});

test('readHeadTail returns nothing for an empty file', async () => {
  expect(await readHeadTail(writeFile(''))).toEqual({ lines: [], tailStart: null });
});

test('readHeadTail returns nothing for a file that no longer exists', async () => {
  expect(await readHeadTail(path.join(dir, 'gone.jsonl'))).toEqual({ lines: [], tailStart: null });
});

test('readHeadTail reports errors other than a missing file', async () => {
  const file = writeFile('{"a":1}\n');
  await expect(readHeadTail(path.join(file, 'child'))).rejects.toThrow(/ENOTDIR/);
});

test('readHeadTail reads a file of exactly head plus tail bytes whole', async () => {
  const { lines, tailStart } = await readHeadTail(writeFile(rows((HEAD_BYTES + TAIL_BYTES) / ROW_BYTES)));
  expect(tailStart).toBeNull();
  expect(lines).toHaveLength(1280);
  expect([lines[0], lines.at(-1)]).toEqual([row(0), row(1279)]);
});

test('readHeadTail skips the middle of a bigger file and says where the tail starts', async () => {
  const { lines, tailStart } = await readHeadTail(writeFile(rows(1281)));
  expect(tailStart).toBe(HEAD_BYTES / ROW_BYTES); // 256 head rows
  expect(lines).toHaveLength(256 + TAIL_BYTES / ROW_BYTES);
  expect(lines[tailStart! - 1]).toBe(row(255)); // the last head row
  expect(lines[tailStart!]).toBe(row(257)); // row 256 sits in the skipped middle
  expect(lines.at(-1)).toBe(row(1280));
});

test('readHeadTail leaves the lines its windows cut for parseJsonLines to drop', async () => {
  const objects = Array.from({ length: 1300 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(50) }));
  const { lines, tailStart } = await readHeadTail(writeFile(`${objects.join('\n')}\n{"half`));
  expect(tailStart).not.toBeNull();
  expect(lines.at(-1)).toBe('{"half'); // the line being written
  const parsed = parseJsonLines(lines);
  // Only the lines a window cut are gone: the end of the head, the start of the tail and the line being written.
  expect(lines.length - parsed.length).toBeGreaterThanOrEqual(1);
  expect(lines.length - parsed.length).toBeLessThanOrEqual(3);
  expect(parsed.every((o) => typeof o.i === 'number')).toBe(true);
  expect(parsed.at(-1)).toEqual({ i: 1299, pad: 'x'.repeat(50) });
});

// readText and isMissing

test('readText returns the whole text of a file, null for one that does not exist, and reports other errors', async () => {
  const file = writeFile('{"a":1}\n{"b":');
  expect(await readText(file)).toBe('{"a":1}\n{"b":');
  expect(await readText(writeFile(''))).toBe('');
  expect(await readText(path.join(dir, 'gone.jsonl'))).toBeNull();
  await expect(readText(path.join(file, 'child'))).rejects.toThrow(/ENOTDIR/);
  await expect(readText(dir)).rejects.toThrow(/EISDIR/);
});

test('isMissing is true only for a "no such file" error', () => {
  const failure = (code: string) => Object.assign(new Error(code), { code });
  expect(isMissing(failure('ENOENT'))).toBe(true);
  expect(isMissing(failure('EACCES'))).toBe(false);
  expect(isMissing(failure('ENOTDIR'))).toBe(false);
  expect([new Error('plain'), null, undefined, 'ENOENT', { code: 'ENOENT' }.code].map(isMissing)).toEqual([false, false, false, false, false]);
});

// str

test('str gives a string that has characters in it, and undefined for anything else', () => {
  expect(str('main')).toBe('main');
  expect(str(' ')).toBe(' '); // only empty counts as nothing; what blank means is up to the caller
  expect([str(''), str(7), str(null), str(undefined), str(['a']), str({ a: 'a' }), str(true)]).toEqual(Array(7).fill(undefined));
});

// textOf

test('textOf gives a string as it is, joins the text of every block that has some, and gives nothing for anything else', () => {
  expect(textOf('a plain string')).toBe('a plain string');
  expect(textOf([{ type: 'text', text: 'one' }, { inlineData: { data: 'AAAA' } }, null, 'stray', { text: 7 }, { text: 'two' }])).toBe('one\ntwo');
  expect([textOf([]), textOf(null), textOf(undefined), textOf(5), textOf({ text: 'not in a list' })]).toEqual(['', '', '', '', '']);
});

// parseJsonLines

test('parseJsonLines drops lines that are not JSON objects', () => {
  const lines = ['{"a":1}', '', '{"b":', 'null', '7', '"s"', ' {"c":3} ', 'not json'];
  expect(parseJsonLines(lines)).toEqual([{ a: 1 }, { c: 3 }]);
});

// isSummaryCwd

test('isSummaryCwd recognises brb summary folders by their last segment', () => {
  expect(isSummaryCwd('/tmp/brb-summaries')).toBe(true);
  expect(isSummaryCwd('/var/folders/x/T/brb-summaries/')).toBe(true);
  expect(isSummaryCwd('/w/app')).toBe(false);
  expect(isSummaryCwd('/w/brb-summaries/app')).toBe(false);
  expect(isSummaryCwd('/w/brb-summaries-old')).toBe(false);
  expect(isSummaryCwd('/w/old-brb-summaries')).toBe(false);
});
