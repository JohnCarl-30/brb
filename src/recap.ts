import { parseJsonLines } from './adapters/files';
import { TOOL_NAME, type Row } from './catchup';
import { LABEL } from './render';
import { commandText, oneLine } from './text';
import { formatAge } from './time';
import type { Session } from './types';

export interface Image { mediaType: string; data: string }
export interface Recap { done: string[]; fixed: string[] }

// Only raster types a browser shows as a picture: an SVG can carry script and links.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URL = /^data:(image\/[a-z]+);base64,(.+)$/s;
const MAX_INPUT = 24_000;
const MAX_ITEMS = 6;

export const RECAP_PROMPT = [
  'Below is an AI coding session: what the developer asked, what the agent said, the commands it ran and the files it edited.',
  'List what the session built and what it fixed, for its developer. Use only what the text shows; never guess.',
  `Reply with up to ${MAX_ITEMS} lines "DONE: <what was built>" and up to ${MAX_ITEMS} lines "FIXED: <what was fixed>", each under 15 words, and nothing else.`,
  '',
  '',
].join('\n');

// The one image an object describes, in any of the three tools' shapes: Claude's base64 source block, Codex's
// input_image data URL, Gemini's inline data part.
function imageOf(o: Record<string, any>): Image | null {
  if (o.type === 'image' && o.source?.type === 'base64') return { mediaType: o.source.media_type, data: o.source.data };
  if (o.type === 'input_image' && typeof o.image_url === 'string') {
    const m = DATA_URL.exec(o.image_url);
    return m ? { mediaType: m[1], data: m[2] } : null;
  }
  if (typeof o.inlineData === 'object' && o.inlineData !== null) return { mediaType: o.inlineData.mimeType, data: o.inlineData.data };
  return null;
}

// Every image in a session file's text, in file order, each once (Codex records a pasted image more than once).
export function findImages(text: string): Image[] {
  let roots: unknown[] = parseJsonLines(text.split('\n'));
  if (roots.length === 0) {
    try {
      roots = [JSON.parse(text)]; // a Gemini chat is one pretty-printed document
    } catch {
      return [];
    }
  }
  const found: Image[] = [];
  const seen = new Set<string>();
  // Depth-first with an explicit stack, in document order, so a deeply nested file can't overflow the call stack.
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null) continue;
    const image = Array.isArray(value) ? null : imageOf(value);
    if (image) {
      const ok = typeof image.data === 'string' && IMAGE_TYPES.has(image.mediaType) && BASE64.test(image.data);
      if (ok && !seen.has(image.data)) {
        seen.add(image.data);
        found.push(image);
      }
      continue;
    }
    stack.push(...Object.values(value).reverse());
  }
  return found;
}

// The session as plain lines for the AI, keeping the end when it is too long: what it did last matters most.
export function recapInput(s: Session, max = MAX_INPUT): string {
  const lines = s.events.flatMap((e) => {
    if (e.kind === 'user') return [`User: ${e.text}`];
    if (e.kind === 'agent') return [`Agent: ${e.text}`];
    if (e.kind === 'command') return [`$ ${e.command}${e.ok ? '' : ' (failed)'}`];
    if (e.kind === 'edit') return [`Edited: ${e.files.join(', ')}`];
    return [];
  });
  return lines.join('\n').slice(-max);
}

// The DONE and FIXED lines of a reply, wherever they sit among other text. Null when it has none.
export function parseRecap(reply: string): Recap | null {
  const recap: Recap = { done: [], fixed: [] };
  for (const line of reply.split('\n')) {
    const m = /^\s*[-*]?\s*(DONE|FIXED):\s*(.+)$/i.exec(line);
    if (!m) continue;
    const list = m[1].toUpperCase() === 'DONE' ? recap.done : recap.fixed;
    const item = oneLine(m[2], 200);
    if (item !== '' && list.length < MAX_ITEMS) list.push(item);
  }
  return recap.done.length + recap.fixed.length === 0 ? null : recap;
}

// What the page shows in place of Done and Fixed when there is no AI recap.
export function lastMessages(s: Session, n = MAX_ITEMS): string[] {
  return s.events
    .flatMap((e) => (e.kind === 'user' ? [`You: ${e.text}`] : e.kind === 'agent' ? [`${TOOL_NAME[s.tool]}: ${e.text}`] : []))
    .slice(-n)
    .map((m) => oneLine(m, 500));
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const list = (heading: string, items: string[]): string =>
  items.length === 0 ? '' : `<section><h2>${heading}</h2><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`;

// No script, and the CSP lets nothing load but the page's own data: images, so session text can't act or call out.
const STYLE = `
:root { color-scheme: light dark; --dim: #6b7280; --line: #d1d5db; }
@media (prefers-color-scheme: dark) { :root { --dim: #9ca3af; --line: #374151; } }
body { font: 16px/1.5 system-ui, sans-serif; margin: 0; }
main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
.meta { color: var(--dim); margin: 0; }
h1 { font-size: 26px; margin: 4px 0 24px; overflow-wrap: anywhere; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 28px 0 8px; }
ul { margin: 0; padding-left: 20px; } li { margin: 4px 0; overflow-wrap: anywhere; }
img { display: block; max-width: 100%; border: 1px solid var(--line); border-radius: 6px; margin: 0 0 16px; }
pre { padding: 12px; border: 1px solid var(--line); border-radius: 6px; overflow-x: auto; }
`;

export function renderRecapHtml(r: Row, now: number, body: { recap: Recap | null; messages: string[]; images: Image[]; hiddenImages: number }): string {
  const status = LABEL[r.status](formatAge(now - r.at));
  const sections = body.recap
    ? list('Done', body.recap.done) + list('Fixed', body.recap.fixed)
    : list('Last messages', body.messages);
  const hidden = body.hiddenImages > 0 ? `<p class="meta">${body.hiddenImages} more screenshots not shown</p>` : '';
  const shots = body.images.length + body.hiddenImages === 0 ? '' : `<section><h2>Screenshots</h2>${
    body.images.map((i) => `<img src="data:${i.mediaType};base64,${i.data}" alt="">`).join('')}${hidden}</section>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)} · brb recap</title><style>${STYLE}</style></head>
<body><main>
<p class="meta">${esc(r.project.name)} · ${TOOL_NAME[r.tool]} · ${esc(status)}</p>
<h1>${esc(r.title)}</h1>
${sections}${shots}
<section><h2>Pick it back up</h2><pre><code>${esc(commandText(r.resume))}</code></pre></section>
</main></body></html>
`;
}
