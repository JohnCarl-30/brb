import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readCursorSessions } from '../../src/adapters/cursor';
import { SCAN_MS } from '../../src/adapters/files';
import { readSessionFile } from '../../src/adapters/index';
import { classify } from '../../src/classify';
import type { Session } from '../../src/types';
import { cu, cursorSlug, makeFakeHome, writeCursorSession } from '../support/fake-home';
import type { FakeHome } from '../support/fake-home';

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;
const DAY = 86_400_000;

const read = (h: FakeHome) => readCursorSessions(h.cursor, path.join(h.cursor, 'chats'), { now: NOW, sinceMs: NOW - SCAN_MS });
const byId = (sessions: Session[], id: string) => sessions.find((s) => s.id === id)!;
const kinds = (s: Session) => s.events.map((e) => e.kind);

// Every home a test makes is removed afterwards.
const homes: FakeHome[] = [];
const fakeHome = () => {
  const h = makeFakeHome();
  homes.push(h);
  return h;
};
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h.home, { recursive: true, force: true });
});

test('reads a finished chat: prompts keep their stamp, and the last turn takes the time the file changed', async () => {
  const h = fakeHome();
  const file = writeCursorSession(h, { id: 'c0000001', cwd: '/w/shop', mtimeMs: min(12), lines: [
    cu.user('add a discount field', min(50)),
    cu.say('Adding it.', [cu.tool('StrReplace', { path: '/w/shop/src/cart.ts', old_string: 'a', new_string: 'b' })]),
    cu.say('Added the field.'),
    cu.user('now test it', min(20)),
    cu.say('', [cu.tool('Shell', { command: 'npm test', description: 'Run the tests' }), cu.tool('Read', { path: '/w/shop/README.md' })]),
    cu.say('All 12 tests pass.'),
  ] });
  const [s] = await read(h);
  expect(s).toMatchObject({ tool: 'cursor', id: 'c0000001', cwd: '/w/shop', title: 'add a discount field', lastActivityAt: min(12), file, ide: true });
  expect(s.events).toEqual([
    { kind: 'user', at: min(50), text: 'add a discount field' },
    { kind: 'agent', at: min(50), text: 'Adding it.' },
    { kind: 'edit', at: min(50), files: ['/w/shop/src/cart.ts'] },
    { kind: 'agent', at: min(50), text: 'Added the field.' },
    { kind: 'turn-end', at: min(50) },
    { kind: 'user', at: min(20), text: 'now test it' },
    { kind: 'command', at: min(12), command: 'npm test', ok: true, output: '' },
    { kind: 'agent', at: min(12), text: 'All 12 tests pass.' },
    { kind: 'turn-end', at: min(12) },
  ]);
  expect(s.partialTurn).toBeUndefined();
  expect(classify(s, NOW)).toMatchObject({ status: 'finished', detail: 'All 12 tests pass.' });
});

test.each([
  ['Thursday, Jul 23, 2026, 11:20 PM (UTC+2)', Date.UTC(2026, 6, 23, 21, 20)],
  ['Thursday, Jul 23, 2026, 12:05 AM (UTC-7)', Date.UTC(2026, 6, 23, 7, 5)],
  ['Thursday, Jul 23, 2026, 12:30 PM (UTC+5:30)', Date.UTC(2026, 6, 23, 7, 0)],
  ['Thursday, Jul 23, 2026, 9:15 AM (UTC)', Date.UTC(2026, 6, 23, 9, 15)],
  ['Thursday, July 23, 2026, 21:20 (UTC+0200)', Date.UTC(2026, 6, 23, 19, 20)],
])('a prompt stamped %s was sent at that minute', async (stamp, at) => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'c0000001', cwd: '/w/a', mtimeMs: at + 5 * 60_000, lines: [
    { role: 'user', message: { content: [{ type: 'text', text: `<timestamp>${stamp}</timestamp>\n<user_query>\nfix it\n</user_query>` }] } },
  ] });
  const sessions = await readCursorSessions(h.cursor, path.join(h.cursor, 'chats'), { now: at + DAY, sinceMs: at - DAY });
  expect(sessions[0].events).toEqual([{ kind: 'user', at, text: 'fix it' }]);
});

