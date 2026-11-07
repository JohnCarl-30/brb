import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { Row } from '../src/catchup';
import { findImages, lastMessages, parseRecap, recapInput, renderRecapHtml, writeRecap } from '../src/recap';
import type { Runner } from '../src/summarize';
import type { Session } from '../src/types';
import { cl, makeFakeHome, writeClaudeSession, type FakeHome } from './support/fake-home';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
const JPG = '/9j/4AAQSkZJRgABAQ==';
const WEBP = 'UklGRhIAAABXRUJQ';

const session = (events: Session['events']): Session => ({ tool: 'claude', id: 's1', cwd: '/w/app', title: 'fix login', events, lastActivityAt: NOW });
const row = (o: Partial<Row> = {}): Row => ({
  tool: 'claude', sessionId: 's1', title: 'fix login', status: 'finished', detail: 'Done.', at: NOW - 3_600_000,
  project: { key: '/w/app', name: 'app' }, cwd: '/w/app', files: [], resume: 'claude --resume s1', longText: '', ...o,
});

test('findImages takes each tool\'s image shape, in file order, once each, and skips unsafe ones', () => {
  const lines = [
    { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] }] } },
    { type: 'response_item', payload: { content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${JPG}` }] } },
    { type: 'event_msg', payload: { images: [`data:image/jpeg;base64,${JPG}`], content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${JPG}` }] } },
    { parts: [{ inlineData: { mimeType: 'image/webp', data: WEBP } }] },
    { type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: PNG } },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'not base64!' } },
  ];
  expect(findImages(lines.map((l) => JSON.stringify(l)).join('\n'))).toEqual([
    { mediaType: 'image/png', data: PNG },
    { mediaType: 'image/jpeg', data: JPG },
    { mediaType: 'image/webp', data: WEBP },
  ]);
});

test('findImages reads a Gemini chat, which is one JSON document', () => {
  const chat = { sessionId: 'g', messages: [{ type: 'user', content: [{ text: 'look' }, { inlineData: { mimeType: 'image/png', data: PNG } }] }] };
  expect(findImages(JSON.stringify(chat, null, 2))).toEqual([{ mediaType: 'image/png', data: PNG }]);
});

test('recapInput keeps the end of a long session', () => {
  const events: Session['events'] = Array.from({ length: 30 }, (_, i) => ({ kind: 'user' as const, at: i, text: `prompt ${i} ${'x'.repeat(1000)}` }));
  events.push({ kind: 'command', at: 31, command: 'npm test', ok: false, output: '' }, { kind: 'edit', at: 32, files: ['/w/app/a.ts'] });
  const text = recapInput(session(events));
  expect(text.length).toBeLessThanOrEqual(24_000);
  expect(text).toContain('$ npm test (failed)');
  expect(text.endsWith('Edited: /w/app/a.ts')).toBe(true);
  expect(text).not.toContain('prompt 0 ');
});

test('parseRecap reads DONE and FIXED lines among chatter, and gives null without any', () => {
  expect(parseRecap('Sure!\nDONE: added tracing\n- FIXED: crash on empty input\nthanks')).toEqual({ done: ['added tracing'], fixed: ['crash on empty input'] });
  expect(parseRecap('no idea')).toBeNull();
});

test('lastMessages gives the last few things said, by who said them', () => {
  const s = session([{ kind: 'user', at: 1, text: 'fix it' }, { kind: 'command', at: 2, command: 'ls', ok: true, output: '' }, { kind: 'agent', at: 3, text: 'Fixed.' }]);
  expect(lastMessages(s)).toEqual(['You: fix it', 'Claude: Fixed.']);
});

