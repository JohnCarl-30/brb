import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readGeminiSessions } from '../../src/adapters/gemini';
import { SCAN_MS } from '../../src/adapters/files';
import { classify } from '../../src/classify';
import type { Session } from '../../src/types';
import { gm, iso, makeFakeHome, writeGeminiSession } from '../support/fake-home';
import type { FakeHome } from '../support/fake-home';

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;
const DAY = 86_400_000;

const read = (h: FakeHome) => readGeminiSessions(h.gemini, { now: NOW, sinceMs: NOW - SCAN_MS });
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

test('reads a finished session with edits', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g-1', projectRoot: '/w/blog', messages: [
    gm.user('fix RSS dates', min(50)),
    gm.say('', min(35), [gm.call('replace', { file_path: '/w/blog/src/rss.ts' }, 'success', min(35))]),
    gm.say('Fixed the RSS dates to use UTC.', min(30)),
  ] });
  const [s] = await read(h);
  expect(s).toMatchObject({ tool: 'gemini', id: 'g-1', cwd: '/w/blog', title: 'fix RSS dates', lastActivityAt: min(30) });
  expect(kinds(s)).toEqual(['user', 'edit', 'agent', 'turn-end']);
  expect(s.events).toEqual([
    { kind: 'user', at: min(50), text: 'fix RSS dates' },
    { kind: 'edit', at: min(35), files: ['/w/blog/src/rss.ts'] },
    { kind: 'agent', at: min(30), text: 'Fixed the RSS dates to use UTC.' },
    { kind: 'turn-end', at: min(30) },
  ]);
  expect(s.branch).toBeUndefined();
  expect(s.partialTurn).toBeUndefined(); // the whole file is read
  expect(classify(s, NOW)).toMatchObject({ status: 'finished', detail: 'Fixed the RSS dates to use UTC.' });
});

test('maps failed and cancelled tools', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g-2', projectRoot: '/w/app', messages: [
    gm.user('run the tests', min(40)),
    gm.say('', min(30), [gm.call('run_shell_command', { command: 'npm test' }, 'error', min(30))]),
    gm.say('', min(20), [gm.call('write_file', { file_path: '/w/app/notes.md', content: 'x' }, 'cancelled', min(20))]),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(40), text: 'run the tests' },
    { kind: 'command', at: min(30), command: 'npm test', ok: false, output: '' },
    { kind: 'error', at: min(20), text: 'write_file was cancelled' },
  ]);
  // The last thing that happened was the cancelled write, so that is where the session stopped.
  expect(classify(s, NOW)).toMatchObject({ status: 'failed', detail: 'write_file was cancelled' });
});

test('skips info messages and folders without .project_root', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g-3', projectRoot: '/w/app', messages: [
    gm.info('A new version is available', min(40)), gm.user('hi', min(39)), gm.info('Switched to the fallback model', min(38)), gm.say('Hello!', min(37)),
  ] });
  // A project folder that never recorded where it lives: its chats can't be placed in any folder.
  writeGeminiSession(h, { id: 'orphan01', projectRoot: '/w/orphan', messages: [gm.user('fix the login bug', min(30))] });
  fs.rmSync(path.join(h.gemini, 'tmp', 'orphan', '.project_root'));
  const sessions = await read(h);
  expect(sessions.map((s) => s.id)).toEqual(['g-3']);
  expect(kinds(sessions[0])).toEqual(['user', 'agent', 'turn-end']);
});

// ---- the rulings

test('a cancelled call is an error whatever the tool, so a cancelled command is not a failed command', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g-4', projectRoot: '/w/app', messages: [
    gm.user('build it', min(30)),
    gm.say('', min(20), [
      gm.call('run_shell_command', { command: 'npm run build' }, 'cancelled', min(20)),
      gm.call('replace', { file_path: '/w/app/a.ts' }, 'cancelled', min(20)),
      gm.call('read_file', { file_path: '/w/app/b.ts' }, 'cancelled', min(20)),
    ]),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(30), text: 'build it' },
    { kind: 'error', at: min(20), text: 'run_shell_command was cancelled' },
    { kind: 'error', at: min(20), text: 'replace was cancelled' },
    { kind: 'error', at: min(20), text: 'read_file was cancelled' },
  ]);
  expect(classify(s, NOW)).toMatchObject({ status: 'failed', detail: 'read_file was cancelled' });
});

