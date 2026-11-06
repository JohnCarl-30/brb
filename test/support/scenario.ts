// The Appendix A world on disk: a fake home with a git repo, a worktree and four agent sessions.
// Used by the end-to-end tests and the demo. Every session time is relative to `now`.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IDS } from './expected';
import { cl, cx, gm, writeClaudeSession, writeCodexSession, writeGeminiSession, type FakeHome } from './fake-home';

const MARKER = '.brb-demo';

// The owner's git config and hooks must not change this world, and the branch name must not depend on init.defaultBranch.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=brb', '-c', 'user.email=brb@example.com', ...args], { cwd, env: GIT_ENV, stdio: 'ignore' });

const write = (dir: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const lines = (n: number, what: string) => Array.from({ length: n }, (_, i) => `// ${what} ${i + 1}\n`).join('');

const PACKAGE = (next: string) => `{\n  "name": "shopfront",\n  "dependencies": { "next": "${next}" }\n}\n`;
const CART = (round: string) => `export const total = (items: number[]) => items.reduce((a, b) => a + b, 0);\nexport const round = (n: number) => ${round};\n`;

export function seedScenario(dir: string, now: number): { home: string; repo: string } {
  // Recreating `dir` deletes it, so only a folder an earlier seed made (it has the marker) may be recreated.
  if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, MARKER))) {
    throw new Error(`${dir} exists and has no ${MARKER} file, so seedScenario left it alone`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER), '');

  // realpath, because brb works with real paths and the tmp folder is a symlink on macOS (/tmp -> /private/tmp).
  const home = path.join(fs.realpathSync(dir), 'home');
  const repo = path.join(home, 'code', 'shopfront');
  const wt = path.join(home, 'code', 'shopfront-wt', 'login-rate-limit');
  const blog = path.join(home, 'code', 'blog');
  const min = (m: number) => now - m * 60_000;

  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, 'package.json', PACKAGE('15.0.0'));
  write(repo, 'src/cart.ts', CART('Math.round(n * 100) / 100'));
  write(repo, 'src/routes/auth.ts', lines(41, 'auth'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'initial');

  git(repo, 'worktree', 'add', '-q', wt, '-b', 'login-rate-limit');
  write(wt, 'src/middleware/rateLimit.ts', 'export const limit = 5;\n');
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 'add rate limit');

  // Your own work in the main checkout, not committed. package.json is the Codex session's, so brb leaves it out of "You".
  fs.appendFileSync(path.join(repo, 'src/routes/auth.ts'), '// TODO: reset count after a good login\n');
  write(repo, 'src/cart.ts', CART('Math.round((n + Number.EPSILON) * 100) / 100'));
  write(repo, 'package.json', PACKAGE('16.0.0'));
  for (const file of ['src/cart.ts', 'src/routes/auth.ts']) fs.utimesSync(path.join(repo, file), new Date(min(47)), new Date(min(47)));

  const h: FakeHome = { home, claude: path.join(home, '.claude'), codex: path.join(home, '.codex'), gemini: path.join(home, '.gemini'), brb: path.join(home, '.brb') };

  writeClaudeSession(h, {
    id: IDS.wait, cwd: repo, branch: 'main',
    lines: [
      cl.title('fix checkout rounding'),
      cl.user('fix the checkout rounding bug', min(47)),
      cl.tool('t1', 'Read', { file_path: path.join(repo, 'src/cart.ts') }, min(45)),
      cl.result('t1', '…', min(45)),
      cl.tool('t2', 'AskUserQuestion', { questions: [{ question: 'Round per item or on the total?' }] }, min(8)),
    ],
  });
  writeClaudeSession(h, {
    id: IDS.done, cwd: wt, branch: 'login-rate-limit',
    lines: [
      cl.title('add login rate limit'),
      cl.user('add rate limiting to login', min(60)),
      cl.tool('t1', 'Write', { file_path: path.join(wt, 'src/middleware/rateLimit.ts'), content: 'export const limit = 5;\n' }, min(40)),
      cl.result('t1', 'ok', min(40)),
      cl.tool('t2', 'Bash', { command: 'npm test' }, min(13)),
      cl.result('t2', 'Tests: 6 passed, 6 total', min(13)),
      cl.say('Added 6 tests, all passing. Want me to open a PR?', min(12)),
    ],
  });
  writeCodexSession(h, {
    id: IDS.fail, threadName: 'upgrade to Next 16',
    lines: [
      cx.meta(IDS.fail, repo, min(55)),
      cx.started(min(55)),
      cx.user('upgrade to Next 16', min(55)),
      cx.change([path.join(repo, 'package.json')], min(30)),
      cx.run('npm run build', 1, '> build\n> next build\n\nError: next.config.js: unknown option "ppr"\n', min(21)),
      cx.say('The build fails because next.config.js uses the removed ppr option.', min(20)),
      cx.done(min(20)),
    ],
  });
  writeGeminiSession(h, {
    id: IDS.blog, projectRoot: blog,
    messages: [
      gm.user('fix RSS dates', min(50)),
      gm.say('', min(35), [gm.call('replace', { file_path: path.join(blog, 'src/rss.ts') }, 'success', min(35))]),
      gm.say('Fixed the RSS dates to use UTC.', min(30)),
    ],
  });

  return { home, repo };
}
