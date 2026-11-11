import { expect, test } from 'vitest';
import { classify } from '../src/classify';
import type { PermissionRequest, Session, SessionEvent } from '../src/types';

const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const min = (m: number) => NOW - m * 60_000;

const s = (events: SessionEvent[], last = events.at(-1)!.at): Session => ({ tool: 'claude', id: 's1', cwd: '/w/app', title: 't', events, lastActivityAt: last });

const user = (at: number): SessionEvent => ({ kind: 'user', at, text: 'fix the checkout rounding bug' });
const agent = (at: number, text: string): SessionEvent => ({ kind: 'agent', at, text });
const edit = (at: number): SessionEvent => ({ kind: 'edit', at, files: ['/w/app/src/cart.ts'] });
const command = (at: number, ok: boolean, output = '', cmd = 'npm run build'): SessionEvent => ({ kind: 'command', at, command: cmd, ok, output });
const ask = (at: number, reason: 'question' | 'plan', text: string): SessionEvent => ({ kind: 'ask', at, reason, text });
const error = (at: number, text: string): SessionEvent => ({ kind: 'error', at, text });
const turnEnd = (at: number): SessionEvent => ({ kind: 'turn-end', at });

const BUILD_OUTPUT = '> build\n> next build\n\nError: next.config.js: unknown option "ppr"\n';
const PERMISSION_MESSAGE = 'Claude needs your permission to use Bash';

test('a structured question is waiting', () => {
  const events = [user(min(47)), ask(min(8), 'question', 'Round per item or on the total?')];
  expect(classify(s(events), NOW)).toEqual({ status: 'waiting', detail: 'asks: "Round per item or on the total?"', longText: '' });
});

test('a plan is waiting', () => {
  const events = [user(min(10)), ask(min(9), 'plan', '')];
  expect(classify(s(events), NOW)).toEqual({ status: 'waiting', detail: 'has a plan waiting for your approval', longText: '' });
});

test('a fresh permission request is waiting', () => {
  const permission: PermissionRequest = { at: min(3) + 1_000, message: PERMISSION_MESSAGE };
  expect(classify(s([user(min(5))], min(3)), NOW, permission)).toEqual({ status: 'waiting', detail: PERMISSION_MESSAGE, longText: '' });
});

test('a stale permission request is ignored', () => {
  const events = [user(min(5)), agent(min(2), 'Done.'), turnEnd(min(2))];
  const permission: PermissionRequest = { at: min(10), message: PERMISSION_MESSAGE };
  expect(classify(s(events), NOW, permission)).toEqual({ status: 'finished', detail: 'Done.', longText: 'Done.' });
});

test('a finished turn that ends with an offer is finished', () => {
  const said = 'Added 6 tests, all passing. Want me to open a PR?';
  const events = [user(min(60)), edit(min(40)), agent(min(12), said), turnEnd(min(12))];
  expect(classify(s(events), NOW)).toEqual({ status: 'finished', detail: 'Added 6 tests, all passing.', longText: said });
});

test('a question after no work is waiting', () => {
  const said = 'Should I round per item or on the total?';
  const events = [user(min(10)), agent(min(9), said), turnEnd(min(9))];
  expect(classify(s(events), NOW)).toEqual({ status: 'waiting', detail: `asks: "${said}"`, longText: said });
});

test('a failed last command is failed', () => {
  const events = [user(min(55)), command(min(21), false, BUILD_OUTPUT), agent(min(20), 'The build fails.'), turnEnd(min(20))];
  expect(classify(s(events), NOW)).toEqual({
    status: 'failed',
    detail: 'Error: next.config.js: unknown option "ppr"',
    longText: `npm run build\n${BUILD_OUTPUT}`,
  });
});

test('failed then fixed is finished', () => {
  const events = [user(min(30)), command(min(20), false, BUILD_OUTPUT), command(min(15), true), agent(min(14), 'Fixed.'), turnEnd(min(14))];
  expect(classify(s(events), NOW)).toEqual({ status: 'finished', detail: 'Fixed.', longText: 'Fixed.' });
});

test('an interrupt is failed', () => {
  const events = [user(min(10)), agent(min(9), 'On it'), error(min(8), 'interrupted')];
  expect(classify(s(events), NOW)).toEqual({ status: 'failed', detail: 'interrupted', longText: 'interrupted' });
});

test('recent activity without a turn end is working', () => {
  const events = [user(min(5)), command(NOW - 10_000, true)];
  expect(classify(s(events), NOW)).toEqual({ status: 'working', detail: 'working…', longText: '' });
});

test('silence without a turn end is idle, never waiting', () => {
  const events = [user(min(10)), agent(min(5), 'Want me to continue?')];
  expect(classify(s(events), NOW)).toEqual({ status: 'idle', detail: 'no activity for 5 min', longText: 'Want me to continue?' });
});

// Defaults, boundaries and rule details beyond the rows above.

test('working shows the first sentence of what the agent said', () => {
  const said = 'Running the tests now. Standby.';
  const events = [user(min(5)), agent(NOW - 10_000, said)];
  expect(classify(s(events), NOW)).toEqual({ status: 'working', detail: 'Running the tests now.', longText: said });
});

test('a turn that just ended is finished, not working', () => {
  const said = 'Added tests. All passing.';
  const events = [user(min(5)), edit(NOW - 20_000), agent(NOW - 10_000, said), turnEnd(NOW - 10_000)];
  expect(classify(s(events), NOW)).toEqual({ status: 'finished', detail: 'Added tests.', longText: said });
});

