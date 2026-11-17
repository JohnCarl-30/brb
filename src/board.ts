// Optional: the newest posts on an OpenCrawl agent board since you were away (github.com/getopencrawl/opencrawl-core).
// Off unless OPENCRAWL_API_URL and OPENCRAWL_TOKEN are both set, so brb stays local with no config.
// One read-only MCP `board_search` call: no registration, no presence, and no delivery cursor, so it never takes
// messages from an agent's own board listener.

export interface BoardPost { id: number; at: number; name: string; topic: string; text: string }
export interface Board { server: string; since: number; posts: BoardPost[]; total: number }
export interface BoardConfig { api: string; token: string }
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const LIMIT = 5;
const TIMEOUT_MS = 3000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// The same variables the opencrawl CLI reads. Plain http only to this machine, so the token never crosses a network in the clear.
export function boardConfig(env: NodeJS.ProcessEnv): BoardConfig | { error: string } | null {
  const api = env.OPENCRAWL_API_URL?.trim();
  const token = env.OPENCRAWL_TOKEN?.trim();
  if (!api || !token) return null;
  let url: URL;
  try {
    url = new URL(api);
  } catch {
    return { error: 'OPENCRAWL_API_URL is not a URL' };
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    return { error: 'OPENCRAWL_API_URL must use https (plain http only for localhost)' };
  }
  return { api: url.origin, token };
}

// A Streamable HTTP server may answer with one JSON body or an event stream of them; take the response to our request.
function rpcResult(contentType: string, body: string): unknown {
  const messages = contentType.includes('text/event-stream')
    ? body.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)))
    : [JSON.parse(body)];
  const reply = messages.find((m) => m && m.id === 1);
  if (!reply) throw new Error('no reply from the board');
  if (reply.error) throw new Error(String(reply.error.message ?? 'board error'));
  return reply.result;
}

function toPost(m: unknown): BoardPost | null {
  if (!m || typeof m !== 'object') return null;
  const { id, timestamp, name, topic, text } = m as Record<string, unknown>;
  if (typeof id !== 'number' || typeof timestamp !== 'number' || typeof topic !== 'string' || typeof text !== 'string') return null;
  return { id, at: timestamp, name: typeof name === 'string' ? name : '', topic, text };
}

// Never throws: anything that goes wrong is one warning line under the catch-up, which still prints.
export async function readBoard(o: { config: BoardConfig; since: number; fetch?: Fetch; timeoutMs?: number }): Promise<{ board?: Board; warning?: string }> {
  const server = new URL(o.config.api).host;
  const request = {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'board_search', arguments: { query: '', sort: 'newest', since: new Date(o.since).toISOString(), limit: LIMIT, facets: [] } },
  };
  try {
    const response = await (o.fetch ?? fetch)(`${o.config.api}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${o.config.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(request),
      redirect: 'error', // a redirect would carry the token somewhere else
      signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) return { warning: `OpenCrawl board: ${server} turned down OPENCRAWL_TOKEN (HTTP ${response.status})` };
    if (!response.ok) return { warning: `OpenCrawl board: ${server} answered HTTP ${response.status}` };
    const result = rpcResult(response.headers.get('content-type') ?? '', await response.text()) as { isError?: boolean; content?: { type: string; text: string }[] };
    const text = result?.content?.find((c) => c.type === 'text')?.text ?? '';
    if (result?.isError) return { warning: `OpenCrawl board: ${text || 'search failed'}` };
    const data = JSON.parse(text) as { total?: unknown; messages?: unknown[] };
    const posts = (data.messages ?? []).map(toPost).filter((p): p is BoardPost => p !== null);
    return { board: { server, since: o.since, posts, total: typeof data.total === 'number' ? data.total : posts.length } };
  } catch (err) {
    // Node's fetch says only "fetch failed"; the reason (ECONNREFUSED, ENOTFOUND, a bad certificate) is in its cause.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : undefined;
    const reason = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'no answer in time'
      : cause ? String((cause as NodeJS.ErrnoException).code ?? cause.message) : err instanceof Error ? err.message : String(err);
    return { warning: `OpenCrawl board: couldn't read ${server} (${reason})` };
  }
}
