import * as fs from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { SCAN_MS } from '../../src/adapters/files';
import { readKiroSessions, readSession } from '../../src/adapters/kiro';
import { classify } from '../../src/classify';
import type { Session } from '../../src/types';
import { kr, makeFakeHome, writeKiroSession } from '../support/fake-home';
import type { FakeHome } from '../support/fake-home';

const NOW = Date.UTC(2026, 10, 9, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;
const DAY = 86_400_000;

const read = (h: FakeHome) => readKiroSessions(h.kiro, { now: NOW, sinceMs: NOW - SCAN_MS });
const kinds = (s: Session) => s.events.map((e) => e.kind);

const homes: FakeHome[] = [];
const fakeHome = () => {
  const h = makeFakeHome();
  homes.push(h);
  return h;
};
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h.home, { recursive: true, force: true });
});

test('reads a finished session: its title, prompt, edit, command and reply, without the reasoning', async () => {
  const h = fakeHome();
  writeKiroSession(h, { id: 'k-1', cwd: '/w/shop', title: 'Fix cart totals', lines: [
    kr.user('the cart total is off by one', min(50)),
    kr.think('Let me look at the cart.', min(49)),
    kr.call('c1', 'str_replace', 'edit', { path: 'src/cart.ts', oldStr: 'a', newStr: 'b' }, min(45)),
    kr.result('c1', 'ok', true, min(45)),
    kr.call('c2', 'execute_bash', 'execute', { command: 'npm test' }, min(40)),
    kr.result('c2', '12 passed', true, min(40)),
    kr.say('Fixed the off-by-one in the cart total.', min(30)),
    kr.end(min(30)),
  ] });
  const [s] = await read(h);
  expect(s).toMatchObject({ tool: 'kiro', id: 'k-1', cwd: '/w/shop', title: 'Fix cart totals', lastActivityAt: min(30) });
  expect(kinds(s)).toEqual(['user', 'edit', 'command', 'agent', 'turn-end']);
  expect(s.events[1]).toEqual({ kind: 'edit', at: min(45), files: ['/w/shop/src/cart.ts'] });
  expect(s.events[2]).toEqual({ kind: 'command', at: min(40), command: 'npm test', ok: true, output: '12 passed' });
  expect(classify(s, NOW).status).toBe('finished');
});

test('a failed command at the end of a turn makes the session failed', async () => {
  const h = fakeHome();
  writeKiroSession(h, { id: 'k-1', cwd: '/w/shop', lines: [
    kr.user('run the build', min(20)),
    kr.call('c1', 'runCommand', 'execute', { command: 'npm run build', cwd: '/w/shop' }, min(15)),
    kr.result('c1', 'Error: cannot find module ./cart', false, min(15)),
    kr.say('The build failed.', min(14)),
    kr.end(min(14)),
  ] });
  const [s] = await read(h);
  expect(s.events.find((e) => e.kind === 'command')).toMatchObject({ ok: false, command: 'npm run build' });
  expect(classify(s, NOW).status).toBe('failed');
});

