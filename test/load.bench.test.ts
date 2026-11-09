import * as fs from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { loadAllSessions } from '../src/adapters/index';
import { cl, makeFakeHome, writeClaudeSession } from './support/fake-home';

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;

const h = makeFakeHome();
afterAll(() => fs.rmSync(h.home, { recursive: true, force: true }));

// Run with `npm run bench`. The default test run leaves it out.
test('loads 100 projects of long history in under a second', async () => {
  for (let i = 0; i < 100; i++) {
    writeClaudeSession(h, { id: `s${i}`, cwd: `/w/project-${i}`, filler: 1_000_000, lines: [
      cl.user('fix the login bug', min(60)), cl.say('Fixed it.', min(50))] });
  }
  const started = performance.now();
  const { sessions, warnings } = await loadAllSessions({ claude: h.claude, codex: h.codex, gemini: h.gemini, kiro: h.kiro, brb: h.brb }, NOW);
  const elapsed = performance.now() - started;
  console.log(`loadAllSessions: ${elapsed.toFixed(0)} ms for ${sessions.length} sessions`);
  expect(sessions).toHaveLength(100);
  expect(warnings).toEqual([]);
  expect(elapsed).toBeLessThan(1000);
}, 60_000);
