import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { HOOK_HINT } from '../src/catchup';
import { run } from '../src/cli';
import { runHook } from '../src/hooks';
import { readPermissionRequests } from '../src/pending';
import { cl, cx, writeClaudeSession, writeCodexSession } from './support/fake-home';
import pkg from '../package.json';
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
  const h = { home, claude: path.join(home, '.claude'), codex: path.join(home, '.codex'), gemini: path.join(home, '.gemini'), kiro: path.join(home, '.kiro'), brb: path.join(home, '.brb') };
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

// brb can only see a permission prompt through the hooks, so it tips the plugin until a hook has run once.
test('the plugin tip shows for a quiet Claude tool call until any hook has run', async () => {
  const w = seedScenario(path.join(tmp, 'tip'), NOW);
  const h = { home: w.home, claude: path.join(w.home, '.claude'), codex: path.join(w.home, '.codex'), gemini: path.join(w.home, '.gemini'), kiro: path.join(w.home, '.kiro'), brb: path.join(w.home, '.brb') };
  const min = (m: number) => NOW - m * 60_000;
  const list = async () => (await run({ argv: [], env: { HOME: w.home }, cwd: w.repo, now: NOW, isTTY: false })).stdout;

  expect(await list()).not.toContain('tip:'); // nothing could be a hidden prompt yet
  writeClaudeSession(h, { id: 'suite', cwd: w.repo, branch: 'main', lines: [cl.user('run the suite', min(6)), cl.tool('t1', 'Bash', { command: 'npm test' }, min(5))] });
  expect(await list()).toContain(`\n ${HOOK_HINT}\n`);

  await hook('session-start', 'not json', w.home, { BRB_INTERNAL: '1' }); // brb's own AI runs don't count
  await hook('stop', '{}', w.home);                                       // nor a hook brb doesn't have
  expect(await list()).toContain('tip:');

  await hook('session-start', 'not json', w.home); // even a run that fails on its input shows the hooks are installed
  expect(await list()).not.toContain('tip:');
  if (process.platform !== 'win32') expect(fs.statSync(path.join(h.brb, 'hooks-on')).mode & 0o777).toBe(0o600);
});

// ---- Codex: the same hooks, run by Codex's plugin with a third argument of `codex`.
const codexHook = (name: string, input: object, home: string, cwd = world.repo) => {
  const stdin = JSON.stringify(input);
  return runHook(name, stdin, { argv: ['hook', name, 'codex'], env: { HOME: home }, cwd, now: NOW, isTTY: false, stdin });
};

