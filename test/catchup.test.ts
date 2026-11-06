import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { agentEditedFiles, buildCatchUp, type CatchUp, type CatchUpInput } from '../src/catchup';
import type { Change } from '../src/git';
import type { Session, SessionEvent } from '../src/types';

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;

const SHOP = '/h/code/shopfront';
const BLOG = '/h/code/blog';

const user = (m: number): SessionEvent => ({ kind: 'user', at: min(m), text: 'do the thing' });
const agent = (m: number, text: string): SessionEvent => ({ kind: 'agent', at: min(m), text });
const edit = (m: number, ...files: string[]): SessionEvent => ({ kind: 'edit', at: min(m), files });
const command = (m: number, ok: boolean): SessionEvent => ({ kind: 'command', at: min(m), command: 'npm run build', ok, output: ok ? '' : 'Error: next.config.js: unknown option "ppr"\n' });
const ask = (m: number, text: string): SessionEvent => ({ kind: 'ask', at: min(m), reason: 'question', text });
const turnEnd = (m: number): SessionEvent => ({ kind: 'turn-end', at: min(m) });

const session = (s: Pick<Session, 'id' | 'tool' | 'cwd' | 'events'> & Partial<Session>): Session => ({ title: s.id, lastActivityAt: s.events.at(-1)!.at, ...s });

// The Appendix A world, without the real worktree: all three shopfront sessions run in the repo folder.
const cWait = session({ id: 'c-wait', tool: 'claude', cwd: SHOP, title: 'fix checkout rounding', events: [user(47), ask(8, 'Round per item or on the total?')] });
const cDone = session({
  id: 'c-done', tool: 'claude', cwd: SHOP, branch: 'login-rate-limit', title: 'add login rate limit',
  events: [user(60), edit(40, `${SHOP}/src/middleware/rateLimit.ts`), command(13, true), agent(12, 'Added 6 tests, all passing. Want me to open a PR?'), turnEnd(12)],
});
const xFail = session({
  id: 'x-fail', tool: 'codex', cwd: SHOP, title: 'upgrade to Next 16',
  events: [user(55), edit(30, `${SHOP}/package.json`), command(21, false), agent(20, 'The build fails because next.config.js uses the removed ppr option.'), turnEnd(20)],
});
const gOne = session({
  id: 'g-1', tool: 'gemini', cwd: BLOG, title: 'fix RSS dates',
  events: [user(50), edit(35, `${BLOG}/src/rss.ts`), agent(30, 'Fixed the RSS dates to use UTC.'), turnEnd(30)],
});
const SCENARIO = [xFail, cDone, cWait, gOne];

// A finished session with no human message, so it never moves a window.
const finished = (id: string, m: number, cwd = SHOP): Session => session({ id, tool: 'claude', cwd, events: [agent(m, 'Done.'), turnEnd(m)] });

const change = (file: string, m: number): Change => ({ file, added: 1, removed: 0, mtimeMs: min(m) });
const input = (over: Partial<CatchUpInput> = {}): CatchUpInput => ({
  now: NOW, cwd: SHOP, home: '/h', sessions: SCENARIO, permissions: new Map(),
  git: { root: SHOP, branch: 'main', yours: [], todos: [] }, warnings: [], ...over,
});
const hereIds = (c: CatchUp) => c.here?.rows.map((r) => r.sessionId);

test('puts waiting first, then finished, then failed', () => {
  expect(buildCatchUp(input()).here?.rows.map((r) => r.status)).toEqual(['waiting', 'finished', 'failed']);
});

test('counts every session it was given, minus the excluded one', () => {
  expect(buildCatchUp(input()).sessions).toBe(4);
  expect(buildCatchUp(input({ excludeSessionId: 'c-wait' })).sessions).toBe(3);
});

test('measures time away from your last message in this project', () => {
  expect(buildCatchUp(input()).awayMs).toBe(47 * 60_000);
});

// "yours" also holds files an agent changed through a shell command (formatters, sed -i, codegen), so it can't say you were back.
test("your own edit doesn't move the window", () => {
  const talk = session({ id: 'talk', tool: 'claude', cwd: SHOP, events: [user(59), agent(40, 'Done.'), turnEnd(40)] });
  const c = buildCatchUp(input({ sessions: [talk], git: { root: SHOP, branch: 'main', yours: [change('src/cart.ts', 30)], todos: [] } }));
  expect(c.awayMs).toBe(59 * 60_000);
  expect(hereIds(c)).toEqual(['talk']);
});

test('shows a waiting session from before the window', () => {
  const old = session({ id: 'c-old', tool: 'claude', cwd: BLOG, events: [{ kind: 'user', at: NOW - 3 * 86_400_000 - 60_000, text: 'x' }, { kind: 'ask', at: NOW - 3 * 86_400_000, reason: 'question', text: 'Which one?' }] });
  const c = buildCatchUp(input({ sessions: [gOne, old] }));
  expect(c.elsewhere.map((r) => r.sessionId)).toEqual(['c-old', 'g-1']);
});

test('hides finished work you already saw', () => {
  const sessions = [finished('seen', 120), session({ id: 'talk', tool: 'claude', cwd: SHOP, events: [user(60), agent(5, 'Sure.'), turnEnd(5)] })];
  expect(hereIds(buildCatchUp(input({ sessions })))).toEqual(['talk']);
});

test('falls back to 8 hours on a first run', () => {
  const c = buildCatchUp(input({ sessions: [finished('in', 420), finished('out', 540)] }));
  expect(hereIds(c)).toEqual(['in']);
  expect(c.awayMs).toBeNull();
});

