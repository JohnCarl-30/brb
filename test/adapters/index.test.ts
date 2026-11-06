import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { loadAllSessions, resolveRoots } from '../../src/adapters/index';
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
