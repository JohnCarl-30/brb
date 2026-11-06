import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Row } from '../src/catchup';
import { run } from '../src/cli';
import { commandFor, defaultRunner, onPath, PROMPT, summarizeRows, type Runner } from '../src/summarize';
import type { Status, Tool } from '../src/types';
import { NOW } from './support/expected';
import { seedScenario } from './support/scenario';

// realpath, because git reports real paths and the tmp folder is a symlink on macOS (/var -> /private/var).
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brb-summarize-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Call = { bin: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number };
function fakeRunner(stdout = 'ok', code = 0): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = async (bin, args, o) => {
    calls.push({ bin, args, ...o });
    return { code, stdout };
  };
  return { runner, calls };
}

const PROJECT = { key: '/h/code/app', name: 'app' };
const row = (tool: Tool, status: Status, over: Partial<Row> = {}): Row => ({
  tool, sessionId: `${tool}-1`, title: 'a title', status, detail: 'a detail', at: NOW - 600_000, project: PROJECT,
  cwd: PROJECT.key, files: [], resume: `${tool} resume`, longText: `${tool} long text`, ...over,
});

let brbHome: string;
beforeEach(() => { brbHome = fs.mkdtempSync(path.join(tmp, 'home-')); });
const sum = (rows: Row[], runner: Runner, which: (bin: string) => boolean = () => true) =>
  summarizeRows(rows, { brbHome, env: { MARK: 'x' }, runner, which });

describe('commandFor', () => {
  test('asks each tool for one non-interactive answer', () => {
    expect(commandFor('claude', 'p')).toEqual({ bin: 'claude', args: ['-p', '--model', 'haiku', '--no-session-persistence', 'p'] });
    expect(commandFor('codex', 'p')).toEqual({ bin: 'codex', args: ['exec', '--skip-git-repo-check', 'p'] });
    expect(commandFor('gemini', 'p')).toEqual({ bin: 'gemini', args: ['-p', 'p'] });
  });
});