test("skips brb's own summary runs", async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'summary1', projectRoot: '/tmp/brb-summaries', messages: [gm.user('summarize this session', min(5)), gm.say('It fixed the login bug.', min(4))] });
  writeGeminiSession(h, { id: 'g-5', projectRoot: '/w/app', messages: [gm.user('fix the login bug', min(5))] });
  expect((await read(h)).map((s) => s.id)).toEqual(['g-5']);
});

// Chat files that sit next to a good one in the same project folder, written by hand.
const writeRawChat = (h: FakeHome, folder: string, name: string, text: string) => {
  const file = path.join(h.gemini, 'tmp', folder, 'chats', `session-2026-11-05T14-00-${name}.json`);
  fs.writeFileSync(file, text);
  fs.utimesSync(file, new Date(min(1)), new Date(min(1))); // pin the time so the file stays in the scan window on any clock
  return file;
};

test('skips a chat that is not valid JSON, as one being rewritten may be, and keeps the others', async () => {
  const h = fakeHome();
  const good = writeGeminiSession(h, { id: 'good0001', projectRoot: '/w/app', messages: [gm.user('fix the login bug', min(5)), gm.say('Done.', min(4))] });
  const whole = fs.readFileSync(good, 'utf8');
  writeRawChat(h, 'app', 'cut', whole.slice(0, whole.length - 10)); // the rewrite is half done
  writeRawChat(h, 'app', 'empty', '');
  writeRawChat(h, 'app', 'text', 'this is not a chat');
  expect((await read(h)).map((s) => s.id)).toEqual(['good0001']);
});

test('skips a chat that is JSON but not a chat with a session id', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'good0001', projectRoot: '/w/app', messages: [gm.user('fix the login bug', min(5))] });
  for (const [name, json] of Object.entries({ nul: null, list: [], num: 42, str: 'text', empty: {}, noid: { messages: [gm.user('hi', min(5))] }, numid: { sessionId: 7, messages: [] }, blankid: { sessionId: '' } })) {
    writeRawChat(h, 'app', name, JSON.stringify(json));
  }
  expect((await read(h)).map((s) => s.id)).toEqual(['good0001']);
});

// ---- which files are read

test('ignores chats that did not change in the last 7 days', async () => {
  const h = fakeHome();
  const messages = [gm.user('fix the login bug', min(30))];
  writeGeminiSession(h, { id: 'recent01', projectRoot: '/w/app', messages });
  writeGeminiSession(h, { id: 'old00001', projectRoot: '/w/old', messages, mtimeMs: NOW - 8 * DAY });
  expect((await read(h)).map((s) => s.id)).toEqual(['recent01']);

  const onlyOld = fakeHome();
  writeGeminiSession(onlyOld, { id: 'old00001', projectRoot: '/w/old', messages, mtimeMs: NOW - 8 * DAY });
  expect(await read(onlyOld)).toEqual([]);
});

test('returns nothing when there is no Gemini folder, or no project in it has a chat', async () => {
  expect(await read(fakeHome())).toEqual([]);

  const h = fakeHome();
  fs.mkdirSync(path.join(h.gemini, 'tmp'), { recursive: true });
  expect(await read(h)).toEqual([]);
  fs.mkdirSync(path.join(h.gemini, 'tmp', 'app'), { recursive: true });
  fs.writeFileSync(path.join(h.gemini, 'tmp', 'app', '.project_root'), '/w/app');
  expect(await read(h)).toEqual([]);
  fs.mkdirSync(path.join(h.gemini, 'tmp', 'app', 'chats'));
  expect(await read(h)).toEqual([]);
});

test('a Gemini folder that cannot be listed fails the whole read, so the loader can say why', async () => {
  const h = fakeHome();
  fs.mkdirSync(h.gemini, { recursive: true });
  fs.writeFileSync(path.join(h.gemini, 'tmp'), 'not a folder');
  await expect(read(h)).rejects.toThrow(/ENOTDIR/);
});

