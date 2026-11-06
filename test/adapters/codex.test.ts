import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readCodexSessions } from '../../src/adapters/codex';
import { HEAD_BYTES, SCAN_MS, TAIL_BYTES } from '../../src/adapters/files';
import { classify } from '../../src/classify';
import type { Session } from '../../src/types';
import { cx, iso, makeFakeHome, writeCodexSession } from '../support/fake-home';
import type { FakeHome } from '../support/fake-home';

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;
const DAY = 86_400_000;

const read = (h: FakeHome) => readCodexSessions(h.codex, { now: NOW, sinceMs: NOW - SCAN_MS });
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

test('reads a failed build session', async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'x1', threadName: 'upgrade to Next 16', lines: [
    cx.meta('x1', '/w/shopfront', min(55)), cx.started(min(55)), cx.user('upgrade to Next 16', min(55)),
    cx.change(['/w/shopfront/package.json'], min(30)),
    cx.run('npm run build', 1, 'Error: next.config.js: unknown option "ppr"', min(21)),
    cx.say('The build fails.', min(20)), cx.done(min(20))] });
  const [s] = await read(h);
  expect(s).toMatchObject({ tool: 'codex', id: 'x1', cwd: '/w/shopfront', title: 'upgrade to Next 16', lastActivityAt: min(20) });
  expect(kinds(s)).toEqual(['user', 'edit', 'command', 'agent', 'turn-end']);
  expect(s.events).toEqual([
    { kind: 'user', at: min(55), text: 'upgrade to Next 16' },
    { kind: 'edit', at: min(30), files: ['/w/shopfront/package.json'] },
    { kind: 'command', at: min(21), command: 'npm run build', ok: false, output: 'Error: next.config.js: unknown option "ppr"' },
    { kind: 'agent', at: min(20), text: 'The build fails.' },
    { kind: 'turn-end', at: min(20) },
  ]);
  expect(s.branch).toBeUndefined();
  expect(s.partialTurn).toBeUndefined(); // the whole file is read
  expect(classify(s, NOW)).toMatchObject({ status: 'failed', detail: 'Error: next.config.js: unknown option "ppr"' });
});

test('reads the older event format', async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'x2', lines: [
    cx.meta('x2', '/w/app', min(30)), cx.legacyUser('run the tests', min(29)),
    cx.legacyRun(['bash', '-lc', 'npm test'], 0, 'ok', min(28)),
    cx.legacySay('The tests pass.', min(27)), cx.legacyAbort(min(26))] });
  const [s] = await read(h);
  expect(s).toMatchObject({ tool: 'codex', id: 'x2', cwd: '/w/app', title: 'run the tests', lastActivityAt: min(26) });
  expect(kinds(s)).toEqual(['user', 'command', 'agent', 'error']);
  expect(s.events).toEqual([
    { kind: 'user', at: min(29), text: 'run the tests' },
    { kind: 'command', at: min(28), command: 'bash -lc npm test', ok: true, output: 'ok' },
    { kind: 'agent', at: min(27), text: 'The tests pass.' },
    { kind: 'error', at: min(26), text: 'interrupted' },
  ]);
  expect(classify(s, NOW)).toMatchObject({ status: 'failed', detail: 'interrupted' });
});

test("skips brb's own summary runs", async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'summary', lines: [cx.meta('summary', '/tmp/brb-summaries', min(5)), cx.user('summarize this session', min(5))] });
  expect(await read(h)).toEqual([]);
});

test('skips a session that never says which folder it ran in', async () => {
  const h = fakeHome();
  const noFolder = { timestamp: iso(min(5)), type: 'session_meta', payload: { id: 'nowhere' } };
  writeCodexSession(h, { id: 'nowhere', lines: [noFolder, cx.user('fix the login bug', min(5))] });
  writeCodexSession(h, { id: 'no-meta', lines: [cx.user('fix the login bug', min(5))] });
  expect(await read(h)).toEqual([]);
});

