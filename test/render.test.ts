import { expect, test } from 'vitest';
import { renderBrief, renderJson, renderTerminal } from '../src/render';
import { EXPECTED_BRIEF, EXPECTED_TERMINAL, IDS, scenarioCatchUp } from './support/expected';

const plain = { color: false, columns: 100, all: false };

test('renders the approved catch-up', () => {
  expect(renderTerminal(scenarioCatchUp(), plain)).toBe(EXPECTED_TERMINAL);
});

test('strips terminal control codes from session text', () => {
  const evil = 'ok\x1b[2J\x1b]0;pwned\x07 done';
  const c = scenarioCatchUp();
  c.here!.rows[0].detail = evil;
  expect(renderTerminal(c, plain)).toContain('           ok done\n');

  // Every string that came from a session or the disk, in both outputs.
  const e = '\x1b[2J\x1b]0;x\x07a\r\nb';
  const hostile = scenarioCatchUp();
  const row = hostile.here!.rows[1];
  Object.assign(row, { title: e, detail: e, summary: e, resume: e, files: [e] });
  Object.assign(hostile.elsewhere[0], { title: e, detail: e, resume: e, project: { key: 'k', name: e } });
  Object.assign(hostile.here!.project, { name: e });
  hostile.here!.you!.changes[0].file = e;
  hostile.here!.you!.todos = [{ file: e, line: 1, text: e }];
  hostile.next = [{ label: e, command: e }];
  hostile.warnings = [e];
  for (const out of [renderTerminal(hostile, { ...plain, all: true }), renderBrief(hostile)]) {
    expect(out).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f]/); // only \n separates lines
  }
  expect(renderTerminal(hostile, { ...plain, all: true }).split('\n')).toContain('           a b');
});

test('says when nothing moved', () => {
  const c = { ...scenarioCatchUp(), elsewhere: [] };
  c.here = { ...c.here!, rows: [], you: null };
  c.next = [];
  expect(renderTerminal(c, plain)).toBe(' Welcome back · away 47 min · nothing moved\n');
});

test('says nothing moved without a time away on a first run', () => {
  const c = { ...scenarioCatchUp(), awayMs: null, elsewhere: [], next: [] };
  c.here = { ...c.here!, rows: [], you: null };
  expect(renderTerminal(c, plain)).toBe(' Welcome back · nothing moved recently\n');
});

test('says when there are no sessions at all', () => {
  const c = { ...scenarioCatchUp(), here: null, elsewhere: [], next: [] };
  expect(renderTerminal(c, plain)).toBe(' brb found no AI sessions from the last 7 days.\n Supported: Claude Code, Codex CLI, Gemini CLI.\n');
});

test('counts things without a time away on a first run', () => {
  const c = { ...scenarioCatchUp(), awayMs: null };
  expect(renderTerminal(c, plain).split('\n')[0]).toBe(' Welcome back · 4 things moved recently');
});

test('--all adds detail to ELSEWHERE and a resume line to every row', () => {
  const lines = renderTerminal(scenarioCatchUp(), { ...plain, all: true }).split('\n');
  const blog = lines.findIndex((l) => l.includes('fix RSS dates'));
  expect(lines.slice(blog + 1, blog + 3)).toEqual([
    '           Fixed the RSS dates to use UTC.',
    `           → cd ~/code/blog && gemini --resume ${IDS.blog}`,
  ]);
  const wait = lines.findIndex((l) => l.includes('fix checkout rounding'));
  expect(lines[wait + 2]).toBe(`           → claude --resume ${IDS.wait}`);
});

test('colors only when asked, without moving the columns', () => {
  const colored = renderTerminal(scenarioCatchUp(), { ...plain, color: true });
  expect(colored).toContain('\x1b[');
  expect(colored.replace(/\x1b\[\d+m/g, '')).toBe(EXPECTED_TERMINAL);
});

test('renders the brief', () => {
  expect(renderBrief(scenarioCatchUp())).toBe(EXPECTED_BRIEF);
  const empty = { ...scenarioCatchUp(), here: null, elsewhere: [], next: [] };
  expect(renderBrief(empty)).toBe('');
});

test('caps the brief at 7 rows and says how many more', () => {
  const c = scenarioCatchUp();
  const [first] = c.here!.rows;
  c.here!.rows = Array.from({ length: 9 }, () => first);
  const lines = renderBrief(c).split('\n');
  expect(lines).toHaveLength(10);
  expect(lines[8]).toBe('• …and 2 more (run brb to see all)');
});

test('json leaves out longText', () => {
  const c = scenarioCatchUp();
  const parsed = JSON.parse(renderJson(c));
  expect(parsed.here.rows[0].title).toBe('fix checkout rounding');
  expect(parsed.here.rows[0].longText).toBeUndefined();
  expect(parsed.elsewhere[0].longText).toBeUndefined();
});
