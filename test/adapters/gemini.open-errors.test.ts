import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { SCAN_MS } from '../../src/adapters/files';
import { readGeminiSessions } from '../../src/adapters/gemini';
import { gm, makeFakeHome, writeGeminiSession } from '../support/fake-home';
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
const DAY = 86_400_000;
const read = (h: FakeHome) => readGeminiSessions(h.gemini, { now: NOW, sinceMs: NOW - SCAN_MS });

const homes: FakeHome[] = [];
afterEach(() => {
  reader.beforeRead = () => {};
  for (const h of homes.splice(0)) fs.rmSync(h.home, { recursive: true, force: true });
});
// Two projects with a chat each. `goes` is the one a test breaks, `stays` the one that must come through.
const twoSessions = () => {
  const h = makeFakeHome();
  homes.push(h);
  writeGeminiSession(h, { id: 'stays', projectRoot: '/w/a', messages: [gm.user('fix the login bug', min(5))] });
  const goesChat = writeGeminiSession(h, { id: 'goes', projectRoot: '/w/b', messages: [gm.user('fix the logout bug', min(5))] });
  const goesRoot = path.join(h.gemini, 'tmp', 'b', '.project_root');
  return { h, goesChat, goesRoot };
};
const denied = (file: string) => Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' });

test('a chat that vanishes before it is read loses only its own session', async () => {
  const { h, goesChat } = twoSessions();
  reader.beforeRead = (file) => {
    if (file === goesChat) fs.rmSync(file);
  };
  expect((await read(h)).map((s) => s.id)).toEqual(['stays']);
});

test('a chat that cannot be read for any other reason still fails the whole read', async () => {
  const { h, goesChat } = twoSessions();
  reader.beforeRead = (file) => {
    if (file === goesChat) throw denied(file);
  };
  await expect(read(h)).rejects.toThrow(/EACCES/);
});

test('a .project_root that vanishes before it is read loses only its own project', async () => {
  const { h, goesRoot } = twoSessions();
  reader.beforeRead = (file) => {
    if (file === goesRoot) fs.rmSync(file);
  };
  expect((await read(h)).map((s) => s.id)).toEqual(['stays']);
});

test('a .project_root that cannot be read for any other reason still fails the whole read', async () => {
  const { h, goesRoot } = twoSessions();
  reader.beforeRead = (file) => {
    if (file === goesRoot) throw denied(file);
  };
  await expect(read(h)).rejects.toThrow(/EACCES/);
});

test('a project with no recent chat never has its .project_root read', async () => {
  const h = makeFakeHome();
  homes.push(h);
  writeGeminiSession(h, { id: 'old00001', projectRoot: '/w/old', messages: [gm.user('fix the login bug', min(5))], mtimeMs: NOW - 8 * DAY });
  reader.beforeRead = (file) => {
    if (file.endsWith('.project_root')) throw denied(file);
  };
  expect(await read(h)).toEqual([]);
});