test('keeps only the end of a long command output, in either format', async () => {
  const h = fakeHome();
  const output = 'HEAD' + 'x'.repeat(9_000) + 'TAIL';
  writeCodexSession(h, { id: 'current', lines: [cx.meta('current', '/w/a', min(10)), cx.user('build it', min(10)), cx.run('npm run build', 1, output, min(9))] });
  writeCodexSession(h, { id: 'older', lines: [cx.meta('older', '/w/b', min(10)), cx.legacyUser('build it', min(10)), cx.legacyRun(['npm', 'run', 'build'], 1, output, min(9))] });
  for (const s of await read(h)) {
    const command = s.events.find((e) => e.kind === 'command');
    expect(command).toMatchObject({ command: expect.stringContaining('npm run build'), ok: false });
    const kept = command?.kind === 'command' ? command.output : '';
    expect([kept.length, kept.slice(0, 4), kept.slice(-4)]).toEqual([4_000, 'xxxx', 'TAIL']);
    expect(kept).toBe('x'.repeat(3_996) + 'TAIL');
  }
});

// ---- which files are read

test("ignores old files and brb's own summary sessions", async () => {
  const h = fakeHome();
  const lines = (id: string, cwd: string) => [cx.meta(id, cwd, min(30)), cx.user('fix the login bug', min(30))];
  writeCodexSession(h, { id: 'recent', lines: lines('recent', '/w/app') });
  writeCodexSession(h, { id: 'old', lines: lines('old', '/w/old'), mtimeMs: NOW - 8 * DAY });
  writeCodexSession(h, { id: 'summary', lines: lines('summary', '/tmp/brb-summaries') });
  expect((await read(h)).map((s) => s.id)).toEqual(['recent']);

  const onlyOld = fakeHome();
  writeCodexSession(onlyOld, { id: 'old', lines: lines('old', '/w/old'), mtimeMs: NOW - 8 * DAY });
  expect(await read(onlyOld)).toEqual([]);
});

test('returns nothing when there is no Codex folder', async () => {
  expect(await read(fakeHome())).toEqual([]);
});

test('reads rollouts from every day folder, and only rollouts', async () => {
  const h = fakeHome();
  const lines = [cx.meta('a', '/w/one', min(5)), cx.user('one', min(5))];
  writeCodexSession(h, { id: 'a', lines });
  writeCodexSession(h, { id: 'b', lines: [cx.meta('b', '/w/two', min(3 * 24 * 60)), cx.user('two', min(3 * 24 * 60))] });
  const file = writeCodexSession(h, { id: 'c', lines: [cx.meta('c', '/w/three', min(5)), cx.user('three', min(5))] });
  const copy = (to: string) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file, to);
  };
  const day = path.dirname(file);
  copy(path.join(day, 'deeper', 'rollout-too-deep.jsonl')); // one level below the day folder
  copy(path.join(day, 'notes.jsonl'));
  copy(path.join(day, 'rollout-2026-11-05T14-00-00-other.json'));
  copy(path.join(h.codex, 'archived_sessions', 'rollout-archived.jsonl'));
  expect((await read(h)).map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
});

// ---- who and where

test('takes the folder from the last line that has one', async () => {
  const h = fakeHome();
  const turn = (cwd: string, at: number) => ({ timestamp: iso(at), type: 'turn_context', payload: { cwd, model: 'm' } });
  writeCodexSession(h, { id: 'moved', lines: [cx.meta('moved', '/w/app', min(30)), cx.user('start here', min(29)), turn('/w/app-worktree', min(20)), cx.say('now elsewhere', min(19))] });
  writeCodexSession(h, { id: 'same', lines: [cx.meta('same', '/w/app', min(30)), turn('/w/app', min(29)), cx.user('stay here', min(28))] });
  const sessions = await read(h);
  expect(byId(sessions, 'moved').cwd).toBe('/w/app-worktree');
  expect(byId(sessions, 'same').cwd).toBe('/w/app');
});