test('reads the session-*.json files that sit in a chats folder, and only those', async () => {
  const h = fakeHome();
  const file = writeGeminiSession(h, { id: 'a0000001', projectRoot: '/w/app', messages: [gm.user('one', min(5))] });
  writeGeminiSession(h, { id: 'b0000002', projectRoot: '/w/blog', messages: [gm.user('two', min(5))] });
  const chats = path.dirname(file);
  const copy = (to: string) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file, to);
  };
  copy(path.join(chats, 'notes.json'));
  copy(path.join(chats, 'session-2026-11-05T14-00-copy.jsonl'));
  copy(path.join(chats, 'checkpoint-2026-11-05T14-00.json'));
  copy(path.join(chats, 'a0000001', 'session-in-a-folder.json')); // a folder inside chats
  copy(path.join(path.dirname(chats), 'session-beside-chats.json'));
  copy(path.join(path.dirname(chats), 'other', 'session-in-another-folder.json'));
  copy(path.join(h.gemini, 'tmp', 'session-in-tmp.json')); // not in a project folder at all
  copy(path.join(h.gemini, 'session-in-root.json'));
  // Each copy says it is session a0000001, so any of them being read would list it twice.
  expect((await read(h)).map((s) => s.id).sort()).toEqual(['a0000001', 'b0000002']);
});

// ---- who and where

test('takes the folder from .project_root, without the whitespace around it', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [gm.user('fix the login bug', min(5))] });
  fs.writeFileSync(path.join(h.gemini, 'tmp', 'app', '.project_root'), '  /w/app-checkout \n');
  expect((await read(h))[0].cwd).toBe('/w/app-checkout');
});

test('skips a project whose .project_root has nothing in it', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [gm.user('fix the login bug', min(5))] });
  writeGeminiSession(h, { id: 'g0000002', projectRoot: '/w/blog', messages: [gm.user('fix the RSS dates', min(5))] });
  fs.writeFileSync(path.join(h.gemini, 'tmp', 'app', '.project_root'), ' \n');
  fs.writeFileSync(path.join(h.gemini, 'tmp', 'blog', '.project_root'), '');
  expect(await read(h)).toEqual([]);
});

test('reads every chat of every project', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'a0000001', projectRoot: '/w/app', messages: [gm.user('first chat', min(50))] });
  writeGeminiSession(h, { id: 'a0000002', projectRoot: '/w/app', messages: [gm.user('second chat', min(5))] });
  writeGeminiSession(h, { id: 'b0000001', projectRoot: '/w/blog', messages: [gm.user('a chat in the blog', min(5))] });
  const sessions = await read(h);
  expect(sessions.map((s) => [s.id, s.cwd]).sort()).toEqual([['a0000001', '/w/app'], ['a0000002', '/w/app'], ['b0000001', '/w/blog']]);
  expect(byId(sessions, 'a0000002').title).toBe('second chat');
});

// ---- titles

test('names a session by its first prompt that has words, cleaned and cut to 60 characters', async () => {
  const h = fakeHome();
  const chat = (id: string, messages: object[]) => writeGeminiSession(h, { id, projectRoot: `/w/${id}`, messages, mtimeMs: min(1) });
  chat('plain', [gm.user('first prompt', min(30)), gm.user('second prompt', min(29))]);
  chat('messy', [gm.user('fix the\n\x1b[31mlogin\x1b[0m bug', min(30))]);
  chat('long', [gm.user('a'.repeat(100), min(30))]);
  chat('blankfirst', [gm.user('   ', min(30)), gm.user('the real prompt', min(29))]);
  chat('info', [gm.info('A new version is available', min(30)), gm.user('after the notice', min(29))]);
  chat('parts', [{ ...gm.user('', min(30)), content: [{ text: 'first part' }, { text: 'second part' }] }]);
  chat('agentonly', [gm.say('hello', min(30))]);
  chat('nomessages', []);
  const sessions = await read(h);
  expect(byId(sessions, 'plain').title).toBe('first prompt');
  expect(byId(sessions, 'messy').title).toBe('fix the login bug');
  expect(byId(sessions, 'long').title).toBe('a'.repeat(59) + '…');
  expect(byId(sessions, 'blankfirst').title).toBe('the real prompt');
  expect(byId(sessions, 'info').title).toBe('after the notice');
  expect(byId(sessions, 'parts').title).toBe('first part second part');
  expect(byId(sessions, 'agentonly').title).toBe('untitled session');
  expect(byId(sessions, 'nomessages').title).toBe('untitled session');
});

// ---- what each message becomes