test('a prompt with no stamp, or one that cannot be read, takes the time before it: the earlier prompt, else when the file was made', async () => {
  const h = fakeHome();
  const file = writeCursorSession(h, { id: 'c0000001', cwd: '/w/a', mtimeMs: min(5), lines: [
    cu.user('first ask'), cu.say('Done.'),
    cu.user('second ask', min(30)), cu.say('Done again.'),
    { role: 'user', message: { content: [{ type: 'text', text: '<timestamp>sometime last week</timestamp>\n<user_query>\nthird ask\n</user_query>' }] } },
  ] });
  const [s] = await read(h);
  const made = fs.statSync(file).birthtimeMs;
  const first = made > 0 && made <= min(5) ? made : min(5); // a file made after its own mtime says nothing, so the mtime stands in
  expect(s.events.filter((e) => e.kind === 'user')).toEqual([
    { kind: 'user', at: first, text: 'first ask' },
    { kind: 'user', at: Math.max(first, min(30)), text: 'second ask' },
    { kind: 'user', at: Math.max(first, min(30)), text: 'third ask' },
  ]);
});

test('a stamp never runs past the file\'s own time, or back before an earlier prompt', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'c0000001', cwd: '/w/a', mtimeMs: min(10), lines: [
    cu.user('first', min(40)), cu.say('Done.'),
    cu.user('earlier than the first', min(60)), cu.say('Done.'),
    cu.user('later than the file', min(1)),
  ] });
  const [s] = await read(h);
  expect(s.events.filter((e) => e.kind === 'user').map((e) => e.at)).toEqual([min(40), min(40), min(10)]);
});

test('what you typed is what is inside user_query, or the whole text when there is no such tag', async () => {
  const h = fakeHome();
  const user = (text: string) => ({ role: 'user', message: { content: [{ type: 'text', text }] } });
  writeCursorSession(h, { id: 'c0000001', cwd: '/w/a', mtimeMs: min(5), lines: [
    user(`<timestamp>${cu.stamp(min(40))}</timestamp>\n<user_query>\n  fix the build\nand the tests  \n</user_query>\n<attached_note>ignore me</attached_note>`),
    user('plain words, no tags'),
    user('<user_query>\nnever closed'),
    user(`<timestamp>${cu.stamp(min(30))}</timestamp>\n<user_query>\n\n</user_query>`), // nothing typed: not a prompt
    { role: 'user', message: { content: [{ type: 'text', text: 'two' }, { type: 'image', data: 'x' }, { type: 'text', text: 'blocks' }] } },
    { role: 'user', message: { content: 'not a list' } },
    { role: 'user' },
  ] });
  const [s] = await read(h);
  expect(s.events.map((e) => (e.kind === 'user' ? e.text : e.kind))).toEqual(['fix the build\nand the tests', 'plain words, no tags', 'never closed', 'two\nblocks']);
  expect(s.title).toBe('fix the build and the tests');
});

test('edits name the file whichever tool made them, made absolute from the project folder', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'c0000001', cwd: '/w/app', mtimeMs: min(5), lines: [
    cu.user('tidy up', min(30)),
    cu.say('', [
      cu.tool('Write', { path: 'src/new.ts', contents: 'x' }),
      cu.tool('StrReplace', { path: '/w/app/src/a.ts', old_string: 'a', new_string: 'b' }),
      cu.tool('Delete', { path: '/w/app/src/old.ts' }),
      cu.tool('EditNotebook', { target_notebook: 'notes.ipynb', cell_idx: 0 }),
      cu.tool('Edit', { file_path: 'src/b.ts' }),
      cu.tool('Write', { contents: 'no path' }),
      cu.tool('Read', { path: '/w/app/src/read-only.ts' }),
      cu.tool('Grep', { pattern: 'x', path: '/w/app/src' }),
      { type: 'tool_use', input: { path: 'no-name.ts' } },
      { type: 'tool_use', name: 'Write', input: 'not an object' },
    ]),
  ] });
  const [s] = await read(h);
  expect(s.events.flatMap((e) => (e.kind === 'edit' ? e.files : []))).toEqual(['/w/app/src/new.ts', '/w/app/src/a.ts', '/w/app/src/old.ts', '/w/app/notes.ipynb', '/w/app/src/b.ts']);
});

test('a shell command is a command that never reads as failed, since the transcript does not say how it ended', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'c0000001', cwd: '/w/app', mtimeMs: min(5), lines: [
    cu.user('run the tests', min(30)),
    cu.say('', [cu.tool('Shell', { command: 'npm test' }), cu.tool('Shell', { command: '  ' }), cu.tool('Shell', {})]),
    cu.say('3 tests failed.'),
  ] });
  const [s] = await read(h);
  expect(s.events.filter((e) => e.kind === 'command')).toEqual([{ kind: 'command', at: min(5), command: 'npm test', ok: true, output: '' }]);
  expect(classify(s, NOW)).toMatchObject({ status: 'finished', detail: '3 tests failed.' });
});

