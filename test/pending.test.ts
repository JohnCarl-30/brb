import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { run } from '../src/cli';
import { readPermissionRequests, recordPermissionRequest } from '../src/pending';
import { cl, writeClaudeSession } from './support/fake-home';
import { NOW } from './support/expected';
import { seedScenario } from './support/scenario';

// realpath, because git reports real paths and the tmp folder is a symlink on macOS (/var -> /private/var).
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brb-pending-')));
const min = (m: number) => NOW - m * 60_000;

// The owner's git config and a repo above the tmp folder must not change what these tests see.
beforeAll(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CEILING_DIRECTORIES', tmp);
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('records and reads a permission request', () => {
  const brb = path.join(tmp, 'records', '.brb'); // not there yet, so recording makes it
  recordPermissionRequest(brb, 's1', 'Claude needs your permission to use Bash', NOW);
  expect(JSON.parse(fs.readFileSync(path.join(brb, 'pending', 'claude-s1.json'), 'utf8'))).toEqual({ at: NOW, message: 'Claude needs your permission to use Bash' });
  expect(readPermissionRequests(brb, NOW)).toEqual(new Map([['s1', { at: NOW, message: 'Claude needs your permission to use Bash' }]]));
});

test('reads nothing when there is no pending folder', () => {
  expect(readPermissionRequests(path.join(tmp, 'empty', '.brb'), NOW).size).toBe(0);
});

test('drops markers older than 7 days', () => {
  const brb = path.join(tmp, 'old', '.brb');
  const day = 86_400_000;
  recordPermissionRequest(brb, 'old', 'x', NOW - 7 * day - 1);
  recordPermissionRequest(brb, 'new', 'y', NOW - 7 * day);
  expect([...readPermissionRequests(brb, NOW).keys()]).toEqual(['new']);
  expect(fs.readdirSync(path.join(brb, 'pending'))).toEqual(['claude-new.json']);
});

test('ignores a marker it cannot read', () => {
  const brb = path.join(tmp, 'broken', '.brb');
  recordPermissionRequest(brb, 'good', 'ok', NOW);
  fs.writeFileSync(path.join(brb, 'pending', 'claude-bad.json'), 'not json');
  fs.writeFileSync(path.join(brb, 'pending', 'claude-odd.json'), '{"at":"yesterday"}');
  expect([...readPermissionRequests(brb, NOW).keys()]).toEqual(['good']);
});

test('writes nothing for a session id that holds a path', () => {
  const brb = path.join(tmp, 'escape', '.brb');
  fs.mkdirSync(brb, { recursive: true }); // so an id that climbs out of pending/ has somewhere to land
  // 'claude-x/../../escaped.json' resolves to <brb>/escaped.json, outside pending/ (a leading '../' would stay inside it).
  recordPermissionRequest(brb, 'x/../../escaped', 'x', NOW);
  recordPermissionRequest(brb, '../../evil', 'x', NOW);
  expect(fs.readdirSync(brb)).toEqual([]); // not even pending/ was made
});

test('a fresh permission request turns a session into waiting', async () => {
  const world = seedScenario(path.join(tmp, 'demo'), NOW);
  const h = { home: world.home, claude: path.join(world.home, '.claude'), codex: path.join(world.home, '.codex'), gemini: path.join(world.home, '.gemini'), kiro: path.join(world.home, '.kiro'), brb: path.join(world.home, '.brb') };
  writeClaudeSession(h, {
    id: 'clean-build', cwd: world.repo, branch: 'main',
    lines: [cl.user('clean the build', min(4)), cl.tool('t9', 'Bash', { command: 'rm -rf build' }, min(3))],
  });
  const rowOf = async () => {
    const { stdout } = await run({ argv: ['--json'], env: { HOME: world.home }, cwd: world.repo, now: NOW, isTTY: false });
    return JSON.parse(stdout).here.rows.find((r: { sessionId: string }) => r.sessionId === 'clean-build');
  };

  expect((await rowOf())?.status).not.toBe('waiting'); // nothing says it's blocked yet
  recordPermissionRequest(h.brb, 'clean-build', 'Claude needs your permission to use Bash', min(3) + 1_000);
  expect(await rowOf()).toMatchObject({ status: 'waiting', detail: 'Claude needs your permission to use Bash' });
});

test.skipIf(process.platform === 'win32')('the markers and their folders are private to the user', () => {
  const brb = path.join(tmp, 'private', '.brb');
  const file = path.join(brb, 'pending', 'claude-s1.json');
  const mode = (p: string) => fs.statSync(p).mode & 0o777;
  recordPermissionRequest(brb, 's1', 'Claude needs your permission to use Bash', NOW);
  expect([mode(brb), mode(path.dirname(file)), mode(file)]).toEqual([0o700, 0o700, 0o600]);
  fs.chmodSync(file, 0o644); // a marker left by an older brb
  recordPermissionRequest(brb, 's1', 'Claude needs your permission to use Edit', NOW);
  expect(mode(file)).toBe(0o600);
});