test('turns a chat into its events in time order, with equal times keeping the order they were written in', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.say('first reply', min(5)),
    gm.say('second reply', min(5)),
    gm.user('later in the file, earlier in time', min(10)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'later in the file, earlier in time' },
    { kind: 'agent', at: min(5), text: 'first reply' },
    { kind: 'turn-end', at: min(5) },
    { kind: 'agent', at: min(5), text: 'second reply' },
    { kind: 'turn-end', at: min(5) },
  ]);
  expect(s.lastActivityAt).toBe(min(5));
});

test('a message with tool calls has not ended its turn, and one with none has', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('fix it', min(30)),
    // A message's tool calls become events before its words do.
    gm.say('Fixing it.', min(20), [gm.call('replace', { file_path: '/w/app/a.ts' }, 'success', min(20))]),
    gm.say('Now the tests.', min(10), []), // an empty list is no tool calls
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(30), text: 'fix it' },
    { kind: 'edit', at: min(20), files: ['/w/app/a.ts'] },
    { kind: 'agent', at: min(20), text: 'Fixing it.' },
    { kind: 'agent', at: min(10), text: 'Now the tests.' },
    { kind: 'turn-end', at: min(10) },
  ]);
});

// A message with whatever `content` a test wants, which the gm builders only build in their usual shape.
const message = (type: string, content: unknown, at: number) => ({ id: `x${at}`, timestamp: iso(at), type, content });

test('joins the text parts of a message, and reads a message that is a plain string', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    message('user', [{ text: 'first part' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'second part' }], min(10)),
    message('user', 'a plain string', min(9)),
    message('gemini', [{ text: 'one' }, null, 'stray', { text: 'two' }], min(8)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'first part\nsecond part' },
    { kind: 'user', at: min(9), text: 'a plain string' },
    { kind: 'agent', at: min(8), text: 'one\ntwo' },
    { kind: 'turn-end', at: min(8) },
  ]);
});

test('ignores messages with no words, though a reply with none still ends its turn', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    message('user', '', min(10)), message('user', '  \n', min(9)), message('user', [], min(8)), message('user', [{ text: '' }], min(7)),
    message('user', null, min(6)), message('user', 5, min(5)), { id: 'x', timestamp: iso(min(4)), type: 'user' },
    gm.user('fix the login bug', min(3)),
    gm.say('   ', min(2)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(3), text: 'fix the login bug' },
    { kind: 'turn-end', at: min(2) },
  ]);
});

test('turns the tools that write files into edits when the call succeeded, and other tools into nothing', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('fix it', min(30)),
    gm.say('', min(20), [
      gm.call('replace', { file_path: '/w/app/a.ts' }, 'success', min(20)),
      gm.call('write_file', { file_path: '/w/app/b.ts', content: 'x' }, 'success', min(20)),
      gm.call('edit', { file_path: '/w/app/c.ts' }, 'success', min(20)),
      gm.call('replace', { file_path: '/w/app/failed.ts' }, 'error', min(20)),
      gm.call('write_file', { file_path: '/w/app/also-failed.ts' }, 'error', min(20)),
      { ...gm.call('replace', { file_path: '/w/app/pending.ts' }, 'success', min(20)), status: 'awaiting_approval' },
      gm.call('read_file', { file_path: '/w/app/read.ts' }, 'success', min(20)),
      gm.call('list_directory', { dir_path: '/w/app' }, 'success', min(20)),
      gm.call('web_fetch', { prompt: 'look it up' }, 'error', min(20)),
    ]),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(30), text: 'fix it' },
    { kind: 'edit', at: min(20), files: ['/w/app/a.ts'] },
    { kind: 'edit', at: min(20), files: ['/w/app/b.ts'] },
    { kind: 'edit', at: min(20), files: ['/w/app/c.ts'] },
  ]);
});

test('makes an edit\'s path absolute from the project folder, and ignores an edit that names no file', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('fix it', min(30)),
    gm.say('', min(20), [
      gm.call('replace', { file_path: 'src/a.ts' }, 'success', min(20)),
      gm.call('write_file', { file_path: './b.ts', content: 'x' }, 'success', min(20)),
      gm.call('edit', { file_path: '/w/other/c.ts' }, 'success', min(20)),
      gm.call('replace', { file_path: '../shared/d.ts' }, 'success', min(20)),
      gm.call('replace', { file_path: '' }, 'success', min(20)),
      gm.call('replace', { file_path: 7 }, 'success', min(20)),
      gm.call('replace', {}, 'success', min(20)),
      { ...gm.call('replace', {}, 'success', min(20)), args: 'src/e.ts' },
    ]),
  ] });
  const [s] = await read(h);
  expect(s.events.slice(1)).toEqual([
    { kind: 'edit', at: min(20), files: ['/w/app/src/a.ts'] },
    { kind: 'edit', at: min(20), files: ['/w/app/b.ts'] },
    { kind: 'edit', at: min(20), files: ['/w/other/c.ts'] },
    { kind: 'edit', at: min(20), files: ['/w/shared/d.ts'] },
  ]);
});

