import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readClaudeSessions } from '../../src/adapters/claude';
import { HEAD_BYTES, SCAN_MS, TAIL_BYTES } from '../../src/adapters/files';
import { classify } from '../../src/classify';
import type { Session } from '../../src/types';
import { cl, iso, makeFakeHome, writeClaudeSession } from '../support/fake-home';
import type { FakeHome } from '../support/fake-home';

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;
const DAY = 86_400_000;

const read = (h: FakeHome) => readClaudeSessions(h.claude, { now: NOW, sinceMs: NOW - SCAN_MS });
const byId = (sessions: Session[], id: string) => sessions.find((s) => s.id === id)!;
const kinds = (s: Session) => s.events.map((e) => e.kind);

// Every home a test makes is removed afterwards.
const homes: FakeHome[] = [];
const fakeHome = () => {
  const h = makeFakeHome();
  homes.push(h);
  return h;
};
afterEach(() => {
  for (const h of homes.splice(0)) fs.rmSync(h.home, { recursive: true, force: true });
});

// More than the head and tail windows hold together, so the reader has to skip a middle section.
const FILLER = 400_000;

test('reads a session waiting on a question', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/shopfront', lines: [
    cl.title('fix checkout rounding'), cl.user('fix the checkout rounding bug', min(47)),
    cl.tool('t1', 'AskUserQuestion', { questions: [{ question: 'Round per item or on the total?' }] }, min(8))] });
  const [s] = await read(h);
  expect(s).toMatchObject({ tool: 'claude', id: 'c1', cwd: '/w/shopfront', title: 'fix checkout rounding', branch: 'main', lastActivityAt: min(8) });
  expect(s.events.map(e => e.kind)).toEqual(['user', 'ask']);
  expect(s.events[1]).toMatchObject({ reason: 'question', text: 'Round per item or on the total?' });
  expect(s.partialTurn).toBeUndefined(); // the whole file was read
});

test('turns tool results into commands and edits', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('add a rate limiter', min(60)),
    cl.tool('w1', 'Write', { file_path: '/w/app/src/rateLimit.ts', content: '// limiter' }, min(41)),
    cl.result('w1', 'File created successfully', min(40)),
    cl.tool('b1', 'Bash', { command: 'npm test' }, min(15)),
    cl.result('b1', 'FAIL 1 test', min(14), true),
    cl.tool('b2', 'Bash', { command: 'npm test' }, min(14)),
    cl.result('b2', 'Tests: 6 passed', min(13)),
    cl.say('Added 6 tests, all passing.', min(12)),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'edit', 'command', 'command', 'agent', 'turn-end']);
  expect(s.events[1]).toEqual({ kind: 'edit', at: min(40), files: ['/w/app/src/rateLimit.ts'] });
  expect(s.events.filter((e) => e.kind === 'command')).toEqual([
    { kind: 'command', at: min(14), command: 'npm test', ok: false, output: 'FAIL 1 test' },
    { kind: 'command', at: min(13), command: 'npm test', ok: true, output: 'Tests: 6 passed' },
  ]);
  expect(s.events.at(-1)).toEqual({ kind: 'turn-end', at: min(12) });
});

test('an answered question is not an ask', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('pick a color', min(10)),
    cl.tool('q1', 'AskUserQuestion', { questions: [{ question: 'Which color?' }] }, min(9)),
    cl.result('q1', 'blue', min(8)),
    cl.say('Using blue.', min(7)),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'agent', 'turn-end']);
});

test('skips side-agent lines and prompts the system wrote', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', sidechain: [1], lines: [
    cl.notice('Background task finished', min(30)),
    cl.user('summarize the changelog', min(29)),
    cl.user('fix the login bug', min(28)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([{ kind: 'user', at: min(28), text: 'fix the login bug' }]);
  expect(s.title).toBe('fix the login bug');
});

