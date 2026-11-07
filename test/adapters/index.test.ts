import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { loadAllSessions, readSessionFile, resolveRoots } from '../../src/adapters/index';
import { cl, cx, gm, makeFakeHome, writeClaudeSession, writeCodexSession, writeGeminiSession } from '../support/fake-home';
import type { FakeHome } from '../support/fake-home';

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;

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
const roots = (h: FakeHome) => ({ claude: h.claude, codex: h.codex, gemini: h.gemini, brb: h.brb });

test('resolveRoots defaults to folders under home, and the env overrides win', () => {
  expect(resolveRoots({ HOME: '/h' })).toEqual({ claude: '/h/.claude', codex: '/h/.codex', gemini: '/h/.gemini', brb: '/h/.brb' });
  expect(resolveRoots({ HOME: '/h', CLAUDE_CONFIG_DIR: '/c', CODEX_HOME: '/x', BRB_HOME: '/b' }))
    .toEqual({ claude: '/c', codex: '/x', gemini: '/h/.gemini', brb: '/b' });
});

test('missing tools are silent', async () => {
  expect(await loadAllSessions(roots(fakeHome()), NOW)).toEqual({ sessions: [], warnings: [] });
});

test('loads the sessions of every tool', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/a', lines: [cl.user('fix the login bug', min(5))] });
  writeCodexSession(h, { id: 'x1', lines: [cx.meta('x1', '/w/b', min(6)), cx.user('add a rate limiter', min(6))] });
  writeGeminiSession(h, { id: 'g-1', projectRoot: '/w/c', messages: [gm.user('fix RSS dates', min(7))] });
  const { sessions, warnings } = await loadAllSessions(roots(h), NOW);
  expect(sessions.map((s) => `${s.tool}:${s.id}`).sort()).toEqual(['claude:c1', 'codex:x1', 'gemini:g-1']);
  expect(warnings).toEqual([]);
});

test("keeps going when one tool's folder is broken", async () => {
  const h = fakeHome();
  fs.mkdirSync(h.codex, { recursive: true });
  fs.writeFileSync(path.join(h.codex, 'sessions'), 'not a folder'); // readdir gives ENOTDIR
  writeClaudeSession(h, { id: 'c1', cwd: '/w/a', lines: [cl.user('fix the login bug', min(5))] });
  const { sessions, warnings } = await loadAllSessions(roots(h), NOW);
  expect(sessions.map((s) => s.id)).toEqual(['c1']);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toMatch(/^Couldn't read Codex sessions: /);
});

test('every session knows the file it came from', async () => {
  const h = fakeHome();
  const files = [
    writeClaudeSession(h, { id: 'c1', cwd: '/w/a', lines: [cl.user('fix the login bug', min(5))] }),
    writeCodexSession(h, { id: 'x1', lines: [cx.meta('x1', '/w/b', min(6)), cx.user('add a rate limiter', min(6))] }),
    writeGeminiSession(h, { id: 'g-1', projectRoot: '/w/c', messages: [gm.user('fix RSS dates', min(7))] }),
  ];
  const { sessions } = await loadAllSessions(roots(h), NOW);
  expect(sessions.map((s) => s.file).sort()).toEqual([...files].sort());
});

test('readSessionFile reads a whole Claude session, past the head and tail window', async () => {
  const h = fakeHome();
  const big = (n: number, at: number) => cl.result('pad', 'x'.repeat(n), at);
  const file = writeClaudeSession(h, { id: 'c1', cwd: '/w/a', lines: [
    cl.user('start', min(9)), big(50_000, min(9)), cl.user('middle prompt', min(8)), big(100_000, min(8)), cl.user('end', min(7)),
  ] });
  const listed = (await loadAllSessions(roots(h), NOW)).sessions[0];
  expect(listed.events.some((e) => e.kind === 'user' && e.text === 'middle prompt')).toBe(false); // the list only reads head and tail
  const s = await readSessionFile('claude', file, '/w/a');
  expect(s?.events.some((e) => e.kind === 'user' && e.text === 'middle prompt')).toBe(true);
  expect(s?.partialTurn).toBeUndefined();
  expect(s?.file).toBe(file);
});

test('readSessionFile reads Codex and Gemini sessions too', async () => {
  const h = fakeHome();
  const codex = writeCodexSession(h, { id: '11111111-2222-3333-4444-555555555555', lines: [cx.meta('11111111-2222-3333-4444-555555555555', '/w/b', min(6)), cx.user('add a rate limiter', min(6))] });
  const gemini = writeGeminiSession(h, { id: 'g-1', projectRoot: '/w/c', messages: [gm.user('fix RSS dates', min(7))] });
  expect((await readSessionFile('codex', codex, '/w/b'))?.title).toBe('add a rate limiter');
  expect((await readSessionFile('gemini', gemini, '/w/c'))?.cwd).toBe('/w/c');
});