test('a command is ok only when its call succeeded, and one with no command text is ignored', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('check it', min(30)),
    gm.say('', min(20), [
      gm.call('run_shell_command', { command: 'npm test' }, 'success', min(20)),
      gm.call('run_shell_command', { command: 'npm run lint' }, 'error', min(20)),
      { ...gm.call('run_shell_command', { command: 'sleep 99' }, 'success', min(20)), status: 'executing' },
      { ...gm.call('run_shell_command', { command: 'echo hi' }, 'success', min(20)), status: undefined },
      gm.call('run_shell_command', { command: '  ' }, 'success', min(20)),
      gm.call('run_shell_command', { command: 5 }, 'success', min(20)),
      gm.call('run_shell_command', {}, 'success', min(20)),
      { ...gm.call('run_shell_command', {}, 'success', min(20)), args: undefined },
    ]),
  ] });
  const [s] = await read(h);
  expect(s.events.slice(1)).toEqual([
    { kind: 'command', at: min(20), command: 'npm test', ok: true, output: '' },
    { kind: 'command', at: min(20), command: 'npm run lint', ok: false, output: '' },
    { kind: 'command', at: min(20), command: 'sleep 99', ok: false, output: '' },
    { kind: 'command', at: min(20), command: 'echo hi', ok: false, output: '' },
  ]);
});

test('a tool call takes the time it finished, so events sort in the order things happened', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('fix it', min(30)),
    gm.say('Let me fix that.', min(20), [
      gm.call('run_shell_command', { command: 'npm test' }, 'success', min(12)), // listed before the edit, but it finished after
      gm.call('replace', { file_path: '/w/app/a.ts' }, 'success', min(15)),
    ]),
    gm.say('All done.', min(10)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(30), text: 'fix it' },
    { kind: 'agent', at: min(20), text: 'Let me fix that.' },
    { kind: 'edit', at: min(15), files: ['/w/app/a.ts'] },
    { kind: 'command', at: min(12), command: 'npm test', ok: true, output: '' },
    { kind: 'agent', at: min(10), text: 'All done.' },
    { kind: 'turn-end', at: min(10) },
  ]);
});

test('a tool call that has no usable time of its own takes the time of its message', async () => {
  const h = fakeHome();
  const edit = (file: string) => gm.call('write_file', { file_path: file, content: 'x' }, 'success', 0);
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('fix it', min(30)),
    gm.say('Writing two files.', min(20), [
      { ...edit('/w/app/a.ts'), timestamp: undefined },
      { ...edit('/w/app/b.ts'), timestamp: 'later' },
      { ...edit('/w/app/c.ts'), timestamp: 5 },
    ]),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(30), text: 'fix it' },
    { kind: 'edit', at: min(20), files: ['/w/app/a.ts'] },
    { kind: 'edit', at: min(20), files: ['/w/app/b.ts'] },
    { kind: 'edit', at: min(20), files: ['/w/app/c.ts'] },
    { kind: 'agent', at: min(20), text: 'Writing two files.' }, // the calls of a message come before its words
  ]);
});

test('a cancelled call that comes after its message\'s words is where the turn stopped', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('run the build', min(30)),
    gm.say('Running the build.', min(20), [gm.call('run_shell_command', { command: 'npm run build' }, 'cancelled', min(19))]),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'agent', 'error']);
  expect(classify(s, NOW)).toMatchObject({ status: 'failed', detail: 'run_shell_command was cancelled' });
});

test('ignores a message with no usable time, together with its tool calls', async () => {
  const h = fakeHome();
  const noTime = (m: object) => ({ ...m, timestamp: undefined });
  const badTime = (m: object) => ({ ...m, timestamp: 'yesterday' });
  const numberTime = (m: object) => ({ ...m, timestamp: 5 });
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('fix the login bug', min(10)),
    noTime(gm.say('lost in time', min(9), [gm.call('replace', { file_path: '/w/app/lost.ts' }, 'success', min(9))])),
    badTime(gm.say('also lost', min(8))), numberTime(gm.user('lost too', min(7))), noTime(gm.say('', min(6))),
    gm.say('Done.', min(5)),
  ], mtimeMs: min(1) });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'fix the login bug' },
    { kind: 'agent', at: min(5), text: 'Done.' },
    { kind: 'turn-end', at: min(5) },
  ]);
});