test('thinking the provider withheld is not something Cursor said', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'c0000001', cwd: '/w/app', mtimeMs: min(5), lines: [
    cu.user('fix it', min(30)),
    cu.say('[REDACTED]', [cu.tool('Read', { path: 'a.ts' })]),
    cu.say('Fixed the bug.\n\n[REDACTED]'),
    cu.say('  [REDACTED]  '), // nothing said and no tool called: it adds nothing, and ends nothing
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(30), text: 'fix it' },
    { kind: 'agent', at: min(5), text: 'Fixed the bug.' },
    { kind: 'turn-end', at: min(5) },
  ]);
});

// ---- the status each kind of chat reads as

test('a chat whose last step calls no tool has ended its turn; one that stops on a tool call is working, then idle', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'done0001', cwd: '/w/done', mtimeMs: min(20), lines: [cu.user('fix it', min(30)), cu.say('', [cu.tool('Shell', { command: 'npm test' })]), cu.say('Fixed.')] });
  writeCursorSession(h, { id: 'busy0001', cwd: '/w/busy', mtimeMs: NOW - 5_000, lines: [cu.user('fix it', min(3)), cu.say('Running the tests.', [cu.tool('Shell', { command: 'npm test' })])] });
  writeCursorSession(h, { id: 'idle0001', cwd: '/w/idle', mtimeMs: min(20), lines: [cu.user('fix it', min(30)), cu.say('Running the tests.', [cu.tool('Shell', { command: 'npm test' })])] });
  const sessions = await read(h);
  expect(classify(byId(sessions, 'done0001'), NOW).status).toBe('finished');
  expect(classify(byId(sessions, 'busy0001'), NOW)).toMatchObject({ status: 'working', detail: 'Running the tests.' });
  expect(classify(byId(sessions, 'idle0001'), NOW)).toMatchObject({ status: 'idle' });
  expect(byId(sessions, 'idle0001').pendingTool).toBeUndefined(); // a quiet call can't be told from a permission prompt, so nothing is claimed
});

test('a question tool with nothing after it is waiting on you, with its first question', async () => {
  const h = fakeHome();
  const ask = cu.tool('AskQuestion', { title: 'Before I start', questions: [
    { id: 'path', prompt: 'Which do you want me to do for Cursor?', options: [{ id: 'docs', label: 'Docs first' }, { id: 'auto', label: 'Full tracing now' }] },
    { id: 'more', prompt: 'And where?' },
  ] });
  writeCursorSession(h, { id: 'asks0001', cwd: '/w/asks', mtimeMs: min(20), lines: [cu.user('set up tracing', min(30)), cu.say('I looked at the project.', [cu.tool('Shell', { command: 'ls' }), ask])] });
  writeCursorSession(h, { id: 'asks0002', cwd: '/w/titled', mtimeMs: min(20), lines: [cu.user('set up tracing', min(30)), cu.say('', [cu.tool('AskQuestion', { title: 'Clarifying questions' })])] });
  writeCursorSession(h, { id: 'asks0003', cwd: '/w/bare', mtimeMs: min(20), lines: [cu.user('set up tracing', min(30)), cu.say('', [cu.tool('AskQuestion', {})])] });
  const sessions = await read(h);
  expect(byId(sessions, 'asks0001').events.at(-1)).toEqual({ kind: 'ask', at: min(20), reason: 'question', text: 'Which do you want me to do for Cursor?' });
  expect(classify(byId(sessions, 'asks0001'), NOW)).toMatchObject({ status: 'waiting', detail: 'asks: "Which do you want me to do for Cursor?"' });
  expect(classify(byId(sessions, 'asks0002'), NOW)).toMatchObject({ status: 'waiting', detail: 'asks: "Clarifying questions"' });
  expect(classify(byId(sessions, 'asks0003'), NOW)).toMatchObject({ status: 'waiting', detail: 'asks: "has a question for you"' });
});