test('a later session_meta does not rename the session, as one in a forked session would', async () => {
  const h = fakeHome();
  // A forked session's file carries its parent's lines too, so only the first session_meta is the session's own.
  writeCodexSession(h, { id: 'child', threadName: 'the fork', lines: [cx.meta('child', '/w/app', min(30)), cx.meta('parent', '/w/app', min(25)), cx.user('carry on', min(24))] });
  const sessions = await read(h);
  expect(sessions.map((s) => [s.id, s.title])).toEqual([['child', 'the fork']]);
});

test('a blank folder in a later line does not erase the earlier one', async () => {
  const h = fakeHome();
  const blank = { timestamp: iso(min(9)), type: 'turn_context', payload: { cwd: '' } };
  const missing = { timestamp: iso(min(8)), type: 'turn_context', payload: {} };
  writeCodexSession(h, { id: 'c1', lines: [cx.meta('c1', '/w/app', min(10)), blank, missing, cx.user('hi', min(7))] });
  expect((await read(h))[0].cwd).toBe('/w/app');
});

test('takes the session id from the file name when session_meta has none', async () => {
  const h = fakeHome();
  const uuid = '019a0000-0000-7000-8000-000000000003';
  const noId = { timestamp: iso(min(5)), type: 'session_meta', payload: { cwd: '/w/app' } };
  writeCodexSession(h, { id: uuid, threadName: 'named in the index', lines: [noId, cx.user('hi', min(5))] });
  const [s] = await read(h);
  expect(s).toMatchObject({ id: uuid, title: 'named in the index' });
});

test('skips a rollout whose id is nowhere to be found', async () => {
  const h = fakeHome();
  const noId = { timestamp: iso(min(5)), type: 'session_meta', payload: { cwd: '/w/app' } };
  writeCodexSession(h, { id: 'not-a-uuid', lines: [noId, cx.user('hi', min(5))] });
  expect(await read(h)).toEqual([]);
});

// ---- titles

test('names a session by its thread name, then its first prompt', async () => {
  const h = fakeHome();
  const prompt = (id: string) => [cx.meta(id, `/w/${id}`, min(30)), cx.user('first prompt', min(29))];
  writeCodexSession(h, { id: 'named', threadName: 'a chosen name', lines: prompt('named') });
  writeCodexSession(h, { id: 'plain', lines: prompt('plain') });
  writeCodexSession(h, { id: 'prompt', lines: [cx.meta('prompt', '/w/prompt', min(30)), cx.user('fix the\n\x1b[31mlogin\x1b[0m bug', min(29))] });
  writeCodexSession(h, { id: 'none', lines: [cx.meta('none', '/w/none', min(30)), cx.say('hello', min(29))] });
  writeCodexSession(h, { id: 'long', lines: [cx.meta('long', '/w/long', min(30)), cx.user('a'.repeat(100), min(29))] });
  writeCodexSession(h, { id: 'messy', threadName: `\x1b[1mbold\x1b[0m name\n${'z'.repeat(80)}`, lines: prompt('messy') });
  const sessions = await read(h);
  expect(byId(sessions, 'named').title).toBe('a chosen name'); // not the prompt
  expect(byId(sessions, 'plain').title).toBe('first prompt');
  expect(byId(sessions, 'prompt').title).toBe('fix the login bug');
  expect(byId(sessions, 'none').title).toBe('untitled session');
  expect(byId(sessions, 'long').title).toBe('a'.repeat(59) + '…');
  expect(byId(sessions, 'messy').title).toBe('bold name ' + 'z'.repeat(49) + '…');
});