test('an edit that was denied or failed changed nothing', async () => {
  const h = fakeHome();
  writeKiroSession(h, { id: 'k-1', cwd: '/w/shop', lines: [
    kr.user('write the file', min(20)),
    kr.call('c1', 'fs_write', 'edit', { path: '/w/shop/a.ts', text: 'x' }, min(15)),
    kr.result('c1', 'denied by user', false, min(15)),
    kr.end(min(14)),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'turn-end']);
});

test('a move names both files and a delete names its target', async () => {
  const h = fakeHome();
  writeKiroSession(h, { id: 'k-1', cwd: '/w/shop', lines: [
    kr.user('tidy up', min(20)),
    kr.call('c1', 'smart_relocate', 'move', { sourcePath: 'a.ts', destinationPath: 'lib/a.ts' }, min(15)),
    kr.result('c1', 'moved', true, min(15)),
    kr.call('c2', 'delete_file', 'delete', { targetFile: '/w/shop/old.ts' }, min(14)),
    kr.result('c2', 'deleted', true, min(14)),
    kr.end(min(13)),
  ] });
  const [s] = await read(h);
  expect(s.events.filter((e) => e.kind === 'edit').map((e) => e.kind === 'edit' && e.files)).toEqual([
    ['/w/shop/a.ts', '/w/shop/lib/a.ts'], ['/w/shop/old.ts'],
  ]);
});

test('a permission prompt still open makes the session waiting; an answered one does not', async () => {
  const h = fakeHome();
  writeKiroSession(h, { id: 'open', cwd: '/w/shop', lines: [
    kr.user('deploy it', min(10)),
    kr.call('c1', 'execute_bash', 'execute', { command: 'vercel deploy' }, min(9)),
    kr.ask('c1', 'Run vercel deploy?', min(9)),
  ] });
  writeKiroSession(h, { id: 'done', cwd: '/w/shop', lines: [
    kr.user('deploy it', min(10)),
    kr.call('c1', 'execute_bash', 'execute', { command: 'vercel deploy' }, min(9)),
    kr.ask('c1', 'Run vercel deploy?', min(9)),
    kr.answered('c1', min(8)),
    kr.result('c1', 'deployed', true, min(7)),
    kr.say('Deployed.', min(6)),
    kr.end(min(6)),
  ] });
  const sessions = await read(h);
  const open = sessions.find((s) => s.id === 'open')!;
  const done = sessions.find((s) => s.id === 'done')!;
  expect(classify(open, NOW)).toMatchObject({ status: 'waiting', detail: 'asks: "Run vercel deploy?"' });
  expect(classify(done, NOW).status).toBe('finished');
});

test('a cancelled turn reads as interrupted, and an error stop as failed', async () => {
  const h = fakeHome();
  writeKiroSession(h, { id: 'k-1', cwd: '/w/shop', lines: [kr.user('go', min(10)), kr.end(min(9), 'cancelled')] });
  writeKiroSession(h, { id: 'k-2', cwd: '/w/shop', lines: [kr.user('go', min(10)), kr.end(min(9), 'error')] });
  const sessions = await read(h);
  expect(classify(sessions.find((s) => s.id === 'k-1')!, NOW)).toMatchObject({ status: 'failed', detail: 'interrupted' });
  expect(classify(sessions.find((s) => s.id === 'k-2')!, NOW)).toMatchObject({ status: 'failed', detail: 'Kiro stopped with an error' });
});

test('skips a session outside any workspace, an old one, and a folder without session.json', async () => {
  const h = fakeHome();
  writeKiroSession(h, { id: 'global', cwd: null, lines: [kr.user('hi', min(10))] });
  writeKiroSession(h, { id: 'old', cwd: '/w/shop', lines: [kr.user('hi', NOW - 8 * DAY)] });
  const orphan = writeKiroSession(h, { id: 'orphan', cwd: '/w/shop', lines: [kr.user('hi', min(10))] });
  fs.rmSync(orphan.replace('messages.jsonl', 'session.json'));
  expect(await read(h)).toEqual([]);
});

test('a big file is read as head and tail; a recap reads it whole', async () => {
  const h = fakeHome();
  const file = writeKiroSession(h, { id: 'k-1', cwd: '/w/shop', filler: 200_000, lines: [
    kr.user('refactor the cart', min(50)),
    kr.say('Done refactoring.', min(10)),
    kr.end(min(10)),
  ] });
  const [s] = await read(h);
  expect(s.partialTurn).toBe(true); // the prompt that started the last turn was in the head, not the tail
  expect(kinds(s)).toEqual(['user', 'agent', 'turn-end']);
  const whole = await readSession({ path: file, mtimeMs: 0 }, true);
  expect(whole?.partialTurn).toBeUndefined();
});