test.each([
  ['its own reason when it gives one', { tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Needs network access\nto install' } }, 'Needs network access to install'],
  ['the command for a shell call', { tool_name: 'Bash', tool_input: { command: 'npm run migrate' } }, 'Codex needs your approval to run npm run migrate'],
  ['"edit files" for a patch, never the patch text', { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n+secret' } }, 'Codex needs your approval to edit files'],
  ['the tool name for anything else', { tool_name: 'mcp__fs__write', tool_input: { path: '/x' } }, 'Codex needs your approval to use mcp__fs__write'],
  ['a plain line when the input says nothing', {}, 'Codex needs your approval'],
])('the Codex permission hook records %s, and prints nothing so the user still decides', async (_what, input, message) => {
  const home = path.join(tmp, `codex-ask-${message.length}`);
  expect(await codexHook('permission-request', { session_id: 'thr-1', hook_event_name: 'PermissionRequest', ...input }, home)).toEqual({ stdout: '', exitCode: 0 });
  expect(readPermissionRequests(path.join(home, '.brb'), NOW)).toEqual(new Map([['thr-1', { at: NOW, message }]]));
  expect(fs.readdirSync(path.join(home, '.brb', 'pending'))).toEqual(['codex-thr-1.json']);
});

test('the Codex permission hook cuts a long command and writes nothing without a session id', async () => {
  const home = path.join(tmp, 'codex-long');
  await codexHook('permission-request', { tool_name: 'Bash', tool_input: { command: 'x'.repeat(500) } }, home);
  expect(fs.existsSync(path.join(home, '.brb', 'pending'))).toBe(false);
  await codexHook('permission-request', { session_id: 'thr-2', tool_name: 'Bash', tool_input: { command: 'x'.repeat(500) } }, home);
  expect(readPermissionRequests(path.join(home, '.brb'), NOW).get('thr-2')!.message).toHaveLength(80);
});

test('a Codex session that asks for approval shows as waiting on you, with what it asked', async () => {
  const w = seedScenario(path.join(tmp, 'codex-wait'), NOW);
  const h = { home: w.home, claude: path.join(w.home, '.claude'), codex: path.join(w.home, '.codex'), gemini: path.join(w.home, '.gemini'), kiro: path.join(w.home, '.kiro'), brb: path.join(w.home, '.brb') };
  const id = '019b1111-0000-7000-8000-00000000000a';
  const min = (m: number) => NOW - m * 60_000;
  writeCodexSession(h, { id, threadName: 'run the migration', lines: [cx.meta(id, w.repo, min(4)), cx.started(min(4)), cx.user('run the migration', min(4)), cx.say('Running it now.', min(3))] });
  const row = async () => {
    const { stdout } = await run({ argv: ['--json'], env: { HOME: w.home }, cwd: w.repo, now: NOW, isTTY: false });
    return JSON.parse(stdout).here.rows.find((r: { sessionId: string }) => r.sessionId === id);
  };
  expect((await row())?.status).not.toBe('waiting');
  await codexHook('permission-request', { session_id: id, cwd: w.repo, tool_name: 'Bash', tool_input: { command: 'npm run migrate' } }, w.home, w.repo);
  expect(await row()).toMatchObject({ tool: 'codex', status: 'waiting', detail: 'Codex needs your approval to run npm run migrate' });
});

test('the Codex session-start hook briefs like Claude\'s, leaves the Codex session out, and does not count as Claude\'s hooks being on', async () => {
  const w = seedScenario(path.join(tmp, 'codex-start'), NOW);
  const id = '019a0000-0000-7000-8000-000000000003'; // the scenario's own Codex session, now the one starting
  const { stdout } = await codexHook('session-start', { session_id: id, cwd: w.repo, hook_event_name: 'SessionStart', source: 'resume', model: 'gpt-5' }, w.home, '/');
  const out = JSON.parse(stdout);
  expect(out.systemMessage).toBe('brb: 2 other sessions in this project · 1 waiting on you');
  expect(out.hookSpecificOutput).toMatchObject({ hookEventName: 'SessionStart' });
  expect(out.hookSpecificOutput.additionalContext).not.toContain('upgrade to Next 16');
  expect(fs.existsSync(path.join(w.home, '.brb', 'hooks-on'))).toBe(false);
  await hook('session-start', '{}', w.home); // Claude's does
  expect(fs.existsSync(path.join(w.home, '.brb', 'hooks-on'))).toBe(true);
});

// The plugin files Codex reads. A hook name brb doesn't handle would fail silently, and a stale version shows in `codex plugin list`.
test('the Codex plugin points at files that exist, hooks brb handles, and the package version', () => {
  const root = new URL('..', import.meta.url);
  const read = (file: string) => JSON.parse(fs.readFileSync(new URL(file, root), 'utf8'));
  const manifest = read('.codex-plugin/plugin.json');
  expect([manifest.version, read('.claude-plugin/plugin.json').version]).toEqual([pkg.version, pkg.version]);
  expect(fs.existsSync(new URL(`${manifest.skills}brb/SKILL.md`, root))).toBe(true);
  const hooks = read(manifest.hooks).hooks;
  expect(Object.keys(hooks)).toEqual(['SessionStart', 'PermissionRequest']);
  const commands = Object.values(hooks).flat().flatMap((g) => (g as { hooks: { command: string }[] }).hooks.map((x) => x.command));
  expect(commands.map((c) => /brb\.mjs" hook ([\w-]+) codex \|\| true$/.exec(c)?.[1])).toEqual(['session-start', 'permission-request']);
});