test('also skips scheduled runs, system prompts and meta lines', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('fix the login bug', min(30)),
    { ...cl.user('nightly check', min(29)), turnOrigin: 'scheduled' },
    { ...cl.user('a background task finished', min(26)), turnOrigin: 'task_notification' },
    { ...cl.user('a hook says hi', min(28)), promptSource: 'system', turnOrigin: undefined },
    { ...cl.user('Caveat: local command output follows', min(27)), isMeta: true },
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([{ kind: 'user', at: min(30), text: 'fix the login bug' }]);
});

test('a prompt from a peer session is not the human talking, and does not end the turn', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('add a rate limiter', min(30)),
    cl.tool('w1', 'Write', { file_path: '/w/app/src/rateLimit.ts' }, min(29)),
    cl.result('w1', 'File created successfully', min(28)),
    { ...cl.user('a note from the other session', min(27)), turnOrigin: 'peer' },
    { ...cl.user('another, written the way real files do', min(26)), promptSource: 'system', turnOrigin: 'peer' },
    cl.say('Added the limiter. Want me to add tests too?', min(25)),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'edit', 'agent', 'turn-end']);
  expect(s.events[0]).toEqual({ kind: 'user', at: min(30), text: 'add a rate limiter' }); // still where the turn starts
  // Were a peer prompt a new turn, the edit would fall outside it and the closing question would read as waiting.
  expect(classify(s, NOW).status).toBe('finished');
});

test('a peer prompt after the last reply does not reopen the turn', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('fix the login bug', min(30)),
    cl.say('Done.', min(25)),
    { ...cl.user('a note from the other session', min(20)), turnOrigin: 'peer' },
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'agent', 'turn-end']);
  expect(s.lastActivityAt).toBe(min(25));
  expect(classify(s, NOW)).toMatchObject({ status: 'finished', detail: 'Done.' });
});

test('a peer prompt does not make the last turn of a long session look fully read', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', filler: FILLER, lines: [
    cl.user('fix the login bug', min(90)),
    { ...cl.user('a note from the other session', min(3)), turnOrigin: 'peer' },
    cl.say('Want me to add tests too?', min(2)),
  ] });
  const [s] = await read(h);
  expect(s.partialTurn).toBe(true); // the human prompt is still outside the read window
  expect(classify(s, NOW).status).toBe('finished');
});

test('a prompt whose origin is the system, with no prompt source, is not the human talking', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('add a rate limiter', min(30)),
    cl.tool('w1', 'Write', { file_path: '/w/app/src/rateLimit.ts' }, min(29)),
    cl.result('w1', 'File created successfully', min(28)),
    { ...cl.user('a message the system wrote', min(27)), promptSource: undefined, turnOrigin: 'system' },
    cl.say('Added the limiter. Want me to add tests too?', min(25)),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'edit', 'agent', 'turn-end']);
  // As a turn start it would put the edit outside the turn, and the closing question would read as waiting.
  expect(classify(s, NOW).status).toBe('finished');
});

// A user line that carries a tool result is the harness answering the agent, whatever text rides along with it.
const withNote = (id: string, at: number, order: 'result first' | 'note first') => {
  const result = { type: 'tool_result', tool_use_id: id, content: 'contents', is_error: false };
  const note = { type: 'text', text: 'a note that rides along with the result' };
  return { ...cl.result(id, '', at), message: { role: 'user', content: order === 'result first' ? [result, note] : [note, result] } };
};

test('a user line that carries a tool result is never a human prompt', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('add a rate limiter', min(30)),
    cl.tool('w1', 'Write', { file_path: '/w/app/src/rateLimit.ts' }, min(29)),
    cl.result('w1', 'File created successfully', min(28)),
    cl.tool('r1', 'Read', { file_path: '/w/app/src/cart.ts' }, min(27)),
    withNote('r1', min(26), 'result first'),
    cl.tool('r2', 'Read', { file_path: '/w/app/src/pay.ts' }, min(25)),
    withNote('r2', min(24), 'note first'),
    cl.say('Added the limiter. Want me to add tests too?', min(22)),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'edit', 'agent', 'turn-end']); // the one prompt is the human's
  // Were a note a prompt, it would start a new turn without the edit, and the closing question would read as waiting.
  expect(classify(s, NOW).status).toBe('finished');
});