test('the last thread name for a session wins, and a blank one does not erase it', async () => {
  const h = fakeHome();
  const index = path.join(h.codex, 'session_index.jsonl');
  const prompt = (id: string) => [cx.meta(id, `/w/${id}`, min(30)), cx.user('first prompt', min(29))];
  writeCodexSession(h, { id: 'renamed', threadName: 'first name', lines: prompt('renamed') });
  writeCodexSession(h, { id: 'blanked', threadName: 'only name', lines: prompt('blanked') });
  writeCodexSession(h, { id: 'blank-only', threadName: '', lines: prompt('blank-only') });
  writeCodexSession(h, { id: 'invisible', threadName: '\x1b[0m', lines: prompt('invisible') });
  writeCodexSession(h, { id: 'other', threadName: 'for somebody else', lines: [cx.meta('other', '/w/other', min(30)), cx.user('hi', min(29))] });
  fs.appendFileSync(index, [
    JSON.stringify({ id: 'renamed', thread_name: 'second name', updated_at: iso(min(20)) }),
    JSON.stringify({ id: 'renamed', thread_name: 'third name', updated_at: iso(min(10)) }),
    JSON.stringify({ id: 'renamed', thread_name: '', updated_at: iso(min(9)) }),
    JSON.stringify({ id: 'renamed', thread_name: '\x1b[0m   ', updated_at: iso(min(8)) }),
    JSON.stringify({ id: 'renamed', thread_name: null }),
    JSON.stringify({ id: 'renamed' }),
    JSON.stringify({ thread_name: 'no id' }),
    JSON.stringify({ id: 7, thread_name: 'numeric id' }),
    '{"id":"renamed","thread_name":"half-writ',
    'not json at all',
    '',
  ].join('\n'));
  const sessions = await read(h);
  expect(byId(sessions, 'renamed').title).toBe('third name');
  expect(byId(sessions, 'blanked').title).toBe('only name');
  expect(byId(sessions, 'blank-only').title).toBe('first prompt'); // an empty name names nothing
  expect(byId(sessions, 'invisible').title).toBe('first prompt'); // nor does one that is empty once cleaned
  expect(byId(sessions, 'other').title).toBe('for somebody else');
});

// ---- what each line becomes

test('turns a session into its events, in time order, with equal times keeping their order', async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'c1', lines: [
    cx.meta('c1', '/w/app', min(30)),
    cx.say('first reply', min(5)), cx.done(min(5)), cx.say('second reply', min(5)),
    cx.user('later in the file, earlier in time', min(10)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'later in the file, earlier in time' },
    { kind: 'agent', at: min(5), text: 'first reply' },
    { kind: 'turn-end', at: min(5) },
    { kind: 'agent', at: min(5), text: 'second reply' },
  ]);
  expect(s.lastActivityAt).toBe(min(5));
});

