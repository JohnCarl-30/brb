import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, test, vi } from 'vitest';
import { run } from '../src/cli';
import * as git from '../src/git';
import { NOW } from './support/expected';
import { cl, makeFakeHome, writeClaudeSession } from './support/fake-home';

// A status line runs --count every few seconds, so it must not pay for git.
vi.mock('../src/git', { spy: true });

const h = makeFakeHome();
afterAll(() => fs.rmSync(h.home, { recursive: true, force: true }));

test('--count never runs git, and the full catch-up still does', async () => {
  writeClaudeSession(h, { id: 'c1', cwd: path.join(h.home, 'app'), lines: [cl.user('add tests', NOW - 600_000), cl.say('Done.', NOW - 300_000)] });
  const o = { env: { HOME: h.home }, cwd: os.tmpdir(), now: NOW, isTTY: false };
  expect((await run({ ...o, argv: ['--count', '--since', '1h'] })).stdout).toBe('1 finished\n');
  expect(git.readGit).not.toHaveBeenCalled();
  await run({ ...o, argv: ['--since', '1h'] });
  expect(git.readGit).toHaveBeenCalled();
});