test('an interrupt notice that rides along with a tool result is still an interrupt', async () => {
  const h = fakeHome();
  const refused = "The user doesn't want to proceed with this tool use.";
  const interrupted = { ...cl.result('b1', refused, min(8), true), message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'b1', content: refused, is_error: true },
    { type: 'text', text: '[Request interrupted by user for tool use]' },
  ] } };
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('run the build', min(10)),
    cl.tool('b1', 'Bash', { command: 'npm run build' }, min(9)),
    interrupted,
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'run the build' },
    { kind: 'command', at: min(8), command: 'npm run build', ok: false, output: refused },
    { kind: 'error', at: min(8), text: 'interrupted' },
  ]);
});

test('queued prompts, accepted suggestions and prompts sent through the SDK are still the human talking', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    { ...cl.user('run the tests', min(20)), promptSource: 'suggestion_accepted' },
    { ...cl.user('and update the docs', min(19)), promptSource: 'queued' },
    { ...cl.user('then open a PR', min(18)), promptSource: 'sdk', turnOrigin: 'sdk' },
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(20), text: 'run the tests' },
    { kind: 'user', at: min(19), text: 'and update the docs' },
    { kind: 'user', at: min(18), text: 'then open a PR' },
  ]);
});

test('treats an interrupt and an API error as errors', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('fix the login bug', min(30)),
    cl.say('On it', min(29), 'tool_use'),
    cl.user('[Request interrupted by user]', min(28)),
    cl.apiError(min(27)),
    { type: 'system', subtype: 'turn_duration', timestamp: iso(min(26)) },
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'agent', 'error', 'error']);
  expect(s.events[2]).toEqual({ kind: 'error', at: min(28), text: 'interrupted' });
  expect(s.events[3]).toEqual({ kind: 'error', at: min(27), text: 'API error' });
});

test('treats an interrupt written as text blocks, even during a tool call, as an error', async () => {
  const h = fakeHome();
  const interrupt = { ...cl.user('', min(8)), promptSource: undefined, turnOrigin: undefined,
    message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } };
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [cl.user('run the build', min(10)), interrupt] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'run the build' },
    { kind: 'error', at: min(8), text: 'interrupted' },
  ]);
});

test("ignores old files and brb's own summary sessions", async () => {
  const h = fakeHome();
  const lines = [cl.user('fix the login bug', min(30))];
  writeClaudeSession(h, { id: 'recent', cwd: '/w/app', lines });
  writeClaudeSession(h, { id: 'old', cwd: '/w/old', lines, mtimeMs: NOW - 8 * DAY });
  writeClaudeSession(h, { id: 'summary', cwd: '/tmp/brb-summaries', lines });
  expect((await read(h)).map((s) => s.id)).toEqual(['recent']);

  const onlyOld = fakeHome();
  writeClaudeSession(onlyOld, { id: 'old', cwd: '/w/old', lines, mtimeMs: NOW - 8 * DAY });
  expect(await read(onlyOld)).toEqual([]);
  const onlySummary = fakeHome();
  writeClaudeSession(onlySummary, { id: 'summary', cwd: '/tmp/brb-summaries', lines });
  expect(await read(onlySummary)).toEqual([]);
});

test('returns nothing when there is no Claude folder', async () => {
  expect(await read(fakeHome())).toEqual([]);
});

test('survives half-written lines', async () => {
  const h = fakeHome();
  const file = writeClaudeSession(h, { id: 'c1', cwd: '/w/app', filler: FILLER, lines: [
    cl.user('fix the login bug', min(90)),
    cl.say('Still going', min(2), 'tool_use'),
  ] });
  fs.appendFileSync(file, '{"type":"assist'); // the agent is writing this line right now
  // Appending made the file newer than its last event. Pin that time so the file stays in the scan window on any clock.
  fs.utimesSync(file, new Date(min(1)), new Date(min(1)));
  const [s] = await read(h);
  expect(s.title).toBe('fix the login bug');
  expect(s.events.some((e) => e.kind === 'ask')).toBe(false);
  expect(s.lastActivityAt).toBe(min(2));
});