test('joins the text blocks of a message, and reads a message that is a plain string', async () => {
  const h = fakeHome();
  const blocks = (type: string, content: unknown, at: number) => ({ timestamp: iso(at), type: 'event_msg', payload: { type: 'item_completed', item: { type, content } } });
  writeCodexSession(h, { id: 'c1', lines: [
    cx.meta('c1', '/w/app', min(30)),
    blocks('UserMessage', [{ type: 'text', text: 'first part' }, { type: 'image', image_url: 'x' }, { type: 'text', text: 'second part' }], min(10)),
    blocks('AgentMessage', [{ type: 'Text', text: 'one' }, null, 'stray', { text: 'two' }], min(9)),
    blocks('AgentMessage', 'a plain string', min(8)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'first part\nsecond part' },
    { kind: 'agent', at: min(9), text: 'one\ntwo' },
    { kind: 'agent', at: min(8), text: 'a plain string' },
  ]);
});

test('ignores messages with no words, in either format', async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'c1', lines: [
    cx.meta('c1', '/w/app', min(30)),
    cx.user('', min(10)), cx.say('   ', min(9)), cx.legacyUser('\n', min(8)), cx.legacySay('', min(7)),
    cx.user('fix the login bug', min(5)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([{ kind: 'user', at: min(5), text: 'fix the login bug' }]);
});

test('takes commands as a string or as words, and counts only exit code 0 as working', async () => {
  const h = fakeHome();
  const command = (source: object, at: number) => ({ timestamp: iso(at), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', ...source } } });
  writeCodexSession(h, { id: 'c1', lines: [
    cx.meta('c1', '/w/app', min(30)),
    cx.run('npm test', 0, 'ok', min(20)),
    cx.legacyRun(['git', 'status', '--short'], 0, '', min(19)),
    cx.run('npm run lint', 2, 'lint failed', min(18)),
    command({ command: ['ls', 7, null, '-la'], exit_code: 0 }, min(17)),
    command({ command: 'sleep 99', aggregated_output: 12 }, min(16)), // no exit code: it did not finish
    command({ command: 'echo hi', exit_code: '0' }, min(15)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'command', at: min(20), command: 'npm test', ok: true, output: 'ok' },
    { kind: 'command', at: min(19), command: 'git status --short', ok: true, output: '' },
    { kind: 'command', at: min(18), command: 'npm run lint', ok: false, output: 'lint failed' },
    { kind: 'command', at: min(17), command: 'ls -la', ok: true, output: '' },
    { kind: 'command', at: min(16), command: 'sleep 99', ok: false, output: '' },
    { kind: 'command', at: min(15), command: 'echo hi', ok: false, output: '' },
  ]);
});

test('turns file changes into edits, with every path made absolute from the folder the turn ran in', async () => {
  const h = fakeHome();
  const turn = (cwd: string, at: number) => ({ timestamp: iso(at), type: 'turn_context', payload: { cwd } });
  writeCodexSession(h, { id: 'c1', lines: [
    cx.meta('c1', '/w/app', min(30)),
    cx.change(['src/a.ts', '/w/other/b.ts', './c.ts'], min(29)),
    turn('/w/app-worktree', min(28)),
    cx.change(['src/d.ts', '../shared/e.ts'], min(27)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'edit', at: min(29), files: ['/w/app/src/a.ts', '/w/other/b.ts', '/w/app/c.ts'] },
    { kind: 'edit', at: min(27), files: ['/w/app-worktree/src/d.ts', '/w/shared/e.ts'] },
  ]);
});

test('a file change seen before any folder is known keeps its absolute paths and drops the relative ones', async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'c1', lines: [
    cx.change(['relative.ts', '/w/app/absolute.ts'], min(30)),
    cx.change(['only-relative.ts'], min(29)),
    cx.meta('c1', '/w/app', min(28)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([{ kind: 'edit', at: min(30), files: ['/w/app/absolute.ts'] }]);
});

test('ends a turn on task_complete, and treats any aborted turn as interrupted', async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'c1', lines: [
    cx.meta('c1', '/w/app', min(30)), cx.started(min(30)), cx.user('fix it', min(30)),
    cx.say('on it', min(25)), cx.done(min(24)), cx.started(min(20)),
    cx.user('and the other thing', min(19)), cx.legacyAbort(min(18)),
    { timestamp: iso(min(17)), type: 'event_msg', payload: { type: 'turn_aborted' } },
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'agent', 'turn-end', 'user', 'error', 'error']);
  expect(s.events.slice(4)).toEqual([{ kind: 'error', at: min(18), text: 'interrupted' }, { kind: 'error', at: min(17), text: 'interrupted' }]);
});

test('ignores the lines that are not event messages, even when their payload looks like one', async () => {
  const h = fakeHome();
  const line = (type: string, payload: object) => ({ timestamp: iso(min(9)), type, payload });
  writeCodexSession(h, { id: 'c1', lines: [
    cx.meta('c1', '/w/app', min(30)),
    line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'instructions Codex put in' }] }),
    line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'a copy of the reply' }] }),
    line('response_item', { type: 'agent_message', message: 'sent to another agent' }),
    line('response_item', { type: 'user_message', message: 'not an event message' }),
    line('response_item', { type: 'function_call_output', call_id: 'c', output: 'x' }),
    line('event_msg', { type: 'token_count', info: null }),
    line('event_msg', { type: 'agent_reasoning', text: 'thinking' }),
    line('event_msg', { type: 'item_completed', item: { type: 'Reasoning', summary: ['thinking'] } }),
    line('event_msg', { type: 'item_completed', item: { type: 'McpToolCall', server: 's' } }),
    line('compacted', { message: 'a summary' }),
    { timestamp: iso(min(9)), type: 'token_usage_record' },
    cx.user('fix the login bug', min(8)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([{ kind: 'user', at: min(8), text: 'fix the login bug' }]);
  expect(s.title).toBe('fix the login bug'); // not the instructions Codex put in
});

test('ignores lines that have no usable time, but still takes the id and folder from one', async () => {
  const h = fakeHome();
  const noTime = (line: object) => ({ ...line, timestamp: undefined });
  const badTime = (line: object) => ({ ...line, timestamp: 'yesterday' });
  const numberTime = (line: object) => ({ ...line, timestamp: 5 });
  writeCodexSession(h, { id: 'c1', lines: [
    noTime(cx.meta('c1', '/w/app', min(10))),
    cx.user('fix the login bug', min(10)),
    noTime(cx.say('lost in time', min(9))), badTime(cx.say('also lost', min(8))), numberTime(cx.say('lost too', min(7))),
    noTime(cx.done(min(6))),
    cx.say('Done.', min(5)), cx.done(min(5)),
  ] });
  const [s] = await read(h);
  expect(s).toMatchObject({ id: 'c1', cwd: '/w/app', lastActivityAt: min(5) });
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'fix the login bug' },
    { kind: 'agent', at: min(5), text: 'Done.' },
    { kind: 'turn-end', at: min(5) },
  ]);
});