test('--since overrides the window', () => {
  const talk = session({ id: 'talk', tool: 'claude', cwd: SHOP, events: [user(10), agent(5, 'Sure.'), turnEnd(5)] });
  const c = buildCatchUp(input({ sessions: [finished('in', 100), finished('out', 130), talk], sinceMs: 7_200_000 }));
  expect(hereIds(c)).toEqual(['talk', 'in']);
  expect(c.awayMs).toBeNull();
});

test('drops the excluded session', () => {
  const c = buildCatchUp(input({ excludeSessionId: 'c-wait' }));
  expect(hereIds(c)).toEqual(['c-done', 'x-fail']);
  expect(c.awayMs).toBe(55 * 60_000); // c-wait's message at 47 no longer sets it
});

test('builds next steps in priority order', () => {
  const yours = [change('src/cart.ts', 47), change('src/routes/auth.ts', 47)];
  const todos = [{ file: 'src/routes/auth.ts', line: 42, text: 'reset count after a good login' }];
  expect(buildCatchUp(input({ git: { root: SHOP, branch: 'main', yours, todos } })).next).toEqual([
    { label: 'answer Claude', command: 'claude --resume c-wait' },
    { label: 'see what broke', command: 'codex resume x-fail' },
    { label: 'review "add login rate limit"', command: 'git diff main...login-rate-limit' },
  ]);
});

test('offers a TODO when nothing else is open', () => {
  const todos = [{ file: 'src/routes/auth.ts', line: 42, text: 'reset count after a good login' }];
  const c = buildCatchUp(input({ sessions: [], git: { root: SHOP, branch: 'main', yours: [change('src/routes/auth.ts', 5)], todos } }));
  expect(c.next).toEqual([{ label: 'pick up your TODO', command: 'src/routes/auth.ts:42' }]);
  expect(c.here?.you).toEqual({ changes: [change('src/routes/auth.ts', 5)], todos });
});

test('has no HERE section when nothing happened here and you changed nothing', () => {
  const c = buildCatchUp(input({ sessions: [gOne] }));
  expect(c.here).toBeNull();
  expect(c.elsewhere.map((r) => r.sessionId)).toEqual(['g-1']);
  expect(buildCatchUp(input({ sessions: [cWait] })).here?.you).toBeNull();
});

test('prefixes cd for sessions in another folder', () => {
  const c = buildCatchUp(input());
  expect(c.elsewhere[0].resume).toBe('cd ~/code/blog && gemini --resume g-1');
  expect(c.here?.rows[0].resume).toBe('claude --resume c-wait');
});

// R20: quote the folder only when it needs it; a leading ~/ stays outside the quotes so the shell still expands it.
test.each([
  ['a space', '/h/My Projects/blog', "cd ~/'My Projects/blog' && claude --resume c2"],
  ['a semicolon', '/h/My Projects/blog; rm -rf x', "cd ~/'My Projects/blog; rm -rf x' && claude --resume c2"],
  ['a single quote', "/h/it's here", "cd ~/'it'\\''s here' && claude --resume c2"],
  ['a space outside the home folder', '/srv/my app', "cd '/srv/my app' && claude --resume c2"],
  ['only safe characters', '/h/code/a-b_c.d@e+f', 'cd ~/code/a-b_c.d@e+f && claude --resume c2'],
])('quotes a resume folder with %s', (_name, cwd, resume) => {
  const s = session({ id: 'c2', tool: 'claude', cwd, events: [user(10), agent(5, 'Done.'), turnEnd(5)] });
  expect(buildCatchUp(input({ sessions: [s] })).elsewhere[0].resume).toBe(resume);
});

test('quotes a session id and a branch that the shell would read as commands', () => {
  const s = session({ id: 'x; rm -rf ~', tool: 'codex', cwd: SHOP, branch: 'a;b', events: [user(10), agent(5, 'Done.'), turnEnd(5)] });
  const c = buildCatchUp(input({ sessions: [s] }));
  expect(c.here!.rows[0].resume).toBe("codex resume 'x; rm -rf ~'");
  expect(c.next).toEqual([{ label: 'review "x; rm -rf ~"', command: "git diff main...'a;b'" }]);
});

test('lists edited files newest first, relative to the session folder, at most 5', () => {
  const events = [
    user(30),
    edit(20, `${SHOP}/a.ts`, `${SHOP}/b.ts`),
    edit(10, '/h/notes/todo.md', `${SHOP}/a.ts`),
    edit(9, '/etc/hosts', `${SHOP}/c.ts`, `${SHOP}/d.ts`),
    turnEnd(8),
  ];
  const [row] = buildCatchUp(input({ sessions: [session({ id: 'many', tool: 'claude', cwd: SHOP, events })] })).here!.rows;
  expect(row.files).toEqual(['/etc/hosts', 'c.ts', 'd.ts', '~/notes/todo.md', 'a.ts']); // a.ts once, b.ts cut
});

test('collects the files agents edited in one project', () => {
  const files = agentEditedFiles(SCENARIO, SHOP);
  expect([...files].sort()).toEqual([`${SHOP}/package.json`, `${SHOP}/src/middleware/rateLimit.ts`]);
});

// realpath, because the tmp folder is a symlink on macOS and project keys are real paths.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brb-catchup-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('treats a symlink to this folder as this folder', () => {
  const app = path.join(tmp, 'app');
  fs.mkdirSync(app);
  fs.symlinkSync(app, path.join(tmp, 'link'));
  const s = session({ id: 'c-link', tool: 'claude', cwd: path.join(tmp, 'link'), events: [user(5), agent(4, 'Done.'), turnEnd(4)] });
  const c = buildCatchUp(input({ cwd: app, home: tmp, sessions: [s], git: { root: app, branch: 'main', yours: [], todos: [] } }));
  expect(c.here?.rows[0].resume).toBe('claude --resume c-link');
});