test('survives a half-written last line in a file read whole', async () => {
  const h = fakeHome();
  const file = writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [cl.user('fix the login bug', min(5)), cl.say('Still going', min(2), 'tool_use')] });
  fs.appendFileSync(file, '{"type":"assist');
  fs.utimesSync(file, new Date(min(1)), new Date(min(1)));
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'agent']);
  expect(s.lastActivityAt).toBe(min(2));
  expect(s.partialTurn).toBeUndefined();
});

// A long session is read as its first and last bytes. What happened in between is unseen, so a status
// taken from the part that was read must never be a guess (Review Focus 3).

test('never guesses waiting when the turn began before the read window', async () => {
  const h = fakeHome();
  const lines = [cl.user('fix the login bug', min(90)), cl.say('Want me to add tests too?', min(2))];
  writeClaudeSession(h, { id: 'long', cwd: '/w/app', filler: FILLER, lines });
  writeClaudeSession(h, { id: 'short', cwd: '/w/app2', lines });
  const sessions = await read(h);
  const long = byId(sessions, 'long');
  expect(kinds(long)).toEqual(['user', 'agent', 'turn-end']); // each line once, head and tail alike
  expect(long.partialTurn).toBe(true);
  expect(classify(long, NOW).status).toBe('finished');
  // The same words in a file that was read whole are a real question.
  expect(byId(sessions, 'short').partialTurn).toBeUndefined();
  expect(classify(byId(sessions, 'short'), NOW).status).toBe('waiting');
});

test('reads the last turn whole when its prompt is inside the read window', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', filler: FILLER, lines: [
    cl.user('an old prompt', min(200)),
    cl.user('fix the login bug', min(3)),
    cl.say('Want me to add tests too?', min(2)),
  ] });
  const [s] = await read(h);
  expect(s.partialTurn).toBeUndefined();
  expect(classify(s, NOW).status).toBe('waiting');
});

test('ignores a question from before the read window', async () => {
  const h = fakeHome();
  const lines = [cl.tool('t1', 'AskUserQuestion', { questions: [{ question: 'Which one?' }] }, min(89)), cl.say('Done.', min(5))];
  writeClaudeSession(h, { id: 'long', cwd: '/w/app', filler: FILLER, lines });
  writeClaudeSession(h, { id: 'short', cwd: '/w/app2', lines });
  const sessions = await read(h);
  expect(kinds(byId(sessions, 'long'))).toEqual(['agent', 'turn-end']); // no ask: its answer may sit in the skipped bytes
  expect(byId(sessions, 'short').events.some((e) => e.kind === 'ask')).toBe(true);
});

test('ignores a plan from before the read window, and keeps one inside it', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'old-plan', cwd: '/w/a', filler: FILLER, lines: [cl.tool('p1', 'ExitPlanMode', { plan: 'x' }, min(89)), cl.say('Done.', min(5))] });
  writeClaudeSession(h, { id: 'new-plan', cwd: '/w/b', filler: FILLER, lines: [cl.user('plan it', min(90)), cl.tool('p1', 'ExitPlanMode', { plan: 'x' }, min(5))] });
  const sessions = await read(h);
  expect(byId(sessions, 'old-plan').events.some((e) => e.kind === 'ask')).toBe(false);
  expect(byId(sessions, 'new-plan').events.at(-1)).toEqual({ kind: 'ask', at: min(5), reason: 'plan', text: '' });
});

test('keeps a question that sits inside the read window', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', filler: FILLER, lines: [
    cl.user('fix the login bug', min(90)),
    cl.tool('t1', 'AskUserQuestion', { questions: [{ question: 'Which one?' }] }, min(3)),
  ] });
  const [s] = await read(h);
  expect(s.events.at(-1)).toMatchObject({ kind: 'ask', reason: 'question', text: 'Which one?' });
  expect(classify(s, NOW).status).toBe('waiting');
});

