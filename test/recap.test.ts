import { expect, test } from 'vitest';
import type { Row } from '../src/catchup';
import { findImages, lastMessages, parseRecap, recapInput, renderRecapHtml } from '../src/recap';
import type { Session } from '../src/types';

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
