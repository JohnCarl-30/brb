import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { runHook } from '../src/hooks';
import { readPermissionRequests } from '../src/pending';
import { cl, writeClaudeSession } from './support/fake-home';
import { EXPECTED_BRIEF, NOW } from './support/expected';
import { seedScenario } from './support/scenario';

// realpath, because git reports real paths and the tmp folder is a symlink on macOS (/var -> /private/var).
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brb-hooks-')));
let world: { home: string; repo: string };

// The owner's git config and a repo above the tmp folder must not change what these tests see.
beforeAll(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CEILING_DIRECTORIES', tmp);
  world = seedScenario(path.join(tmp, 'demo'), NOW);
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const hook = (name: string, stdin: string, home: string, extraEnv: NodeJS.ProcessEnv = {}, cwd = world.repo) =>
  runHook(name, stdin, { argv: ['hook', name], env: { HOME: home, ...extraEnv }, cwd, now: NOW, isTTY: false, stdin });

test('notification hook records only permission prompts', async () => {
  const home = path.join(tmp, 'notify');
  const pending = () => readPermissionRequests(path.join(home, '.brb'), NOW);

  const idle = await hook('notification', JSON.stringify({ session_id: 's1', message: 'Claude is waiting for your input' }), home);
  expect(idle).toEqual({ stdout: '', exitCode: 0 });
  expect(pending().size).toBe(0);

  const asked = await hook('notification', JSON.stringify({ session_id: 's1', message: 'Claude needs your permission to use Bash' }), home);
  expect(asked).toEqual({ stdout: '', exitCode: 0 });
  expect(pending()).toEqual(new Map([['s1', { at: NOW, message: 'Claude needs your permission to use Bash' }]]));

  // The type says it's a permission prompt even when the words don't.
  await hook('notification', JSON.stringify({ session_id: 's2', notification_type: 'permission_prompt', message: 'Allow\nthis?' }), home);
  expect(pending().get('s2')).toEqual({ at: NOW, message: 'Allow this?' });
});

test('session-start hook tells Claude about other sessions', async () => {
  const { stdout, exitCode } = await hook('session-start', JSON.stringify({ session_id: 'new-session', cwd: world.repo }), world.home, {}, '/');
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout)).toEqual({
    systemMessage: 'brb: 3 other sessions in this project · 1 waiting on you',
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: EXPECTED_BRIEF },
  });
});

test('session-start hook says "1 other session" and leaves out the waiting count when nothing waits', async () => {
  const home = path.join(tmp, 'one');
  const cwd = path.join(home, 'proj');
  fs.mkdirSync(cwd, { recursive: true });
  const h = { home, claude: path.join(home, '.claude'), codex: path.join(home, '.codex'), gemini: path.join(home, '.gemini'), brb: path.join(home, '.brb') };
  writeClaudeSession(h, { id: 'old-one', cwd, lines: [cl.user('add a test', NOW - 30 * 60_000), cl.say('Added a test.', NOW - 29 * 60_000)] });

  const { stdout } = await hook('session-start', JSON.stringify({ session_id: 'new-session', cwd }), home);
  expect(JSON.parse(stdout).systemMessage).toBe('brb: 1 other session in this project');
});

test('session-start hook is silent when nothing is relevant', async () => {
  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  expect(await hook('session-start', JSON.stringify({ session_id: 'new-session', cwd: empty }), empty)).toEqual({ stdout: '', exitCode: 0 });
});

test('hooks never fail', async () => {
  for (const name of ['session-start', 'notification', 'something-else', '']) {
    expect(await hook(name, 'not json', world.home)).toEqual({ stdout: '', exitCode: 0 });
  }
  // Valid JSON that is not an object.
  for (const stdin of ['null', '[1]', '5']) expect(await hook('notification', stdin, world.home)).toEqual({ stdout: '', exitCode: 0 });
});

test("hooks stay quiet inside brb's own AI calls", async () => {
  const stdin = JSON.stringify({ session_id: 'new-session', cwd: world.repo, message: 'Claude needs your permission to use Bash' });
  expect(await hook('session-start', stdin, world.home, { BRB_INTERNAL: '1' })).toEqual({ stdout: '', exitCode: 0 });
  expect(await hook('notification', stdin, world.home, { BRB_INTERNAL: '1' })).toEqual({ stdout: '', exitCode: 0 });
  expect(readPermissionRequests(path.join(world.home, '.brb'), NOW).size).toBe(0);
});