test('keeps only the end of a long command output', async () => {
  const h = fakeHome();
  const output = 'HEAD' + 'x'.repeat(9_000) + 'TAIL';
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('build it', min(10)),
    cl.tool('b1', 'Bash', { command: 'npm run build' }, min(9)),
    cl.result('b1', output, min(8), true),
  ] });
  const [s] = await read(h);
  const command = s.events.find((e) => e.kind === 'command');
  expect(command).toMatchObject({ command: 'npm run build', ok: false });
  const kept = command?.kind === 'command' ? command.output : '';
  expect(kept).toBe('x'.repeat(3_996) + 'TAIL');
  expect(kept).toHaveLength(4_000);
});

test('a plan nobody has approved is an ask, an approved one is not', async () => {
  const h = fakeHome();
  const plan = [cl.user('add rate limiting', min(20)), cl.tool('p1', 'ExitPlanMode', { plan: 'Add a limiter in the middleware' }, min(10))];
  writeClaudeSession(h, { id: 'open', cwd: '/w/open', lines: plan });
  writeClaudeSession(h, { id: 'approved', cwd: '/w/approved', lines: [...plan, cl.result('p1', 'User has approved your plan', min(9))] });
  const sessions = await read(h);
  expect(byId(sessions, 'open').events.at(-1)).toEqual({ kind: 'ask', at: min(10), reason: 'plan', text: '' });
  expect(kinds(byId(sessions, 'approved'))).toEqual(['user']);
});

test('an unanswered question without text still says it has one', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [cl.user('help', min(10)), cl.tool('q1', 'AskUserQuestion', {}, min(9))] });
  const [s] = await read(h);
  expect(s.events.at(-1)).toEqual({ kind: 'ask', at: min(9), reason: 'question', text: 'has a question for you' });
});

test('records only edits that worked, and ignores results it never saw the call for', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('rename things', min(30)),
    cl.tool('e1', 'Edit', { file_path: '/w/app/a.ts' }, min(29)), cl.result('e1', 'The file has been updated', min(28)),
    cl.tool('e2', 'Edit', { file_path: '/w/app/b.ts' }, min(27)), cl.result('e2', 'String to replace not found', min(26), true),
    cl.tool('m1', 'MultiEdit', { file_path: '/w/app/c.ts', edits: [] }, min(25)), cl.result('m1', 'ok', min(24)),
    cl.tool('n1', 'NotebookEdit', { notebook_path: '/w/app/d.ipynb' }, min(23)), cl.result('n1', 'ok', min(22)),
    cl.tool('r1', 'Read', { file_path: '/w/app/e.ts' }, min(21)), cl.result('r1', 'contents', min(20)),
    cl.result('missing', 'a result for a call that was never seen', min(19)),
  ] });
  const [s] = await read(h);
  expect(s.events.filter((e) => e.kind === 'edit').map((e) => (e.kind === 'edit' ? e.files : []))).toEqual([['/w/app/a.ts'], ['/w/app/c.ts'], ['/w/app/d.ipynb']]);
  expect(kinds(s)).toEqual(['user', 'edit', 'edit', 'edit']);
});

test('puts events in time order and joins the text blocks of a prompt', async () => {
  const h = fakeHome();
  const prompt = { ...cl.user('replaced below', min(10)),
    message: { role: 'user', content: [{ type: 'text', text: 'first part' }, { type: 'image', source: {} }, { type: 'text', text: 'second part' }] } };
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [cl.say('later', min(5)), prompt] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'first part\nsecond part' },
    { kind: 'agent', at: min(5), text: 'later' },
    { kind: 'turn-end', at: min(5) },
  ]);
  expect(s.lastActivityAt).toBe(min(5));
});

