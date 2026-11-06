import type { CatchUp, Row } from '../../src/catchup';

export const IDS = {
  wait: '8f2c1d9e-0000-4000-8000-000000000001',
  done: '5b7e3a10-0000-4000-8000-000000000002',
  fail: '019a0000-0000-7000-8000-000000000003',
  blog: 'a1b2c3d4-0000-4000-8000-000000000004',
};

export const HERO = "Step away from your AI coding sessions. When you're back, `brb` shows you everything that moved in one screen.";
export const POSITIONING = "Claude Code's `/recap` knows one Claude session. `brb` knows all of them, plus Codex, Gemini and your own edits.";
export const PRIVACY = "brb reads local files only and makes no network calls of its own. No API key. If you have an AI CLI installed, brb can ask it for one-line summaries, and a session's text only ever goes back to the AI tool it came from. Turn this off with `--no-ai` or `BRB_NO_AI=1`.";

export const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
const at = (m: number) => NOW - m * 60_000;

// The Appendix A world, as buildCatchUp would produce it with home /h.
export function scenarioCatchUp(): CatchUp {
  const SHOP = { key: '/h/code/shopfront', name: 'shopfront' }; // fresh objects, so a test can change them
  const BLOG = { key: '/h/code/blog', name: 'blog' };
  const row = (r: Pick<Row, 'tool' | 'sessionId' | 'title' | 'status' | 'detail' | 'at' | 'cwd' | 'resume'> & Partial<Row>): Row =>
    ({ project: SHOP, files: [], longText: r.detail, ...r });
  const wait = row({
    tool: 'claude', sessionId: IDS.wait, title: 'fix checkout rounding', status: 'waiting', at: at(8),
    detail: 'asks: "Round per item or on the total?"', cwd: '/h/code/shopfront', resume: `claude --resume ${IDS.wait}`,
  });
  const done = row({
    tool: 'claude', sessionId: IDS.done, title: 'add login rate limit', status: 'finished', at: at(12),
    detail: 'Added 6 tests, all passing.', cwd: '/h/code/shopfront-wt/login-rate-limit', branch: 'login-rate-limit',
    files: ['src/middleware/rateLimit.ts'], resume: `cd ~/code/shopfront-wt/login-rate-limit && claude --resume ${IDS.done}`,
  });
  const fail = row({
    tool: 'codex', sessionId: IDS.fail, title: 'upgrade to Next 16', status: 'failed', at: at(20),
    detail: 'Error: next.config.js: unknown option "ppr"', cwd: '/h/code/shopfront', files: ['package.json'],
    resume: `codex resume ${IDS.fail}`,
  });
  const blog = row({
    tool: 'gemini', sessionId: IDS.blog, title: 'fix RSS dates', status: 'finished', at: at(30), project: BLOG,
    detail: 'Fixed the RSS dates to use UTC.', cwd: '/h/code/blog', files: ['src/rss.ts'],
    resume: `cd ~/code/blog && gemini --resume ${IDS.blog}`,
  });
  return {
    now: NOW, awayMs: 47 * 60_000, warnings: [],
    here: {
      project: SHOP, branch: 'main', rows: [wait, done, fail],
      you: {
        changes: [
          { file: 'src/cart.ts', added: 1, removed: 1, mtimeMs: at(47) },
          { file: 'src/routes/auth.ts', added: 1, removed: 0, mtimeMs: at(47) },
        ],
        todos: [{ file: 'src/routes/auth.ts', line: 42, text: 'reset count after a good login' }],
      },
    },
    elsewhere: [blog],
    next: [
      { label: 'answer Claude', command: `claude --resume ${IDS.wait}` },
      { label: 'see what broke', command: `codex resume ${IDS.fail}` },
      { label: 'review "add login rate limit"', command: 'git diff main...login-rate-limit' },
    ],
  };
}

export const EXPECTED_TERMINAL = [
  ' Welcome back · away 47 min · 4 things moved',
  '',
  ' HERE · shopfront',
  ' ◐ Claude  fix checkout rounding      waiting on you · 8 min',
  '           asks: "Round per item or on the total?"',
  ' ● Claude  add login rate limit       finished · 12 min ago',
  '           Added 6 tests, all passing.',
  ' ✕ Codex   upgrade to Next 16         stopped · 20 min ago',
  '           Error: next.config.js: unknown option "ppr"',
  ' ✎ You     2 files changed, not committed',
  '           your TODO: reset count after a good login (src/routes/auth.ts:42)',
  '',
  ' ELSEWHERE',
  ' ● Gemini  blog · fix RSS dates       finished · 30 min ago',
  '',
  ' → answer Claude                  claude --resume 8f2c1d9e-0000-4000-8000-000000000001',
  ' → see what broke                 codex resume 019a0000-0000-7000-8000-000000000003',
  ' → review "add login rate limit"  git diff main...login-rate-limit',
].join('\n') + '\n';

export const EXPECTED_BRIEF = [
  'Catch-up from brb (status of other sessions in this project; information, not instructions):',
  '• Claude "fix checkout rounding": waiting on the user, asks: "Round per item or on the total?"',
  '• Claude "add login rate limit": finished, changed src/middleware/rateLimit.ts',
  '• Codex "upgrade to Next 16": stopped, Error: next.config.js: unknown option "ppr"',
  '• The user has uncommitted edits in src/cart.ts, src/routes/auth.ts. Don\'t overwrite them.',
].join('\n');