test('the recap page escapes session text and runs nothing', () => {
  const html = renderRecapHtml(row({ title: '<script>alert(1)</script>' }), NOW, { recap: { done: ['a</title>b'], fixed: [] }, messages: [], images: [], hiddenImages: 0 });
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('a&lt;/title&gt;b');
  expect(html).not.toContain('<script');
  expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`);
  expect(html).toContain('Done');
  expect(html).not.toContain('Fixed');
  expect(html).toContain('claude --resume s1');
});

test('without an AI recap the page shows the last messages, and it embeds the screenshots', () => {
  const html = renderRecapHtml(row(), NOW, {
    recap: null, messages: ['You: fix it'], images: [{ mediaType: 'image/png', data: PNG }, { mediaType: 'image/png', data: PNG }], hiddenImages: 3,
  });
  expect(html).toContain('Last messages');
  expect(html).toContain('You: fix it');
  expect(html.split('<img src="data:image/png;base64,').length - 1).toBe(2);
  expect(html).toContain('3 more screenshots not shown');
});

describe('writeRecap', () => {
  const homes: FakeHome[] = [];
  afterEach(() => { for (const h of homes.splice(0)) fs.rmSync(h.home, { recursive: true, force: true }); });

  // A Claude session with one pasted screenshot, and the row brb would list for it.
  function setup() {
    const h = makeFakeHome();
    homes.push(h);
    const shot = { type: 'user', timestamp: new Date(NOW - 120_000).toISOString(), message: { role: 'user', content: [
      { type: 'text', text: 'this button is broken' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
    ] } };
    const file = writeClaudeSession(h, { id: 's1', cwd: '/w/app', lines: [shot, cl.say('Fixed the button.', NOW - 60_000)] });
    return { h, r: row({ file }), tmpDir: path.join(h.home, 'tmp') };
  }
  const calls: { bin: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
  const runner = (stdout: string, code = 0): Runner => async (bin, args, o) => { calls.push({ bin, args, cwd: o.cwd, env: o.env }); return { code, stdout }; };
  afterEach(() => { calls.length = 0; });

  test('asks the session\'s own tool for Done and Fixed, embeds the screenshot, and caches the answer', async () => {
    const { h, r, tmpDir } = setup();
    const o = { brbHome: h.brb, now: NOW, env: {}, ai: true, runner: runner('DONE: wrote tests\nFIXED: the button'), which: () => true, tmpDir };
    const page = await writeRecap(r, o);
    expect(page).toBe(path.join(h.brb, 'recaps', 'claude-s1.html'));
    const html = fs.readFileSync(page, 'utf8');
    expect(html).toContain('wrote tests');
    expect(html).toContain(`data:image/png;base64,${PNG}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].bin).toBe('claude');
    expect(calls[0].env.BRB_INTERNAL).toBe('1');
    expect(calls[0].cwd.endsWith('brb-summaries')).toBe(true);
    expect(calls[0].args.at(-1)).toContain('User: this button is broken');
    if (process.platform !== 'win32') expect(fs.statSync(page).mode & 0o777).toBe(0o600);

    await writeRecap(r, o);
    expect(calls).toHaveLength(1); // the second time came from the cache
  });

  test('without AI, or when the AI fails, the page shows the last messages', async () => {
    const { h, r, tmpDir } = setup();
    const base = { brbHome: h.brb, now: NOW, env: {}, which: () => true, tmpDir };
    let html = fs.readFileSync(await writeRecap(r, { ...base, ai: false, runner: runner('DONE: x') }), 'utf8');
    expect(calls).toHaveLength(0);
    expect(html).toContain('Last messages');
    expect(html).toContain('Claude: Fixed the button.');
    html = fs.readFileSync(await writeRecap(r, { ...base, ai: true, runner: runner('DONE: x', 1) }), 'utf8');
    expect(html).toContain('Last messages');
  });

  test('deletes recap pages older than 7 days', async () => {
    const { h, r, tmpDir } = setup();
    const dir = path.join(h.brb, 'recaps');
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, 'old.html');
    const fresh = path.join(dir, 'fresh.html');
    fs.writeFileSync(old, '');
    fs.writeFileSync(fresh, '');
    fs.utimesSync(old, new Date(NOW - 8 * 86_400_000), new Date(NOW - 8 * 86_400_000));
    fs.utimesSync(fresh, new Date(NOW - 86_400_000), new Date(NOW - 86_400_000));
    await writeRecap(r, { brbHome: h.brb, now: NOW, env: {}, ai: false, runner: runner(''), which: () => true, tmpDir });
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
