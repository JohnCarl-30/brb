import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pc from 'picocolors';
import { version } from '../package.json';
import { resolveRoots } from './adapters';
import { computeCatchUp } from './compute';
import { runHook } from './hooks';
import { realpath } from './projects';
import { renderBrief, renderJson, renderTerminal } from './render';
import { defaultRunner, onPath, summarizeRows, summaryKey, type Runner } from './summarize';
import { parseSince } from './time';

export const HELP = `brb: catch up on every AI coding session when you're back

Usage: brb [options]

  --all            show every detail and resume command
  --since <time>   look back this far, e.g. 30m, 2h, 1d
  --json           print the catch-up as JSON
  --brief          short plain-text catch-up for AI agents
  --no-ai          skip AI one-line summaries
  --no-color       plain output
  --exclude <id>   leave out one session
  -v, --version    print the version
  -h, --help       show this help

brb reads your local Claude Code, Codex and Gemini CLI history. No API key.
`;

// `runner`, `which` and `tmpDir` let tests stand in for the AI tools and keep off the real tmp folder; `stdin` is for `brb hook`.
export interface RunOptions { argv: string[]; env: NodeJS.ProcessEnv; cwd: string; now: number; isTTY: boolean; columns?: number; stdin?: string; runner?: Runner; which?: (bin: string) => boolean; tmpDir?: string }
// `pending` is the one line to show while `rerender` works; it is only there when `rerender` is.
export interface RunResult { stdout: string; exitCode: number; rerender?: () => Promise<string | null>; pending?: string }

const fail = (message: string): RunResult => ({ stdout: `brb: ${message}\nRun brb --help for usage.\n`, exitCode: 1 });

export async function run(o: RunOptions): Promise<RunResult> {
  // Before the args are parsed, so a hook can't end in a usage error: it must exit 0.
  if (o.argv[0] === 'hook') return runHook(o.argv[1] ?? '', o.stdin ?? '', o);
  let values;
  try {
    ({ values } = parseArgs({
      args: o.argv,
      allowPositionals: true,
      options: {
        all: { type: 'boolean' }, since: { type: 'string' }, json: { type: 'boolean' }, brief: { type: 'boolean' },
        'no-ai': { type: 'boolean' }, 'no-color': { type: 'boolean' }, exclude: { type: 'string' },
        help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (values.help) return { stdout: HELP, exitCode: 0 };
  if (values.version) return { stdout: `${version}\n`, exitCode: 0 };

  const sinceMs = values.since === undefined ? undefined : parseSince(values.since);
  if (sinceMs === null) return fail('--since takes a time like 30m, 2h or 1d');

  const c = await computeCatchUp({ env: o.env, cwd: o.cwd, now: o.now, excludeSessionId: values.exclude, sinceMs });
  if (values.json) return { stdout: renderJson(c) + '\n', exitCode: 0 };
  if (values.brief) {
    const brief = renderBrief(c);
    return { stdout: brief === '' ? '' : brief + '\n', exitCode: 0 };
  }
  const color = !values['no-color'] && o.isTTY && !('NO_COLOR' in o.env);
  const view = { color, columns: o.columns ?? 100, all: values.all ?? false };
  const stdout = renderTerminal(c, view);
  if (!o.isTTY || values['no-ai'] || o.env.BRB_NO_AI === '1') return { stdout, exitCode: 0 };

  // The facts above print first; the caller asks for this afterwards, so AI never delays them.
  const rerender = async (): Promise<string | null> => {
    // Only rows whose detail line is on screen: HERE always, ELSEWHERE with --all.
    const rows = [...(c.here?.rows ?? []), ...(view.all ? c.elsewhere : [])];
    const summaries = await summarizeRows(rows, {
      brbHome: resolveRoots(o.env).brb, env: o.env, runner: o.runner ?? defaultRunner, which: o.which ?? ((bin) => onPath(bin, o.env)),
      tmpDir: o.tmpDir,
    });
    if (summaries.size === 0) return null;
    for (const r of rows) r.summary = summaries.get(summaryKey(r));
    return renderTerminal(c, view);
  };
  return { stdout, exitCode: 0, rerender, pending: pc.createColors(color).dim('summarizing… (Ctrl-C to skip)') };
}

// Escape string that follows the first screen and its "pending" line: it wipes them and prints the new screen in their place.
// The new screen is only drawn if the old one never scrolled, else only the pending line goes (it is always the line just above the cursor).
export function redraw(shown: string, next: string | null, rows: number): string {
  const lines = shown.split('\n').length; // the screen's lines (it ends in a newline), plus the pending line
  return next !== null && lines < rows ? `\x1b[${lines}F\x1b[0J${next}` : '\x1b[1F\x1b[0J';
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''; // typed by hand, so nothing is coming
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  try {
    const result = await run({
      argv, env: process.env, cwd: process.cwd(), now: Date.now(), isTTY: Boolean(process.stdout.isTTY),
      columns: process.stdout.columns, stdin: argv[0] === 'hook' ? await readStdin() : undefined,
    });
    process.stdout.write(result.stdout);
    process.exitCode = result.exitCode;
    if (result.rerender) { // only given for an interactive terminal
      process.stdout.write(`${result.pending}\n`);
      process.once('SIGINT', () => { process.stdout.write(redraw(result.stdout, null, 0)); process.exit(); });
      const next = await result.rerender().catch(() => null); // the facts are already on screen
      process.stdout.write(redraw(result.stdout, next, process.stdout.rows ?? 0));
    }
  } catch (err) {
    if (argv[0] !== 'hook') throw err; // a hook that fails is shown to the user, so it exits 0 whatever goes wrong (even process.cwd() or reading stdin)
  }
}

// Only when this file is the entry point. An npm bin link is a symlink to it, so compare real paths; tests import this file.
if (process.argv[1] && realpath(process.argv[1]) === realpath(fileURLToPath(import.meta.url))) await main();