test('names a session by its custom title, then its agent name, then its first prompt', async () => {
  const h = fakeHome();
  const prompt = cl.user('first prompt', min(30));
  writeClaudeSession(h, { id: 'custom', cwd: '/w/custom', lines: [prompt, cl.title('old name'), cl.title('new name'), { type: 'agent-name', agentName: 'builder' }] });
  writeClaudeSession(h, { id: 'agent', cwd: '/w/agent', lines: [prompt, { type: 'agent-name', agentName: 'builder' }] });
  writeClaudeSession(h, { id: 'prompt', cwd: '/w/prompt', lines: [cl.user('fix the\n\x1b[31mlogin\x1b[0m bug', min(30))] });
  writeClaudeSession(h, { id: 'none', cwd: '/w/none', lines: [cl.say('hello', min(30))] });
  writeClaudeSession(h, { id: 'long', cwd: '/w/long', lines: [cl.user('a'.repeat(100), min(30))] });
  writeClaudeSession(h, { id: 'messy-custom', cwd: '/w/messy-custom', lines: [cl.title(`\x1b[1mbold\x1b[0m name\n${'z'.repeat(80)}`)] });
  writeClaudeSession(h, { id: 'messy-agent', cwd: '/w/messy-agent', lines: [{ type: 'agent-name', agentName: 'two\nlines' }] });
  const sessions = await read(h);
  expect(byId(sessions, 'custom').title).toBe('new name');
  expect(byId(sessions, 'agent').title).toBe('builder');
  expect(byId(sessions, 'prompt').title).toBe('fix the login bug');
  expect(byId(sessions, 'none').title).toBe('untitled session');
  expect(byId(sessions, 'long').title).toBe('a'.repeat(59) + '…');
  expect(byId(sessions, 'messy-custom').title).toBe('bold name ' + 'z'.repeat(49) + '…');
  expect(byId(sessions, 'messy-agent').title).toBe('two lines');
});

// The full order of a title: custom title, agent name, ai-title, first prompt.
test('an ai-title names a session that has no custom title or agent name', async () => {
  const h = fakeHome();
  const prompt = cl.user('fix the login bug', min(30));
  writeClaudeSession(h, { id: 'ai', cwd: '/w/ai', lines: [prompt, cl.aiTitle('Fix login redirect loop')] });
  writeClaudeSession(h, { id: 'last', cwd: '/w/last', lines: [prompt, cl.aiTitle('First guess'), cl.aiTitle('Better title'), cl.aiTitle('')] });
  writeClaudeSession(h, { id: 'messy', cwd: '/w/messy', lines: [prompt, cl.aiTitle(`\x1b[1mbold\x1b[0m title\n${'z'.repeat(80)}`)] });
  writeClaudeSession(h, { id: 'empty', cwd: '/w/empty', lines: [prompt, cl.aiTitle('')] });
  writeClaudeSession(h, { id: 'invisible', cwd: '/w/invisible', lines: [prompt, cl.aiTitle('\x1b[0m')] });
  const sessions = await read(h);
  expect(byId(sessions, 'ai').title).toBe('Fix login redirect loop'); // ahead of the first prompt
  expect(byId(sessions, 'last').title).toBe('Better title'); // the last one wins, and a blank one after it does not erase it
  expect(byId(sessions, 'messy').title).toBe('bold title ' + 'z'.repeat(48) + '…'); // cleaned and cut like any title
  expect(byId(sessions, 'empty').title).toBe('fix the login bug'); // an empty one names nothing
  expect(byId(sessions, 'invisible').title).toBe('fix the login bug'); // nor does one that is empty once cleaned
});

test('a custom title or an agent name beats an ai-title, wherever the lines sit', async () => {
  const h = fakeHome();
  const prompt = cl.user('fix the login bug', min(30));
  writeClaudeSession(h, { id: 'custom-first', cwd: '/w/a', lines: [prompt, cl.title('chosen name'), cl.aiTitle('generated')] });
  writeClaudeSession(h, { id: 'custom-last', cwd: '/w/b', lines: [prompt, cl.aiTitle('generated'), cl.title('chosen name')] });
  writeClaudeSession(h, { id: 'agent', cwd: '/w/c', lines: [prompt, cl.aiTitle('generated'), { type: 'agent-name', agentName: 'builder' }] });
  const sessions = await read(h);
  expect(byId(sessions, 'custom-first').title).toBe('chosen name');
  expect(byId(sessions, 'custom-last').title).toBe('chosen name');
  expect(byId(sessions, 'agent').title).toBe('builder');
});

