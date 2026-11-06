import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import pkg from '../package.json';
import { HELP, redraw, run } from '../src/cli';
import { EXPECTED_TERMINAL, IDS, NOW } from './support/expected';
import { seedScenario } from './support/scenario';

// realpath, because git reports real paths and the tmp folder is a symlink on macOS (/var -> /private/var).
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brb-cli-')));
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

const brb = (argv: string[], cwd = world.repo) => run({ argv, env: { HOME: world.home }, cwd, now: NOW, isTTY: false });

test('prints the approved catch-up for the demo scenario', async () => {
  const { stdout, exitCode } = await brb([]);
  expect(stdout).toBe(EXPECTED_TERMINAL);
  expect(exitCode).toBe(0);
});

test('--json is valid JSON', async () => {
  const { stdout } = await brb(['--json']);
  const c = JSON.parse(stdout);
  expect(c.here.rows).toHaveLength(3);
  expect(c.elsewhere).toHaveLength(1);
  expect(stdout.endsWith('\n')).toBe(true);
});

test('--brief --exclude leaves out that session', async () => {
  const all = await brb(['--brief']);
  expect(all.stdout).toContain('fix checkout rounding');
  const { stdout } = await brb(['--brief', '--exclude', IDS.wait]);
  expect(stdout).not.toContain('fix checkout rounding');
  expect(stdout).toContain('add login rate limit');
});

test('unknown flag exits 1 with a hint', async () => {
  const { stdout, exitCode } = await brb(['--nope']);
  expect(exitCode).toBe(1);
  expect(stdout).toContain('Run brb --help for usage.');
});

test('bad --since exits 1', async () => {
  const { stdout, exitCode } = await brb(['--since', 'soon']);
  expect(exitCode).toBe(1);
  expect(stdout).toContain('brb: --since takes a time like 30m, 2h or 1d');
});

test('prints help and the version', async () => {
  expect(await brb(['--help'])).toEqual({ stdout: HELP, exitCode: 0 });
  expect(await brb(['-v'])).toEqual({ stdout: `${pkg.version}\n`, exitCode: 0 });
});

test('works outside any git repo', async () => {
  const { stdout, exitCode } = await brb([], world.home);
  expect(exitCode).toBe(0);
  expect(stdout).toContain(' EVERYWHERE');
  expect(stdout).not.toContain(' HERE ·');
  expect(stdout.match(/^ [◐●✕] /gm)).toHaveLength(4);
});

test('seedScenario only recreates a folder it made', () => {
  const other = path.join(tmp, 'precious');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'keep.txt'), 'mine');
  expect(() => seedScenario(other, NOW)).toThrow('.brb-demo');
  expect(fs.readFileSync(path.join(other, 'keep.txt'), 'utf8')).toBe('mine');

  const again = path.join(tmp, 'again');
  seedScenario(again, NOW);
  expect(() => seedScenario(again, NOW)).not.toThrow();
});

// The first screen plus the "summarizing…" line is what the cursor has to climb back over.
test('redraw replaces the first screen and the summarizing line with the new screen', () => {
  expect(redraw('a\nb\n', 'A\nB\n', 24)).toBe('\x1b[3F\x1b[0JA\nB\n');
});

test('redraw only wipes the summarizing line when no summary came back', () => {
  expect(redraw('a\nb\n', null, 24)).toBe('\x1b[1F\x1b[0J');
});

test('redraw leaves a screen that scrolled alone, apart from the summarizing line', () => {
  const screen = (lines: number) => 'x\n'.repeat(lines);
  expect(redraw(screen(22), 'new\n', 24)).toBe('\x1b[23F\x1b[0Jnew\n'); // 22 lines and the status line still fit
  expect(redraw(screen(23), 'new\n', 24)).toBe('\x1b[1F\x1b[0J'); // one more and the top has scrolled away
  expect(redraw(screen(2), 'new\n', 0)).toBe('\x1b[1F\x1b[0J'); // rows unknown
});