test('a plan with nothing after it is waiting for your approval', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'plan0001', cwd: '/w/plan', mtimeMs: min(20), lines: [
    cu.user('plan the migration', min(30)), cu.say('Here is the plan.', [cu.tool('CreatePlan', { name: 'Migration', overview: 'Move to v2', plan: '1. …' })]),
  ] });
  const [s] = await read(h);
  expect(classify(s, NOW)).toMatchObject({ status: 'waiting', detail: 'has a plan waiting for your approval' });
});

test('a question or plan that anything followed was answered', async () => {
  const h = fakeHome();
  const ask = cu.tool('AskQuestion', { questions: [{ id: 'q', prompt: 'Round per item or on the total?' }] });
  writeCursorSession(h, { id: 'went0001', cwd: '/w/went', mtimeMs: min(20), lines: [cu.user('fix rounding', min(30)), cu.say('', [ask]), cu.say('Rounding per item, as you chose.')] });
  writeCursorSession(h, { id: 'went0002', cwd: '/w/next', mtimeMs: min(20), lines: [cu.user('fix rounding', min(30)), cu.say('', [ask]), cu.user('per item', min(25))] });
  writeCursorSession(h, { id: 'went0003', cwd: '/w/ended', mtimeMs: min(20), lines: [cu.user('fix rounding', min(30)), cu.say('', [ask]), cu.end()] });
  writeCursorSession(h, { id: 'went0004', cwd: '/w/built', mtimeMs: min(20), lines: [cu.user('plan it', min(30)), cu.say('', [cu.tool('CreatePlan', { name: 'P' })]), cu.say('', [cu.tool('Write', { path: 'a.ts', contents: '' })])] });
  const sessions = await read(h);
  for (const s of sessions) expect(kinds(s)).not.toContain('ask');
  expect(classify(byId(sessions, 'went0001'), NOW).status).toBe('finished');
  expect(classify(byId(sessions, 'went0003'), NOW).status).toBe('finished');
});

test('an older file\'s turn_ended line says how the turn ended', async () => {
  const h = fakeHome();
  const turn = [cu.user('fix it', min(30)), cu.say('', [cu.tool('Shell', { command: 'npm test' })])];
  writeCursorSession(h, { id: 'end00001', cwd: '/w/ok', mtimeMs: min(20), lines: [...turn, cu.end('success')] });
  writeCursorSession(h, { id: 'end00002', cwd: '/w/twice', mtimeMs: min(20), lines: [...turn, cu.say('Fixed.'), cu.end('success')] });
  writeCursorSession(h, { id: 'end00003', cwd: '/w/err', mtimeMs: min(20), lines: [...turn, cu.end('error', 'Connection lost\nafter 3 retries')] });
  writeCursorSession(h, { id: 'end00004', cwd: '/w/bare', mtimeMs: min(20), lines: [...turn, cu.end('error')] });
  writeCursorSession(h, { id: 'end00005', cwd: '/w/stop', mtimeMs: min(20), lines: [...turn, cu.say('Half way.'), cu.end('aborted', 'user')] });
  writeCursorSession(h, { id: 'end00006', cwd: '/w/odd', mtimeMs: min(20), lines: [...turn, { type: 'turn_ended', status: 'something-new' }] });
  const sessions = await read(h);
  expect(kinds(byId(sessions, 'end00001'))).toEqual(['user', 'command', 'turn-end']);
  expect(kinds(byId(sessions, 'end00002'))).toEqual(['user', 'command', 'agent', 'turn-end']); // one end, not two
  expect(classify(byId(sessions, 'end00003'), NOW)).toMatchObject({ status: 'failed', detail: 'Connection lost after 3 retries' });
  expect(classify(byId(sessions, 'end00004'), NOW)).toMatchObject({ status: 'failed', detail: 'Cursor stopped with an error' });
  expect(classify(byId(sessions, 'end00005'), NOW)).toMatchObject({ status: 'failed', detail: 'interrupted' });
  expect(kinds(byId(sessions, 'end00006'))).toEqual(['user', 'command']);
});

test('a chat that only asked something back is waiting on you', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'asks0001', cwd: '/w/a', mtimeMs: min(20), lines: [cu.user('make it faster', min(30)), cu.say('Which part is slow, the build or the tests?')] });
  expect(classify((await read(h))[0], NOW)).toMatchObject({ status: 'waiting', detail: 'asks: "Which part is slow, the build or the tests?"' });
});

// ---- which files are chats, and where their project lives

