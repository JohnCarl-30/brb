import * as fs from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { readClaudeSessions } from '../../src/adapters/claude';
import { SCAN_MS } from '../../src/adapters/files';
import { cl, makeFakeHome, writeClaudeSession } from '../support/fake-home';
import type { FakeHome } from '../support/fake-home';

// Lets a test act at the moment the reader opens a file: after the file was listed and its time was read.
const reader = vi.hoisted(() => ({ beforeOpen: (_file: string): void => {} }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    open: (...args: Parameters<typeof real.open>) => {
      reader.beforeOpen(String(args[0]));
      return real.open(...args);
    },
  };
});

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;
const read = (h: FakeHome) => readClaudeSessions(h.claude, { now: NOW, sinceMs: NOW - SCAN_MS });

const homes: FakeHome[] = [];
afterEach(() => {
  reader.beforeOpen = () => {};
  for (const h of homes.splice(0)) fs.rmSync(h.home, { recursive: true, force: true });
});
const twoSessions = () => {
  const h = makeFakeHome();
  homes.push(h);
  writeClaudeSession(h, { id: 'stays', cwd: '/w/a', lines: [cl.user('fix the login bug', min(5))] });
  writeClaudeSession(h, { id: 'goes', cwd: '/w/b', lines: [cl.user('fix the logout bug', min(5))] });
  return h;
};

test('a file that vanishes before it is opened loses only its own session', async () => {
  const h = twoSessions();
  reader.beforeOpen = (file) => {
    if (file.endsWith('goes.jsonl')) fs.rmSync(file);
  };
  expect((await read(h)).map((s) => s.id)).toEqual(['stays']);
});

test('a file that cannot be opened for any other reason still fails the whole read', async () => {
  const h = twoSessions();
  reader.beforeOpen = (file) => {
    if (file.endsWith('goes.jsonl')) throw Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' });
  };
  await expect(read(h)).rejects.toThrow(/EACCES/);
});
