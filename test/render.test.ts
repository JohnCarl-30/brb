import { expect, test } from 'vitest';
import { buildCatchUp, type CatchUpInput } from '../src/catchup';
import { renderBrief, renderJson, renderTerminal, shownElsewhere } from '../src/render';
import { EXPECTED_BRIEF, EXPECTED_TERMINAL, IDS, NOW, scenarioCatchUp } from './support/expected';

const plain = { color: false, columns: 100, all: false };

test('renders the approved catch-up', () => {
  expect(renderTerminal(scenarioCatchUp(), plain)).toBe(EXPECTED_TERMINAL);
});

test('strips terminal control codes from session text', () => {
  const evil = 'ok\x1b[2J\x1b]0;pwned\x07 done';
  const c = scenarioCatchUp();
  c.here!.rows[0].detail = evil;
  expect(renderTerminal(c, plain)).toContain('             ok done\n');

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
  expect(renderTerminal(hostile, { ...plain, all: true }).split('\n')).toContain('             a b');
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
  const c = { ...scenarioCatchUp(), sessions: 0, here: null, elsewhere: [], next: [] };
  expect(renderTerminal(c, plain)).toBe(' brb found no AI sessions from the last 7 days.\n Supported: Claude Code, Codex CLI, Gemini CLI.\n');
});

// Real buildCatchUp output: the only session's last activity is your own message, so nothing moved after it.
const quiet = (over: Partial<CatchUpInput> = {}): CatchUpInput => ({
  now: NOW, cwd: '/h/code/shopfront', home: '/h', permissions: new Map(), git: null, warnings: [],
  sessions: [{
    id: 's1', tool: 'claude', cwd: '/h/code/shopfront', title: 'x', lastActivityAt: NOW - 47 * 60_000,
    events: [{ kind: 'user', at: NOW - 47 * 60_000, text: 'x' }],
  }],
  ...over,
});

test('says nothing moved when sessions exist but none moved since your last message', () => {
  const c = buildCatchUp(quiet());
  expect(c.here).toBeNull();
  expect(renderTerminal(c, plain)).toBe(' Welcome back · away 47 min · nothing moved\n');
});

test('says nothing moved under --since when sessions exist but are older', () => {
  const c = buildCatchUp(quiet({ sinceMs: 10 * 60_000 }));
  expect(renderTerminal(c, plain)).toBe(' Welcome back · nothing moved recently\n');
});

test('says there are no sessions when buildCatchUp is given none', () => {
  expect(renderTerminal(buildCatchUp(quiet({ sessions: [] })), plain)).toBe(
    ' brb found no AI sessions from the last 7 days.\n Supported: Claude Code, Codex CLI, Gemini CLI.\n',
  );
});

test('counts things without a time away on a first run', () => {
  const c = { ...scenarioCatchUp(), awayMs: null };
  expect(renderTerminal(c, plain).split('\n')[0]).toBe(' Welcome back · 4 things moved recently');
});

test('--all adds detail to ELSEWHERE and a resume line to every row', () => {
  const lines = renderTerminal(scenarioCatchUp(), { ...plain, all: true }).split('\n');
  const blog = lines.findIndex((l) => l.includes('fix RSS dates'));
  expect(lines.slice(blog + 1, blog + 3)).toEqual([
    '             Fixed the RSS dates to use UTC.',
    `             → cd ~/code/blog && gemini --resume ${IDS.blog}`,
  ]);
  const wait = lines.findIndex((l) => l.includes('fix checkout rounding'));
  expect(lines[wait + 2]).toBe(`             → claude --resume ${IDS.wait}`);
});

// A command is copied and run, so it must print whole: spaces kept, nothing cut.
test('prints resume and next-step commands without collapsing spaces or cutting them', () => {
  const long = `cd ~/'${'long folder  name/'.repeat(30)}' && claude --resume abc`;
  expect(long.length).toBeGreaterThan(300);
  const c = scenarioCatchUp();
  c.here!.rows[0].resume = long;
  c.next = [{ label: 'answer Claude', command: long }];
  const out = renderTerminal(c, { ...plain, all: true }).split('\n');
  expect(out).toContain(`             → ${long}`);
  expect(out).toContain(` → answer Claude  ${long}`);
});

test('still strips control codes from a command', () => {
  const c = scenarioCatchUp();
  c.next = [{ label: 'x', command: "cd ~/'a  b\x1b[2J\x1b]0;x\x07c\r\nd' && claude" }];
  expect(renderTerminal(c, plain)).toContain(" → x  cd ~/'a  bc  d' && claude\n");
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

test('json leaves out the session file path', () => {
  const c = scenarioCatchUp();
  c.elsewhere[0].file = '/h/.claude/projects/x/s.jsonl';
  expect(renderJson(c)).not.toContain('"file"');
});

test('pads row numbers so ten or more rows keep their columns', () => {
  const c = scenarioCatchUp();
  c.elsewhere = Array.from({ length: 7 }, () => ({ ...c.elsewhere[0] }));
  const lines = renderTerminal(c, plain).split('\n');
  expect(lines).toContain('  1 ◐ Claude  fix checkout rounding      waiting on you · 8 min');
  expect(lines).toContain('              asks: "Round per item or on the total?"');
  expect(lines).toContain('    ✎ You     2 files changed, not committed');
  expect(lines).toContain(' 10 ● Gemini  blog · fix RSS dates       finished · 30 min ago');
});

test('numbered: false keeps the old columns and drops the brb <number> hint', () => {
  const out = renderTerminal(scenarioCatchUp(), { ...plain, numbered: false });
  expect(out).toContain('\n ◐ Claude  fix checkout rounding      waiting on you · 8 min\n           asks:');
  expect(out).toContain('\n ✎ You     2 files changed');
  expect(out).not.toContain('brb <number>');
});

test('ELSEWHERE shows at most 10 rows, always keeping the ones that need you, and says how many it left out', () => {
  const c = scenarioCatchUp();
  const done = c.elsewhere[0];
  c.elsewhere = [
    ...Array.from({ length: 13 }, (_, i) => ({ ...done, title: `done ${i + 1}` })),
    { ...done, title: 'broke', status: 'failed' as const },
  ];
  const out = renderTerminal(c, plain);
  expect(out).toContain('done 9 ');
  expect(out).not.toContain('done 10 ');
  expect(out).toContain('blog · broke');
  expect(out).toContain('\n    +4 more · brb --all shows every session\n');
  expect(out.match(/^ +\d+ [◐●✕]/gm)).toHaveLength(13); // 3 HERE + 10 ELSEWHERE
  expect(renderTerminal(c, { ...plain, all: true })).not.toContain('more ·');
  expect(shownElsewhere(c, false).map((r) => r.title).at(-1)).toBe('broke');
});