test('reads both layouts, and leaves out subagents, other files and chats older than the window', async () => {
  const h = fakeHome();
  const lines = [cu.user('fix it', min(30)), cu.say('Fixed.')];
  writeCursorSession(h, { id: 'nested01', cwd: '/w/a', mtimeMs: min(20), lines });
  writeCursorSession(h, { id: 'flat0001', cwd: '/w/a', mtimeMs: min(20), lines, flat: true });
  writeCursorSession(h, { id: 'old00001', cwd: '/w/a', mtimeMs: NOW - 8 * DAY, lines });
  const transcripts = path.join(h.cursor, 'projects', cursorSlug('/w/a'), 'agent-transcripts');
  const line = JSON.stringify(lines[0]) + '\n';
  fs.mkdirSync(path.join(transcripts, 'nested01', 'subagents'), { recursive: true });
  for (const other of ['nested01/subagents/sub00001.jsonl', 'nested01/notes.jsonl', 'legacy01.txt', 'nested01/nested01.txt']) {
    fs.writeFileSync(path.join(transcripts, other), line);
    fs.utimesSync(path.join(transcripts, other), new Date(min(20)), new Date(min(20)));
  }
  expect((await read(h)).map((s) => s.id).sort()).toEqual(['flat0001', 'nested01']);
});

test('a chat written in both layouts is one session: the file that changed last', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'both0001', cwd: '/w/a', mtimeMs: min(40), lines: [cu.user('fix it', min(50))], flat: true });
  const newer = writeCursorSession(h, { id: 'both0001', cwd: '/w/a', mtimeMs: min(20), lines: [cu.user('fix it', min(50)), cu.say('Fixed.')] });
  const sessions = await read(h);
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ file: newer, lastActivityAt: min(20) });
});

test('a project the CLI never marked is found on disk from its folder name, however its path is spelled', async () => {
  const h = fakeHome();
  const repo = path.join(h.home, 'my', 'code', 'shop.front_v2');
  const deadEnd = path.join(h.home, 'my code'); // fits more of the name, so it is tried first, and holds no shop folder
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(deadEnd, { recursive: true });
  writeCursorSession(h, { id: 'found001', cwd: repo, mtimeMs: min(20), trusted: false, lines: [cu.user('fix it', min(30)), cu.say('', [cu.tool('Write', { path: 'a.ts', contents: '' })])] });
  const [s] = await read(h);
  expect(s.cwd).toBe(repo);
  expect(s.events.at(-1)).toEqual({ kind: 'edit', at: min(20), files: [path.join(repo, 'a.ts')] });
});

test('when two folders would get the same name, the one with the longer folder names wins', async () => {
  const h = fakeHome();
  const [joined, split] = [path.join(h.home, 'code', 'my-app'), path.join(h.home, 'code', 'my', 'app')];
  fs.mkdirSync(joined, { recursive: true });
  fs.mkdirSync(split, { recursive: true });
  writeCursorSession(h, { id: 'same0001', cwd: split, mtimeMs: min(20), trusted: false, lines: [cu.user('fix it', min(30))] });
  expect((await read(h))[0].cwd).toBe(joined);
});

test('a project whose folder is gone, or that has no recent chat, is left out without a walk of the disk', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'gone0001', cwd: path.join(h.home, 'deleted', 'repo'), mtimeMs: min(20), trusted: false, lines: [cu.user('fix it', min(30))] });
  writeCursorSession(h, { id: 'file0001', cwd: path.join(h.home, 'a-file'), mtimeMs: min(20), trusted: false, lines: [cu.user('fix it', min(30))] });
  fs.writeFileSync(path.join(h.home, 'a-file'), 'not a folder');
  expect(await read(h)).toEqual([]);
});

test('a marker that is not JSON, or names no absolute path, falls back to the folder name', async () => {
  const h = fakeHome();
  const repo = path.join(h.home, 'repo');
  fs.mkdirSync(repo);
  for (const [id, marker] of [['mark0001', 'not json'], ['mark0002', '{"workspacePath":"relative/path"}'], ['mark0003', '{"workspacePath":7}'], ['mark0004', 'null']] as const) {
    fs.rmSync(path.join(h.cursor, 'projects'), { recursive: true, force: true });
    writeCursorSession(h, { id, cwd: repo, mtimeMs: min(20), lines: [cu.user('fix it', min(30))] });
    fs.writeFileSync(path.join(h.cursor, 'projects', cursorSlug(repo), '.workspace-trusted'), marker);
    expect((await read(h)).map((s) => [s.id, s.cwd])).toEqual([[id, repo]]);
  }
});

