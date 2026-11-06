import * as fs from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { readCodexSessions } from '../../src/adapters/codex';
import { SCAN_MS } from '../../src/adapters/files';
import { cx, makeFakeHome, writeCodexSession } from '../support/fake-home';
import type { FakeHome } from '../support/fake-home';

// Lets a test act at the moment the reader reads a file: after the file was listed and its time was read.
const reader = vi.hoisted(() => ({ beforeRead: (_file: string): void => {} }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    // async, so that a hook that throws is a rejected read, which is how a real read fails
    readFile: async (...args: Parameters<typeof real.readFile>) => {
      reader.beforeRead(String(args[0]));
      return real.readFile(...args);
    },
  };
});

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;
const read = (h: FakeHome) => readCodexSessions(h.codex, { now: NOW, sinceMs: NOW - SCAN_MS });

const homes: FakeHome[] = [];
afterEach(() => {
  reader.beforeRead = () => {};
  for (const h of homes.splice(0)) fs.rmSync(h.home, { recursive: true, force: true });
});
const twoSessions = () => {
  const h = makeFakeHome();
  homes.push(h);
  writeCodexSession(h, { id: 'stays', threadName: 'a name', lines: [cx.meta('stays', '/w/a', min(5)), cx.user('fix the login bug', min(5))] });
  const goes = writeCodexSession(h, { id: 'goes', lines: [cx.meta('goes', '/w/b', min(5)), cx.user('fix the logout bug', min(5))] });
  return { h, goes };
};
const denied = (file: string) => Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' });

test('a file that vanishes before it is read loses only its own session', async () => {
  const { h, goes } = twoSessions();
  reader.beforeRead = (file) => {
    if (file === goes) fs.rmSync(file);
  };
  expect((await read(h)).map((s) => s.id)).toEqual(['stays']);
});

test('a file that cannot be read for any other reason still fails the whole read', async () => {
  const { h, goes } = twoSessions();
  reader.beforeRead = (file) => {
    if (file === goes) throw denied(file);
  };
  await expect(read(h)).rejects.toThrow(/EACCES/);
});

test('an index that cannot be read for any other reason also fails the whole read', async () => {
  const { h } = twoSessions();
  reader.beforeRead = (file) => {
    if (file.endsWith('session_index.jsonl')) throw denied(file);
  };
  await expect(read(h)).rejects.toThrow(/EACCES/);
});

test('an index that is missing, or vanishes as it is read, only means no thread names', async () => {
  const { h } = twoSessions();
  reader.beforeRead = (file) => {
    if (file.endsWith('session_index.jsonl')) fs.rmSync(file);
  };
  const sessions = await read(h);
  expect(sessions.map((s) => s.id).sort()).toEqual(['goes', 'stays']);
  expect(sessions.find((s) => s.id === 'stays')?.title).toBe('fix the login bug'); // not 'a name': the index was gone
});
