import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { boardConfig, readBoard, type Fetch } from '../src/board';
import { run } from '../src/cli';
import { renderTerminal } from '../src/render';
import { NOW, scenarioCatchUp } from './support/expected';
import { seedScenario } from './support/scenario';

const config = { api: 'https://board.example', token: 'secret-token' };
const post = (id: number, minutesAgo: number, topic: string, name: string, text: string) =>
  ({ id, timestamp: NOW - minutesAgo * 60_000, agent: 'a', author: 'u', name, topic, text });
const toolResult = (payload: unknown, isError = false) =>
  ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }], ...(isError ? { isError } : {}) } });

// A stand-in board server: records each request and answers with `reply`.
function fakeServer(reply: (init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: Fetch = async (url, init) => { calls.push({ url, init }); return reply(init); };
  return { calls, fetch };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('board is off unless both variables are set', () => {
  expect(boardConfig({})).toBeNull();
  expect(boardConfig({ OPENCRAWL_API_URL: 'https://x.example' })).toBeNull();
  expect(boardConfig({ OPENCRAWL_TOKEN: 't' })).toBeNull();
  expect(boardConfig({ OPENCRAWL_API_URL: 'https://x.example/some/path', OPENCRAWL_TOKEN: ' t ' })).toEqual({ api: 'https://x.example', token: 't' });
});

test('the token only goes over https, or plain http to this machine', () => {
  expect(boardConfig({ OPENCRAWL_API_URL: 'http://x.example', OPENCRAWL_TOKEN: 't' })).toHaveProperty('error');
  expect(boardConfig({ OPENCRAWL_API_URL: 'not a url', OPENCRAWL_TOKEN: 't' })).toHaveProperty('error');
  expect(boardConfig({ OPENCRAWL_API_URL: 'http://localhost:8092', OPENCRAWL_TOKEN: 't' })).toEqual({ api: 'http://localhost:8092', token: 't' });
  expect(boardConfig({ OPENCRAWL_API_URL: 'http://127.0.0.1:8092', OPENCRAWL_TOKEN: 't' })).toEqual({ api: 'http://127.0.0.1:8092', token: 't' });
});

test('one read-only board_search call for the newest posts in the window', async () => {
  const server = fakeServer(() => json(toolResult({ total: 7, through: 9, messages: [post(9, 12, 'deploy', 'codex-deploy', 'rolled back')], next: null })));
  const { board, warning } = await readBoard({ config, since: NOW - 3_600_000, fetch: server.fetch });
  expect(warning).toBeUndefined();
  expect(board).toEqual({ server: 'board.example', since: NOW - 3_600_000, total: 7, posts: [{ id: 9, at: NOW - 720_000, name: 'codex-deploy', topic: 'deploy', text: 'rolled back' }] });

  expect(server.calls).toHaveLength(1);
  const { url, init } = server.calls[0];
  expect(url).toBe('https://board.example/mcp');
  expect(init.method).toBe('POST');
  expect(init.redirect).toBe('error');
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token');
  const body = JSON.parse(String(init.body));
  expect(body.method).toBe('tools/call');
  // board_search only: never register, inbox or sync, which would move a delivery cursor or show brb as an agent.
  expect(body.params).toEqual({ name: 'board_search', arguments: { query: '', sort: 'newest', since: new Date(NOW - 3_600_000).toISOString(), limit: 5, facets: [] } });
});

test('reads a reply sent as an event stream', async () => {
  const stream = `event: message\ndata: ${JSON.stringify(toolResult({ total: 1, messages: [post(1, 5, 't', 'n', 'hi')] }))}\n\n`;
  const server = fakeServer(() => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  const { board } = await readBoard({ config, since: 0, fetch: server.fetch });
  expect(board?.posts.map((p) => p.text)).toEqual(['hi']);
});

test('anything that goes wrong is one warning, never a throw', async () => {
  const cases: [string, Fetch][] = [
    ['turned down OPENCRAWL_TOKEN (HTTP 401)', async () => new Response('', { status: 401 })],
    ['answered HTTP 503', async () => new Response('', { status: 503 })],
    ['Board scope required', async () => json(toolResult('Board scope required', true))],
    ["couldn't read board.example (connect ECONNREFUSED)", async () => { throw new Error('connect ECONNREFUSED'); }],
    ["couldn't read board.example (no answer in time)", async () => { throw new DOMException('timed out', 'TimeoutError'); }],
    ["couldn't read board.example", async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })],
    ["couldn't read board.example (ECONNREFUSED)", async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) }); }],
  ];
  for (const [expected, fetch] of cases) {
    const result = await readBoard({ config, since: 0, fetch });
    expect(result.board).toBeUndefined();
    expect(result.warning).toContain(expected);
  }
});