test('the detail comes from the last thing the agent said', () => {
  const said = 'Fixed the rounding. Tests pass.';
  const events = [user(min(10)), agent(min(8), 'Looking into it.'), edit(min(6)), agent(min(5), said), turnEnd(min(5))];
  expect(classify(s(events), NOW)).toEqual({ status: 'finished', detail: 'Fixed the rounding.', longText: said });
});

test('the working window is under 60 seconds', () => {
  expect(classify(s([user(min(5))], NOW - 59_999), NOW).status).toBe('working');
  expect(classify(s([user(min(5))], NOW - 60_000), NOW)).toMatchObject({ status: 'idle', detail: 'no activity for 1 min' });
});

test('a permission request counts from 2 seconds before the last activity', () => {
  const at = (ms: number): PermissionRequest => ({ at: min(3) - ms, message: PERMISSION_MESSAGE });
  expect(classify(s([user(min(5))], min(3)), NOW, at(2_000)).status).toBe('waiting');
  expect(classify(s([user(min(5))], min(3)), NOW, at(2_001))).toMatchObject({ status: 'idle', detail: 'no activity for 3 min' });
});

test('a failed command with no output names the command', () => {
  const events = [user(min(10)), command(min(5), false, '', 'npm test'), turnEnd(min(5))];
  expect(classify(s(events), NOW)).toEqual({ status: 'failed', detail: 'npm test failed', longText: 'npm test\n' });
});

test('the long text of a failed command is the command and the end of its output', () => {
  const output = 'HEAD' + 'x'.repeat(2_000) + 'TAIL';
  const events = [user(min(10)), command(min(5), false, output, 'npm test'), turnEnd(min(5))];
  const { longText } = classify(s(events), NOW);
  expect(longText).toBe(`npm test\n${'x'.repeat(1_496)}TAIL`);
  expect(longText).not.toContain('HEAD');
});

test('a finished turn that said nothing is done', () => {
  const events = [user(min(10)), edit(min(5)), turnEnd(min(5))];
  expect(classify(s(events), NOW)).toEqual({ status: 'finished', detail: 'done', longText: '' });
});

test('a question after only running commands is finished', () => {
  const said = 'Tests pass. Want me to add more?';
  const events = [user(min(10)), command(min(6), true, 'Tests: 6 passed', 'npm test'), agent(min(5), said), turnEnd(min(5))];
  expect(classify(s(events), NOW)).toEqual({ status: 'finished', detail: 'Tests pass.', longText: said });
});

test('an error the agent recovered from is not a failure', () => {
  const events = [user(min(10)), error(min(9), 'API error'), agent(min(8), 'Retried. All done.'), turnEnd(min(8))];
  expect(classify(s(events), NOW)).toEqual({ status: 'finished', detail: 'Retried.', longText: 'Retried. All done.' });
});

test('an ask anywhere in the turn is waiting', () => {
  const events = [user(min(10)), ask(min(9), 'question', 'Which one?'), agent(min(8), 'Let me know.'), turnEnd(min(8))];
  expect(classify(s(events), NOW)).toEqual({ status: 'waiting', detail: 'asks: "Which one?"', longText: 'Let me know.' });
});

test('a permission request carries what the agent last said', () => {
  const events = [user(min(5)), agent(min(3), 'Running the build.')];
  const permission: PermissionRequest = { at: min(3), message: PERMISSION_MESSAGE };
  expect(classify(s(events), NOW, permission)).toEqual({ status: 'waiting', detail: PERMISSION_MESSAGE, longText: 'Running the build.' });
});

test('only the last turn counts', () => {
  const events = [
    user(min(90)), command(min(80), false, BUILD_OUTPUT), agent(min(79), 'Which one should I keep?'), turnEnd(min(79)),
    user(min(30)), edit(min(20)), agent(min(10), 'All good now.'), turnEnd(min(10)),
  ];
  expect(classify(s(events), NOW)).toEqual({ status: 'finished', detail: 'All good now.', longText: 'All good now.' });
});

test('without a user event every event is in the turn', () => {
  const events = [command(min(20), false, 'Error: boom'), turnEnd(min(19))];
  expect(classify(s(events), NOW)).toMatchObject({ status: 'failed', detail: 'Error: boom' });
});

test('a question after no work is finished when only part of the turn was read', () => {
  const said = 'Should I round per item or on the total?';
  const events = [user(min(10)), agent(min(9), said), turnEnd(min(9))];
  expect(classify({ ...s(events), partialTurn: true }, NOW)).toEqual({ status: 'finished', detail: said, longText: said });
});

test('a partly read turn still waits on a structured ask', () => {
  const events = [user(min(10)), ask(min(9), 'question', 'Which one?')];
  expect(classify({ ...s(events), partialTurn: true }, NOW)).toEqual({ status: 'waiting', detail: 'asks: "Which one?"', longText: '' });
});

test('a tool call with no result yet is working past the quiet minute, then idle after 10 minutes', () => {
  const pending = (at: number): Session => ({ ...s([user(min(20)), agent(at, 'Running the suite.')]), pendingTool: { at, label: 'npm test' } });
  expect(classify(pending(min(5)), NOW)).toEqual({ status: 'working', detail: 'npm test · no result for 5 min', longText: 'Running the suite.' });
  expect(classify(pending(min(10)), NOW)).toMatchObject({ status: 'idle', detail: 'no activity for 10 min' });
});