test('lines of the right type but the wrong shape are ignored, and never fail the read', async () => {
  const h = fakeHome();
  const at = iso(min(9));
  const itemOf = (item: unknown) => ({ timestamp: at, type: 'event_msg', payload: { type: 'item_completed', item } });
  const junk: unknown[] = [
    { timestamp: at, type: 'session_meta' }, { timestamp: at, type: 'session_meta', payload: null },
    { timestamp: at, type: 'turn_context', payload: 'text' }, { timestamp: at, type: 'turn_context', payload: [] },
    { timestamp: at, type: 'event_msg' }, { timestamp: at, type: 'event_msg', payload: null }, { timestamp: at, type: 'event_msg', payload: 7 },
    { timestamp: at, type: 'event_msg', payload: { type: 'item_completed' } },
    itemOf(null), itemOf('UserMessage'), itemOf([]), itemOf({}),
    itemOf({ type: 'UserMessage' }), itemOf({ type: 'AgentMessage', content: 5 }), itemOf({ type: 'AgentMessage', content: [null, 3] }),
    itemOf({ type: 'CommandExecution' }), itemOf({ type: 'CommandExecution', command: [] }), itemOf({ type: 'CommandExecution', command: '  ' }),
    itemOf({ type: 'FileChange' }), itemOf({ type: 'FileChange', changes: null }), itemOf({ type: 'FileChange', changes: ['a.ts'] }),
    itemOf({ type: 'FileChange', changes: 'a.ts' }), itemOf({ type: 'FileChange', changes: {} }),
    { timestamp: at, type: 'event_msg', payload: { type: 'user_message' } },
    { timestamp: at, type: 'event_msg', payload: { type: 'agent_message', message: { text: 'not a string' } } },
    { timestamp: at, type: 'event_msg', payload: { type: 'exec_command_end' } },
    { timestamp: at, type: 'event_msg', payload: { type: 'exec_command_end', command: {} } },
    [1, 2, 3], 'a string', 42,
  ];
  writeCodexSession(h, { id: 'c1', lines: [cx.meta('c1', '/w/app', min(10)), ...(junk as object[]), cx.user('fix the login bug', min(8)), cx.say('Done.', min(7)), cx.done(min(7))] });
  const [s] = await read(h);
  expect(s).toMatchObject({ id: 'c1', cwd: '/w/app', title: 'fix the login bug' });
  expect(kinds(s)).toEqual(['user', 'agent', 'turn-end']);
});