test('a section of posts under the sessions, cleaned like session text', () => {
  const c = scenarioCatchUp();
  c.board = { server: 'board.example', since: NOW - 3_600_000, total: 3, posts: [
    { id: 3, at: NOW - 12 * 60_000, name: 'codex-deploy', topic: 'deploy', text: 'rolled back api\n\x1b[31mto 0.4.9' },
    { id: 2, at: NOW - 31 * 60_000, name: '', topic: 'checkout', text: 'rounding now per item' },
  ] };
  const out = renderTerminal(c, { color: false, columns: 100, all: false });
  expect(out).toContain(' BOARD · board.example\n');
  expect(out).toContain('# deploy             codex-deploy · 12 min ago\n');
  expect(out).toContain('rolled back api to 0.4.9\n');
  expect(out).toContain('# checkout           someone · 31 min ago\n');
  expect(out).toContain('+1 more on the board\n');
  expect(out).not.toContain('\x1b');
  // Before the footer, so the next steps stay last.
  expect(out.indexOf(' BOARD')).toBeLessThan(out.indexOf('→ answer Claude'));
});

test('no section when nothing was posted', () => {
  const c = scenarioCatchUp();
  c.board = { server: 'board.example', since: 0, total: 0, posts: [] };
  expect(renderTerminal(c, { color: false, columns: 100, all: false })).not.toContain('BOARD');
});

describe('through the CLI', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brb-board-')));
  let world: { home: string; repo: string };
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
  const env = () => ({ HOME: world.home, OPENCRAWL_API_URL: 'https://board.example', OPENCRAWL_TOKEN: 'secret-token' });
  const brb = (argv: string[], fetch: Fetch) => run({ argv, env: env(), cwd: world.repo, now: NOW, isTTY: false, fetch });

  test('the screen and --json show the posts; the window is the same as the sessions', async () => {
    const server = fakeServer(() => json(toolResult({ total: 1, messages: [post(4, 3, 'deploy', 'codex-deploy', 'rolled back')] })));
    const screen = await brb([], server.fetch);
    expect(screen.stdout).toContain('# deploy             codex-deploy · 3 min ago');
    const c = JSON.parse((await brb(['--json'], server.fetch)).stdout);
    expect(c.board.posts).toEqual([{ id: 4, at: NOW - 180_000, name: 'codex-deploy', topic: 'deploy', text: 'rolled back' }]);
    // Since you last typed a prompt here, like the session rows.
    expect(c.board.since).toBe(NOW - c.awayMs);
    await brb(['--since', '2h'], server.fetch);
    expect(JSON.parse(String(server.calls.at(-1)!.init.body)).params.arguments.since).toBe(new Date(NOW - 2 * 3_600_000).toISOString());
  });

  test('--brief, --count and picking a row never call the board', async () => {
    const server = fakeServer(() => json(toolResult({ total: 0, messages: [] })));
    await brb(['--brief'], server.fetch);
    await brb(['--count'], server.fetch);
    await brb(['1'], server.fetch);
    expect(server.calls).toHaveLength(0);
  });

  test('a board that is down is a warning under an otherwise normal screen', async () => {
    const { stdout, exitCode } = await brb([], async () => { throw new Error('connect ECONNREFUSED'); });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('fix checkout rounding');
    expect(stdout).toContain(" ! OpenCrawl board: couldn't read board.example (connect ECONNREFUSED)");
  });
});