test('messages and tool calls of the wrong shape are ignored, and never fail the read', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'good0001', projectRoot: '/w/app', messages: [gm.user('a chat that is fine', min(20))] });
  const at = iso(min(9));
  const calls: unknown[] = [
    null, 7, 'replace', [], {}, { name: 5, status: 'success' }, { name: '', status: 'cancelled' },
    { name: 'replace' }, { name: 'replace', status: 'success' }, { name: 'replace', status: 'success', args: null },
    { name: 'run_shell_command', status: 'success' }, { name: 'run_shell_command', status: 'error', args: [] },
  ];
  const messages: unknown[] = [
    null, 7, 'a string', [], {}, { timestamp: at }, { type: 'user' }, { type: 'gemini' },
    { timestamp: at, type: 'user', content: { text: 'a part that is not in a list' } },
    gm.user('fix the login bug', min(10)),
    { timestamp: at, type: 'gemini', content: 'On it.', toolCalls: 'not a list' }, // no list of calls, so it asked for none
    { timestamp: iso(min(8)), type: 'gemini', content: '', toolCalls: calls }, // calls that say nothing usable
    gm.say('Done.', min(7)),
  ];
  writeRawChat(h, 'app', 'junk0001', JSON.stringify({ sessionId: 'junk0001', messages }));
  writeRawChat(h, 'app', 'nolist01', JSON.stringify({ sessionId: 'nolist01', messages: { not: 'a list' } }));
  const sessions = await read(h);
  const junk = byId(sessions, 'junk0001');
  expect(junk.title).toBe('fix the login bug');
  expect(junk.events.map((e) => e.kind)).toEqual(['user', 'agent', 'turn-end', 'agent', 'turn-end']);
  expect(byId(sessions, 'nolist01')).toMatchObject({ events: [], title: 'untitled session', lastActivityAt: min(1) });
});

test('ignores the kinds of message brb does not read, whatever they say', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('fix the login bug', min(10)),
    message('info', 'A new version is available', min(9)), message('warning', 'The model is slow', min(8)),
    message('error', 'API Error: the request failed', min(7)), message('sparkle', 'a kind nobody has heard of', min(6)),
    gm.say('Done.', min(5)),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'agent', 'turn-end']);
});

test('a session with no events keeps the time its file last changed', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'quiet001', projectRoot: '/w/app', messages: [gm.info('A new version is available', min(40))], mtimeMs: min(30) });
  const [s] = await read(h);
  expect(s).toMatchObject({ title: 'untitled session', events: [], lastActivityAt: min(30) });
});

// ---- the status each kind of session reads as

test('a chat that ended after a failed command stopped there, and says which command', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'g0000001', projectRoot: '/w/app', messages: [
    gm.user('run the tests', min(30)),
    gm.say('', min(25), [gm.call('run_shell_command', { command: 'npm test' }, 'error', min(25))]),
    gm.say('The tests fail.', min(20)),
  ] });
  const [s] = await read(h);
  expect(classify(s, NOW)).toMatchObject({ status: 'failed', detail: 'npm test failed' }); // the adapter keeps no command output, so the detail is the command
});

test('a chat that only asked a question is waiting, and one that stopped mid-turn is idle', async () => {
  const h = fakeHome();
  writeGeminiSession(h, { id: 'asks0001', projectRoot: '/w/asks', messages: [gm.user('make it faster', min(30)), gm.say('Which part is slow, the build or the tests?', min(20))] });
  writeGeminiSession(h, { id: 'idle0001', projectRoot: '/w/idle', messages: [gm.user('look around', min(30)), gm.say('', min(20), [gm.call('read_file', { file_path: '/w/idle/a.ts' }, 'success', min(20))])] });
  const sessions = await read(h);
  expect(classify(byId(sessions, 'asks0001'), NOW)).toMatchObject({ status: 'waiting', detail: 'asks: "Which part is slow, the build or the tests?"' });
  expect(classify(byId(sessions, 'idle0001'), NOW).status).toBe('idle');
});