test('brb\'s own summary runs, and a Cursor that was never installed, give nothing', async () => {
  const h = fakeHome();
  expect(await read(h)).toEqual([]);
  writeCursorSession(h, { id: 'sum00001', cwd: '/tmp/brb-summaries', mtimeMs: min(20), lines: [cu.user('Summarize this', min(30))] });
  expect(await read(h)).toEqual([]);
});

test('a chat from the CLI can be resumed there; one from the app can only be opened', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'cli00001', cwd: '/w/a', mtimeMs: min(20), cli: true, lines: [cu.user('fix it', min(30))] });
  writeCursorSession(h, { id: 'app00001', cwd: '/w/a', mtimeMs: min(20), lines: [cu.user('fix it', min(30))] });
  fs.writeFileSync(path.join(h.cursor, 'chats', 'not-a-folder'), ''); // a stray file among the chat folders is passed over
  const sessions = await read(h);
  expect(byId(sessions, 'cli00001').ide).toBeUndefined();
  expect(byId(sessions, 'app00001').ide).toBe(true);
});

// ---- long files, broken lines, and the recap's whole read

test('a long chat is read as its head and tail, and says so when the last turn began in between', async () => {
  const h = fakeHome();
  writeCursorSession(h, { id: 'long0001', cwd: '/w/long', mtimeMs: min(5), filler: 200_000, lines: [
    cu.user('first ask', min(60)), cu.say('', [cu.tool('Write', { path: 'tail.ts', contents: '' })]), cu.say('Done with it.'),
  ] });
  writeCursorSession(h, { id: 'long0002', cwd: '/w/tail', mtimeMs: min(5), filler: 200_000, lines: [
    cu.user('first ask', min(60)), cu.user('second ask', min(10)), cu.say('Done with the second.'),
  ] });
  const sessions = await read(h);
  expect(byId(sessions, 'long0001')).toMatchObject({ title: 'first ask', partialTurn: true });
  expect(kinds(byId(sessions, 'long0001'))).toEqual(['user', 'edit', 'agent', 'turn-end']);
  expect(byId(sessions, 'long0002').partialTurn).toBeUndefined();
  expect(byId(sessions, 'long0002').events.at(-2)).toEqual({ kind: 'agent', at: min(5), text: 'Done with the second.' });
});

test('a line still being written, and lines that are not messages, are skipped', async () => {
  const h = fakeHome();
  const file = writeCursorSession(h, { id: 'c0000001', cwd: '/w/a', mtimeMs: min(20), lines: [
    { type: 'metadata', metadata: { overview: 'A chat about the build.' } },
    cu.user('fix the build', min(30)),
    { role: 'tool', message: { content: [{ type: 'text', text: 'a tool result' }] } },
    { role: 'assistant', message: {} },
    { role: 'assistant' },
    cu.say('Fixed it.'),
  ] });
  fs.appendFileSync(file, '42\nnull\n"text"\n{"role":"assistant","message":{"content":[{"type":"text","text":"cut of');
  fs.utimesSync(file, new Date(min(20)), new Date(min(20)));
  const [s] = await read(h);
  expect(s.events).toEqual([{ kind: 'user', at: min(30), text: 'fix the build' }, { kind: 'agent', at: min(20), text: 'Fixed it.' }, { kind: 'turn-end', at: min(20) }]);
});

test('readSessionFile reads a whole Cursor chat for its recap, and dates it from the file', async () => {
  const h = fakeHome();
  const file = writeCursorSession(h, { id: 'long0001', cwd: '/w/long', mtimeMs: min(5), filler: 200_000, lines: [
    cu.user('first ask', min(60)), cu.user('middle ask', min(40)), cu.say('Done with the middle.'), cu.user('last ask', min(10)), cu.say('Done with the last.'),
  ] });
  const s = (await readSessionFile('cursor', file, '/w/long'))!;
  expect(s.events.filter((e) => e.kind === 'user').map((e) => e.text)).toEqual(['first ask', 'middle ask', 'last ask']);
  expect(s).toMatchObject({ id: 'long0001', cwd: '/w/long', lastActivityAt: min(5), file });
  expect(s.partialTurn).toBeUndefined();
  expect(s.events.at(-1)).toEqual({ kind: 'turn-end', at: min(5) });
  expect(await readSessionFile('cursor', path.join(h.cursor, 'no-such-file.jsonl'), '/w/long')).toBeNull();
});