test('a session with no events keeps the time its file last changed', async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'quiet', threadName: 'just a name', lines: [cx.meta('quiet', '/w/app', min(60))], mtimeMs: min(30) });
  const [s] = await read(h);
  expect(s).toMatchObject({ title: 'just a name', events: [], lastActivityAt: min(30) });
});

test('reads a rollout that holds both formats, as one resumed after an upgrade could', async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'c1', lines: [
    cx.meta('c1', '/w/app', min(60)), cx.legacyUser('run the tests', min(59)), cx.legacyRun(['npm', 'test'], 0, 'ok', min(58)), cx.legacySay('Passing.', min(57)),
    cx.user('now lint', min(30)), cx.run('npm run lint', 0, 'clean', min(29)), cx.say('Clean.', min(28)), cx.done(min(28)),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'command', 'agent', 'user', 'command', 'agent', 'turn-end']);
});

// ---- whole files, and files being written

// Rows the reader has no use for, to push a rollout past the bytes a head-and-tail reader would look at.
const FILLER_ROWS = Math.ceil((HEAD_BYTES + TAIL_BYTES) / 4_000) * 3;
const filler = (at: number) => Array.from({ length: FILLER_ROWS }, (_, i) => ({ timestamp: iso(at), type: 'response_item', payload: { type: 'function_call_output', call_id: `call-${i}`, output: 'x'.repeat(4_000) } }));

test('reads a long rollout whole, so nothing in the middle is missed and the last turn is never partial', async () => {
  const h = fakeHome();
  const lines = [
    cx.meta('long', '/w/app', min(90)), cx.user('fix the login bug', min(90)),
    ...filler(min(80)), cx.change(['/w/app/src/login.ts'], min(60)), ...filler(min(50)),
    cx.say('Want me to add tests too?', min(5)), cx.done(min(5)),
  ];
  const file = writeCodexSession(h, { id: 'long', lines });
  expect(fs.statSync(file).size).toBeGreaterThan((HEAD_BYTES + TAIL_BYTES) * 3);
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'edit', 'agent', 'turn-end']); // the edit sat in the middle of the file
  expect(s.partialTurn).toBeUndefined();
  expect(classify(s, NOW).status).toBe('finished'); // it worked, so the closing question is only an offer
});

test('a long rollout with a real question is waiting, because its whole last turn was read', async () => {
  const h = fakeHome();
  writeCodexSession(h, { id: 'long', lines: [
    cx.meta('long', '/w/app', min(90)), cx.user('how should I name it?', min(90)),
    ...filler(min(80)), cx.say('Want me to pick one?', min(5)), cx.done(min(5)),
  ] });
  const [s] = await read(h);
  expect(s.partialTurn).toBeUndefined();
  expect(classify(s, NOW).status).toBe('waiting');
});

test('survives a half-written last line', async () => {
  const h = fakeHome();
  const file = writeCodexSession(h, { id: 'c1', lines: [cx.meta('c1', '/w/app', min(10)), cx.user('fix the login bug', min(5)), cx.say('Still going', min(2))] });
  fs.appendFileSync(file, '{"timestamp":"2026-11-05T14:58:00.000Z","type":"event_msg","payload":{"type":"agent_mess'); // being written right now
  // Appending made the file newer than its last event. Pin that time so the file stays in the scan window on any clock.
  fs.utimesSync(file, new Date(min(1)), new Date(min(1)));
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'agent']);
  expect(s.lastActivityAt).toBe(min(2));
  expect(s.partialTurn).toBeUndefined();
});