describe('summarizeRows', () => {
  test('sends each session only to its own tool', async () => {
    const { runner, calls } = fakeRunner();
    const rows = [
      row('claude', 'finished', { longText: 'claude secret ' + 'x'.repeat(3000) }),
      row('codex', 'failed', { longText: 'codex secret' }),
      row('gemini', 'finished', { longText: 'gemini secret' }),
    ];
    const map = await sum(rows, runner);
    expect(calls.map((c) => c.bin).sort()).toEqual(['claude', 'codex', 'gemini']);
    for (const r of rows) {
      const call = calls.find((c) => c.bin === r.tool)!;
      expect(call.args.at(-1)).toBe(PROMPT + r.longText.slice(0, 2000));
    }
    expect(calls.find((c) => c.bin === 'claude')!.args.at(-1)).not.toContain('codex secret');
    expect(map.size).toBe(3);
  });

  test("skips a session whose own tool isn't installed", async () => {
    const { runner, calls } = fakeRunner();
    const map = await sum([row('claude', 'finished'), row('gemini', 'finished')], runner, (b) => b !== 'gemini');
    expect(calls.map((c) => c.bin)).toEqual(['claude']);
    expect([...map.keys()].some((k) => k.startsWith('gemini:'))).toBe(false);
    expect([...map.keys()].some((k) => k.startsWith('claude:'))).toBe(true);
  });

  test('only summarizes finished and failed rows', async () => {
    const { runner, calls } = fakeRunner();
    const map = await sum([row('claude', 'waiting'), row('codex', 'working'), row('gemini', 'idle')], runner);
    expect(calls).toHaveLength(0);
    expect(map.size).toBe(0);
  });

  test('takes the first 8 jobs, in the order given', async () => {
    const { runner, calls } = fakeRunner();
    const rows = Array.from({ length: 10 }, (_, i) => row('claude', 'finished', { sessionId: `s${i}`, longText: `text ${i}` }));
    const map = await sum([row('claude', 'working'), ...rows], runner);
    expect(calls).toHaveLength(8);
    expect(calls.some((c) => c.args.at(-1)!.endsWith('text 7'))).toBe(true);
    expect(calls.some((c) => c.args.at(-1)!.endsWith('text 8'))).toBe(false);
    expect(map.size).toBe(8);
  });

  test('keys each summary by tool, session and time', async () => {
    const map = await sum([row('codex', 'failed', { sessionId: 'abc', at: 123 })], fakeRunner('boom').runner);
    expect([...map]).toEqual([['codex:abc:123', 'boom']]);
  });

  test('reuses cached summaries', async () => {
    const first = fakeRunner();
    const rows = [row('claude', 'finished'), row('codex', 'failed')];
    const a = await sum(rows, first.runner);
    expect(first.calls).toHaveLength(2);
    const second = fakeRunner('different');
    const b = await sum(rows, second.runner);
    expect(second.calls).toHaveLength(0);
    expect(b).toEqual(a);
  });

  test('a new activity time is a new summary', async () => {
    await sum([row('claude', 'finished', { at: 1 })], fakeRunner().runner);
    const next = fakeRunner();
    await sum([row('claude', 'finished', { at: 2 })], next.runner);
    expect(next.calls).toHaveLength(1);
  });

  test('keeps the newest 500 summaries', async () => {
    const file = path.join(brbHome, 'cache', 'summaries.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`old:${i}`, 'x']))));
    await sum([row('claude', 'finished')], fakeRunner().runner);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const keys = Object.keys(saved);
    expect(keys).toHaveLength(500);
    expect(keys.at(-1)).toMatch(/^claude:/);
    expect(keys[0]).toBe('old:1');
  });

  test.each([['not json', '{oops'], ['an array', '[1]'], ['null', 'null'], ['a number', '5']])('treats a cache that is %s as empty', async (_name, text) => {
    const file = path.join(brbHome, 'cache', 'summaries.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    const { runner, calls } = fakeRunner();
    const map = await sum([row('claude', 'finished')], runner);
    expect(calls).toHaveLength(1);
    expect(map.size).toBe(1);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')))).toHaveLength(1);
  });

  test('still answers when the cache folder cannot be written', async () => {
    fs.writeFileSync(path.join(brbHome, 'cache'), 'a file where the folder should be');
    const map = await sum([row('claude', 'finished')], fakeRunner().runner);
    expect(map.size).toBe(1);
  });

  test.each([
    ['quoted', '\n"Added six tests, all passing."\n', 'Added six tests, all passing.'],
    ['curly-quoted', '“Fixed the build”', 'Fixed the build'],
    ['the last line', 'Thinking...\n\nFixed the build.\n\n', 'Fixed the build.'],
    ['long', 'w'.repeat(100), `${'w'.repeat(59)}…`],
    ['full of escape codes', '\x1b[2J\x1b[31mFixed\x1b[0m the build', 'Fixed the build'],
  ])('cleans the reply to one short line (%s)', async (_name, stdout, expected) => {
    const map = await sum([row('claude', 'finished')], fakeRunner(stdout).runner);
    expect([...map.values()]).toEqual([expected]);
  });

  test.each([['a failed exit', 'nope', 1], ['an empty reply', '  \n', 0], ['only quotes', '""', 0]])('gives nothing for %s', async (_name, stdout, code) => {
    const map = await sum([row('claude', 'finished')], fakeRunner(stdout, code).runner);
    expect(map.size).toBe(0);
    expect(fs.existsSync(path.join(brbHome, 'cache', 'summaries.json'))).toBe(false);
  });

  test('a runner that throws costs only its own session', async () => {
    const runner: Runner = async (bin) => {
      if (bin === 'codex') throw new Error('spawn failed');
      return { code: 0, stdout: 'fine' };
    };
    const map = await sum([row('codex', 'failed'), row('claude', 'finished')], runner);
    expect([...map.keys()]).toEqual([`claude:claude-1:${NOW - 600_000}`]);
  });

  test('marks its own runs', async () => {
    const { runner, calls } = fakeRunner();
    await sum([row('claude', 'finished')], runner);
    const [call] = calls;
    expect(call.env.BRB_INTERNAL).toBe('1');
    expect(call.env.MARK).toBe('x'); // the caller's env is kept
    expect(path.basename(call.cwd)).toBe('brb-summaries');
    expect(path.dirname(call.cwd)).toBe(os.tmpdir());
    expect(call.timeoutMs).toBe(30_000);
  });

  test('runs the sessions in parallel', async () => {
    let running = 0;
    let peak = 0;
    const runner: Runner = async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return { code: 0, stdout: 'ok' };
    };
    await sum([row('claude', 'finished'), row('codex', 'failed'), row('gemini', 'finished')], runner);
    expect(peak).toBe(3);
  });
});

describe('defaultRunner', () => {
  const node = process.execPath;
  const o = { cwd: tmp, env: { PATH: process.env.PATH ?? '' }, timeoutMs: 10_000 };

  test('returns the exit code and what was printed', async () => {
    expect(await defaultRunner(node, ['-e', "console.log('ok')"], o)).toEqual({ code: 0, stdout: 'ok\n' });
    const failed = await defaultRunner(node, ['-e', "console.log('partial'); process.exit(3)"], o);
    expect(failed).toEqual({ code: 3, stdout: 'partial\n' });
  });

  test("closes the tool's stdin, so a tool that waits for it can't hang", async () => {
    const waits = "process.stdin.resume(); process.stdin.on('end', () => console.log('eof'))";
    expect(await defaultRunner(node, ['-e', waits], o)).toEqual({ code: 0, stdout: 'eof\n' });
  });

  test('runs in the given folder', async () => {
    const { stdout } = await defaultRunner(node, ['-e', 'console.log(process.cwd())'], o);
    expect(stdout.trim()).toBe(tmp);
  });

  test('a timeout and a missing program are failures, not throws', async () => {
    const slow = await defaultRunner(node, ['-e', 'setTimeout(() => {}, 60000)'], { ...o, timeoutMs: 200 });
    expect(slow.code).not.toBe(0);
    const missing = await defaultRunner('brb-no-such-program', [], o);
    expect(missing).toEqual({ code: 1, stdout: '' });
  });
});

describe('onPath', () => {
  const bins = path.join(tmp, 'bins');
  const other = path.join(tmp, 'other');
  beforeAll(() => {
    fs.mkdirSync(path.join(bins, 'adir'), { recursive: true });
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(bins, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(other, 'second'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bins, 'plain'), 'data', { mode: 0o644 });
  });
  const on = (...dirs: string[]) => ({ PATH: dirs.join(path.delimiter) });

  test('finds an executable file in any PATH folder', () => {
    expect(onPath('tool', on(bins))).toBe(true);
    expect(onPath('second', on(bins, other))).toBe(true);
    expect(onPath('second', on(bins))).toBe(false);
  });

  test('ignores folders and missing names', () => {
    expect(onPath('adir', on(bins))).toBe(false);
    expect(onPath('nothing', on(bins))).toBe(false);
  });

  test.skipIf(process.platform === 'win32')('ignores a file that is not executable', () => {
    expect(onPath('plain', on(bins))).toBe(false);
  });

  test('does not throw on a missing PATH, an empty entry or a folder that is gone', () => {
    expect(onPath('tool', {})).toBe(false);
    expect(onPath('tool', on('', path.join(tmp, 'gone')))).toBe(false);
  });
});

// ---- run(): when brb offers AI

describe('run', () => {
  let world: { home: string; repo: string };
  beforeAll(() => {
    // The owner's git config and a repo above the tmp folder must not change what these tests see.
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_CEILING_DIRECTORIES', tmp);
    world = seedScenario(path.join(tmp, 'demo'), NOW);
  });
  afterAll(() => vi.unstubAllEnvs());

  const brb = (argv: string[], over: { env?: NodeJS.ProcessEnv; isTTY?: boolean; runner?: Runner } = {}) =>
    run({
      argv, env: { HOME: world.home, BRB_HOME: fs.mkdtempSync(path.join(tmp, 'brbhome-')), ...over.env }, cwd: world.repo, now: NOW, isTTY: over.isTTY ?? true,
      runner: over.runner ?? fakeRunner('Did the thing.').runner, which: () => true,
    });

  test("no AI unless it's an interactive terminal", async () => {
    expect((await brb([])).rerender).toBeTypeOf('function'); // the control: this is the case that gets AI
    expect((await brb(['--no-ai'])).rerender).toBeUndefined();
    expect((await brb([], { env: { BRB_NO_AI: '1' } })).rerender).toBeUndefined();
    expect((await brb([], { isTTY: false })).rerender).toBeUndefined();
    expect((await brb(['--json'])).rerender).toBeUndefined();
    expect((await brb(['--brief'])).rerender).toBeUndefined();
  });

  test('redraws the screen with each finished or failed session summarized', async () => {
    const { runner, calls } = fakeRunner('"Did the thing."');
    const result = await brb(['--no-color'], { runner });
    expect(calls).toHaveLength(0); // facts first: nothing runs until rerender is called
    const text = await result.rerender!();
    expect(calls.map((c) => c.bin).sort()).toEqual(['claude', 'codex', 'gemini']); // HERE: Claude finished, Codex failed; ELSEWHERE: Gemini
    expect(text!.split('\n')).toHaveLength(result.stdout.split('\n').length); // same shape, so the redraw lines up
    expect(text!.match(/Did the thing\./g)).toHaveLength(2); // ELSEWHERE shows no detail line without --all
    expect(text).toContain('asks: "Round per item or on the total?"'); // the waiting session keeps its facts
    expect(text).not.toContain('Added 6 tests, all passing.');
  });

  test('uses the same options as the first screen', async () => {
    const result = await brb(['--no-color', '--all']);
    const text = (await result.rerender!())!;
    expect(text).toContain('→ claude --resume'); // --all
    expect(text.match(/Did the thing\./g)).toHaveLength(3); // so ELSEWHERE shows its summary too
    expect(text).not.toContain('\x1b[');
  });

  test('has nothing to redraw when no summary came back', async () => {
    expect(await (await brb([], { runner: fakeRunner('', 1).runner })).rerender!()).toBeNull();
  });

  test('keeps summaries under BRB_HOME', async () => {
    const brbHomeDir = path.join(tmp, 'custom-brb');
    await (await brb([], { env: { BRB_HOME: brbHomeDir } })).rerender!();
    expect(fs.existsSync(path.join(brbHomeDir, 'cache', 'summaries.json'))).toBe(true);
  });
});
