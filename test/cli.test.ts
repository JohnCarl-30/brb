import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import pkg from '../package.json';
import { HELP, parsePick, redraw, run } from '../src/cli';
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
  expect(stdout.match(/^ \d [◐●✕] /gm)).toHaveLength(4);
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

test('brb <number> hands the terminal to that session, numbered HERE then ELSEWHERE', async () => {
  const here = await run({ argv: ['1'], env: { HOME: world.home }, cwd: world.repo, now: NOW, isTTY: true });
  expect(here).toEqual({ stdout: `→ claude --resume ${IDS.wait}\n`, exitCode: 0, exec: `claude --resume ${IDS.wait}` });
  const elsewhere = await run({ argv: ['4'], env: { HOME: world.home }, cwd: world.repo, now: NOW, isTTY: true });
  expect(elsewhere.exec).toMatch(new RegExp(`^cd .+blog && gemini --resume ${IDS.blog}$`));
});

test('brb <number> only prints the command without a terminal', async () => {
  expect(await brb(['3'])).toEqual({ stdout: `→ codex resume ${IDS.fail}\n`, exitCode: 0, exec: undefined });
});

test('brb <number> rejects a number that is not on the list', async () => {
  for (const argv of [['5'], ['0'], ['x'], ['1', '2']]) {
    const { stdout, exitCode } = await brb(argv);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/^brb: (no session 5: pick 1 to 4|give one session number, e\.g\. brb 2)\n/);
  }
});

test('--exclude drops the row numbers, since they would not match brb <number>', async () => {
  const { stdout } = await brb(['--exclude', IDS.wait]);
  expect(stdout).toContain('\n ● Claude  add login rate limit');
  expect(stdout).not.toContain('brb <number>');
});

test('redraw climbs every row a wrapped line takes, colors not counted', () => {
  const long = `\x1b[2m${'x'.repeat(250)}\x1b[22m`; // 250 characters on a 100-column terminal: 3 rows
  expect(redraw(`a\n${long}\n`, 'new\n', 24, 100)).toBe('\x1b[5F\x1b[0Jnew\n');
  expect(redraw(`${'x'.repeat(100)}\n`, 'new\n', 24, 100)).toBe('\x1b[2F\x1b[0Jnew\n'); // exactly full: no wrap
});

test('brb show <number> gives that row\'s recap, and asks no AI without a terminal', async () => {
  const calls: string[] = [];
  const result = await run({
    argv: ['show', '2'], env: { HOME: world.home }, cwd: world.repo, now: NOW, isTTY: false,
    runner: async (bin) => { calls.push(bin); return { code: 0, stdout: 'DONE: x' }; }, which: () => true, tmpDir: tmp,
  });
  expect(result.exitCode).toBe(0);
  expect(result.show).toBe(2);
  const page = await result.recap!(2);
  expect(page).toBe(path.join(world.home, '.brb', 'recaps', `claude-${IDS.done}.html`));
  expect(fs.readFileSync(page, 'utf8')).toContain('Last messages');
  expect(calls).toEqual([]);
});

test('brb show rejects a missing or unlisted number, and --json or --brief', async () => {
  const cases: [string[], string][] = [
    [['show', '9'], 'no session 9: pick 1 to 4'],
    [['show'], 'give one session number, e.g. brb show 2'],
    [['show', 'x'], 'give one session number, e.g. brb show 2'],
    [['show', '1', '--json'], 'brb show makes a page, so it takes no --json or --brief'],
    [['show', '1', '--brief'], 'brb show makes a page, so it takes no --json or --brief'],
  ];
  for (const [argv, message] of cases) {
    const { stdout, exitCode } = await brb(argv);
    expect(exitCode).toBe(1);
    expect(stdout).toBe(`brb: ${message}\nRun brb --help for usage.\n`);
  }
});

test('the list in a terminal can write any listed row\'s recap', async () => {
  const { recap } = await run({ argv: ['--no-ai'], env: { HOME: world.home }, cwd: world.repo, now: NOW, isTTY: true });
  expect(await recap!(1)).toBe(path.join(world.home, '.brb', 'recaps', `claude-${IDS.wait}.html`));
});

test('parsePick takes s<number> for a recap', () => {
  expect(parsePick('s2', 3)).toEqual({ show: 2 });
  expect(parsePick(' S 3 ', 3)).toEqual({ show: 3 });
  expect(parsePick('s9', 3)).toBe('again');
  expect(parsePick('s', 3)).toBe('again');
});

test('parsePick takes a listed number, quits on Enter or q, asks again on anything else', () => {
  expect(parsePick(' 5 ', 29)).toBe(5);
  expect(parsePick('', 29)).toBe('quit');
  expect(parsePick('Q', 29)).toBe('quit');
  for (const a of ['0', '30', 'x', '2a', '-1', '1.5']) expect(parsePick(a, 29)).toBe('again');
});

test('a terminal run offers every numbered row to pick from, in screen order', async () => {
  const { choices } = await run({ argv: ['--no-ai'], env: { HOME: world.home }, cwd: world.repo, now: NOW, isTTY: true });
  expect(choices).toHaveLength(4);
  expect(choices![0]).toBe(`claude --resume ${IDS.wait}`);
  expect(choices![3]).toMatch(/gemini --resume/);
  expect((await brb([])).choices).toBeUndefined(); // no terminal
  const excluded = await run({ argv: ['--no-ai', '--exclude', IDS.wait], env: { HOME: world.home }, cwd: world.repo, now: NOW, isTTY: true });
  expect(excluded.choices).toBeUndefined(); // no numbers on screen, so nothing to pick by number
});
