import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, test, vi } from 'vitest';
import { run } from '../src/cli';
import { markSeen, readSeen, seenKey } from '../src/seen';
import { IDS, NOW } from './support/expected';
import { seedScenario } from './support/scenario';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brb-seen-')));
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});
const day = 86_400_000;

test('nothing is seen before the first pick', () => {
  expect(readSeen(path.join(tmp, 'none', '.brb')).size).toBe(0);
});

test('remembers each pick, and the newest time for a session picked twice', () => {
  const brb = path.join(tmp, 'two', '.brb');
  markSeen(brb, seenKey('claude', 'a'), NOW - 10);
  markSeen(brb, seenKey('codex', 'b'), NOW - 5);
  markSeen(brb, seenKey('claude', 'a'), NOW);
  expect([...readSeen(brb)]).toEqual([['claude-a', NOW], ['codex-b', NOW - 5]]);
});

test('forgets picks older than the 7 days brb reads', () => {
  const brb = path.join(tmp, 'old', '.brb');
  markSeen(brb, 'claude-old', NOW - 7 * day - 1);
  markSeen(brb, 'claude-edge', NOW - 7 * day);
  markSeen(brb, 'claude-new', NOW);
  expect([...readSeen(brb).keys()]).toEqual(['claude-edge', 'claude-new']);
});

test.each([['not json'], ['null'], ['[1,2]'], ['{"claude-a":"yesterday"}']])('a seen file holding %s means nothing was seen, and the next pick still saves', (text) => {
  const brb = path.join(tmp, `bad-${text.length}`, '.brb');
  fs.mkdirSync(brb, { recursive: true });
  fs.writeFileSync(path.join(brb, 'seen.json'), text);
  expect([...readSeen(brb).values()].every((at) => typeof at === 'number')).toBe(true);
  expect(readSeen(brb).has('claude-a')).toBe(false);
  markSeen(brb, 'claude-b', NOW);
  expect(readSeen(brb).get('claude-b')).toBe(NOW);
});

test.skipIf(process.platform === 'win32')('the seen file and its folder are private to the user', () => {
  const brb = path.join(tmp, 'private', '.brb');
  markSeen(brb, 'claude-a', NOW);
  expect([brb, path.join(brb, 'seen.json')].map((p) => fs.statSync(p).mode & 0o777)).toEqual([0o700, 0o600]);
});

// End to end, in its own world: picking writes to brb home, and the other test files share theirs.
test('picking a session takes it off the list, the count and the numbering; listing alone does not', async () => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CEILING_DIRECTORIES', tmp);
  const world = seedScenario(path.join(tmp, 'demo'), NOW);
  const brb = (argv: string[], isTTY = false) => run({ argv, env: { HOME: world.home }, cwd: world.repo, now: NOW, isTTY });
  const ids = async (...argv: string[]) => {
    const c = JSON.parse((await brb(['--json', ...argv])).stdout);
    return [...(c.here?.rows ?? []), ...c.elsewhere].map((r: { sessionId: string }) => r.sessionId);
  };
  const seenFile = path.join(world.home, '.brb', 'seen.json');

  // Looking never marks anything: the list, a terminal list, the count, and even naming a row until the caller confirms it.
  await brb([]);
  await brb(['--count']);
  const list = await brb(['--no-ai'], true);
  const named = await brb(['2']);
  expect(fs.existsSync(seenFile)).toBe(false);
  expect(await ids()).toEqual([IDS.wait, IDS.done, IDS.fail, IDS.blog]);

  named.seen!(named.picked!); // what the entry point does for `brb 2`
  expect(await ids()).toEqual([IDS.wait, IDS.fail, IDS.blog]);
  expect((await brb(['--count'])).stdout).toBe('1 waiting · 1 stopped · 1 finished\n');
  expect((await brb(['2'])).stdout).toBe(`→ codex resume ${IDS.fail}\n`); // the numbers closed up

  list.seen!(4); // a pick at the prompt uses the numbers of the list it was shown under
  list.seen!(1); // a waiting session stays however often it is picked
  list.seen!(9); // not on the list: ignored
  expect(await ids()).toEqual([IDS.wait, IDS.fail]);

  const recap = await brb(['show', '2']);
  recap.seen!(recap.show!); // opening a recap counts as a pick too
  expect(await ids()).toEqual([IDS.wait]);
  expect((await brb([])).stdout).not.toContain('upgrade to Next 16');

  expect(await ids('--since', '2h')).toEqual([IDS.wait, IDS.done, IDS.fail, IDS.blog]); // --since brings them back
});

test('a brb home that cannot be written does not stop the pick', async () => {
  const world = seedScenario(path.join(tmp, 'readonly'), NOW);
  fs.writeFileSync(path.join(world.home, '.brb'), 'a file where the folder should be');
  const named = await run({ argv: ['2'], env: { HOME: world.home }, cwd: world.repo, now: NOW, isTTY: false });
  expect(() => named.seen!(named.picked!)).not.toThrow();
  expect(named.stdout).toContain('claude --resume');
});