test('names a long session from its ai-title when its first prompt was never read', async () => {
  const h = fakeHome();
  // The first prompt sits after the head window and before the tail window, so only the ai-title line is read.
  writeClaudeSession(h, { id: 'long', cwd: '/w/app', filler: 20_000, lines: [
    { type: 'attachment' },
    cl.user('fix the login bug', min(99)),
    cl.result('pad', 'x'.repeat(70_000), min(98)),
    cl.aiTitle('Fix login redirect loop'),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([]); // the prompt really was not read
  expect(s.title).toBe('Fix login redirect loop');
});

test('takes the folder and branch from the last lines, and no branch from a detached HEAD', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'moved', cwd: '/w/app', branch: 'feature/login', lines: [
    cl.user('start here', min(10)),
    { ...cl.say('now somewhere else', min(5)), cwd: '/w/app-worktree', gitBranch: 'login-v2' },
  ] });
  writeClaudeSession(h, { id: 'detached', cwd: '/w/other', branch: 'HEAD', lines: [cl.user('hi', min(5))] });
  writeClaudeSession(h, { id: 'plain', cwd: '/w/plain', branch: 'feature/login', lines: [cl.user('hi', min(5))] });
  const sessions = await read(h);
  expect(byId(sessions, 'moved')).toMatchObject({ cwd: '/w/app-worktree', branch: 'login-v2' });
  expect(byId(sessions, 'detached').branch).toBeUndefined();
  expect(byId(sessions, 'plain').branch).toBe('feature/login');
});

test('a session with no events keeps the time its file last changed', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'quiet', cwd: '/w/app', lines: [cl.title('just a name')], mtimeMs: min(30) });
  const [s] = await read(h);
  expect(s).toMatchObject({ title: 'just a name', events: [], lastActivityAt: min(30) });
});

test('skips a file that holds only side-agent lines', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'agent-1', cwd: '/w/app', sidechain: [0, 1], lines: [cl.user('a sub task', min(5)), cl.say('done', min(4))] });
  expect(await read(h)).toEqual([]);
});

test('reads every project folder', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'a', cwd: '/w/one', lines: [cl.user('one', min(5))] });
  writeClaudeSession(h, { id: 'b', cwd: '/w/two', lines: [cl.user('two', min(5))] });
  writeClaudeSession(h, { id: 'c', cwd: '/w/two', lines: [cl.user('three', min(5))] });
  expect((await read(h)).map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
});

test('a prompt that only mentions an interrupt is still a prompt', async () => {
  const h = fakeHome();
  const text = 'why does "[Request interrupted by user]" show up in my logs?';
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [cl.user(text, min(5))] });
  const [s] = await read(h);
  expect(s.events).toEqual([{ kind: 'user', at: min(5), text }]);
});

test('ignores lines that have no usable time', async () => {
  const h = fakeHome();
  const noTime = (line: { timestamp: string }) => ({ ...line, timestamp: undefined });
  const badTime = (line: { timestamp: string }) => ({ ...line, timestamp: 'yesterday' });
  const numberTime = (line: { timestamp: string }) => ({ ...line, timestamp: 5 });
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('fix the login bug', min(10)),
    noTime(cl.say('lost in time', min(9))),
    badTime(cl.say('also lost', min(8))),
    numberTime(cl.say('lost too', min(7))),
    cl.say('Done.', min(5)),
  ] });
  const [s] = await read(h);
  expect(s.events).toEqual([
    { kind: 'user', at: min(10), text: 'fix the login bug' },
    { kind: 'agent', at: min(5), text: 'Done.' },
    { kind: 'turn-end', at: min(5) },
  ]);
  expect(s.lastActivityAt).toBe(min(5));
});

test('ignores a Bash call that has no command, and a reply with no words', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [
    cl.user('run it', min(10)),
    cl.tool('b1', 'Bash', {}, min(9)), cl.result('b1', 'whatever', min(8)),
    cl.say('   ', min(5)),
  ] });
  const [s] = await read(h);
  expect(kinds(s)).toEqual(['user', 'turn-end']);
});

test('takes the session id from the lines, and the file name only when they have none', async () => {
  const h = fakeHome();
  const dir = path.join(h.claude, 'projects', '-w-app');
  fs.mkdirSync(dir, { recursive: true });
  const line = (extra: object) => `${JSON.stringify({ type: 'user', timestamp: iso(min(5)), cwd: '/w/app', message: { role: 'user', content: 'hi' }, ...extra })}\n`;
  fs.writeFileSync(path.join(dir, 'file-name.jsonl'), line({ sessionId: 'id-in-the-lines' }));
  fs.writeFileSync(path.join(dir, 'abc-123.jsonl'), line({}));
  const sessions = await read(h);
  expect(sessions.map((s) => s.id).sort()).toEqual(['abc-123', 'id-in-the-lines']);
  // A bare line, with none of the optional fields, still reads as a prompt.
  expect(byId(sessions, 'abc-123').events).toEqual([{ kind: 'user', at: min(5), text: 'hi' }]);
});

test('does not read side-agent transcripts, deeper folders or files that are not .jsonl', async () => {
  const h = fakeHome();
  const file = writeClaudeSession(h, { id: 'c1', cwd: '/w/app', lines: [cl.user('fix the login bug', min(5))] });
  const project = path.dirname(file);
  const copy = (to: string) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file, to);
  };
  copy(path.join(project, 'c1', 'subagents', 'agent-1.jsonl'));
  copy(path.join(project, 'c1', 'nested.jsonl'));
  copy(path.join(project, 'sessions-index.json'));
  expect((await read(h)).map((s) => s.id)).toEqual(['c1']);
});

test('takes the folder from the end of a long session', async () => {
  const h = fakeHome();
  writeClaudeSession(h, { id: 'c1', cwd: '/w/app', filler: FILLER, lines: [
    cl.user('fix the login bug', min(90)),
    { ...cl.say('Moved to a worktree.', min(2)), cwd: '/w/app-worktree', gitBranch: 'login-v2' },
  ] });
  const [s] = await read(h);
  expect(s).toMatchObject({ cwd: '/w/app-worktree', branch: 'login-v2' });
});

test('reads the lines that sit exactly on the edges of the head and tail windows', async () => {
  const h = fakeHome();
  const raw = (line: object) => JSON.stringify({ sessionId: 'edge', cwd: '/w/app', gitBranch: 'main', ...line });
  const bytes = (line: string) => Buffer.byteLength(line) + 1; // with its newline
  // The head window ends on the last character of its last line (that line's newline is the first skipped byte),
  // and the tail window begins on the first character of its first line.
  const firstInHead = raw(cl.user('an old prompt', min(100)));
  const headPad = HEAD_BYTES + 1 - bytes(firstInHead) - bytes(raw(cl.user('', min(99))));
  const lastInHead = raw(cl.user('H'.repeat(headPad), min(99)));
  const firstInTail = raw(cl.say('tail starts here', min(5), 'tool_use'));
  const tailPad = TAIL_BYTES - bytes(firstInTail) - bytes(raw(cl.say('', min(4))));
  const lastInTail = raw(cl.say('X'.repeat(tailPad), min(4)));
  const skipped = raw(cl.user('a prompt in the skipped middle', min(50)));

  const dir = path.join(h.claude, 'projects', '-w-app');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'edge.jsonl');
  fs.writeFileSync(file, [firstInHead, lastInHead, skipped, firstInTail, lastInTail].map((line) => `${line}\n`).join(''));
  fs.utimesSync(file, new Date(min(4)), new Date(min(4)));

  const [s] = await read(h);
  expect(s.events.map((e) => [e.kind, e.at, 'text' in e ? e.text.length : 0])).toEqual([
    ['user', min(100), 'an old prompt'.length],
    ['user', min(99), headPad], // the last line of the head is whole, so it counts
    ['agent', min(5), 'tail starts here'.length], // so is the first line of the tail
    ['agent', min(4), tailPad],
    ['turn-end', min(4), 0],
  ]);
  expect(s.partialTurn).toBe(true); // the last prompt is the head's, not the tail's
});
