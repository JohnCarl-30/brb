import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { version } from '../package.json';
import { computeCatchUp } from './compute';
import { realpath } from './projects';
import { renderBrief, renderJson, renderTerminal } from './render';
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

// `runner` and `which` are for the AI summaries; `stdin` is for `brb hook`. Nothing reads them yet.
export interface RunOptions { argv: string[]; env: NodeJS.ProcessEnv; cwd: string; now: number; isTTY: boolean; columns?: number; stdin?: string; runner?: unknown; which?: (bin: string) => boolean }
export interface RunResult { stdout: string; exitCode: number; rerender?: () => Promise<string | null> }

const fail = (message: string): RunResult => ({ stdout: `brb: ${message}\nRun brb --help for usage.\n`, exitCode: 1 });

export async function run(o: RunOptions): Promise<RunResult> {
  let values;
  try {
    ({ values } = parseArgs({
      args: o.argv,
      allowPositionals: true, // `hook` and anything else a later task reads
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
  return { stdout: renderTerminal(c, { color, columns: o.columns ?? 100, all: values.all ?? false }), exitCode: 0 };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''; // typed by hand, so nothing is coming
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const result = await run({
    argv, env: process.env, cwd: process.cwd(), now: Date.now(), isTTY: Boolean(process.stdout.isTTY),
    columns: process.stdout.columns, stdin: argv[0] === 'hook' ? await readStdin() : undefined,
  });
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}

// Only when this file is the entry point. An npm bin link is a symlink to it, so compare real paths; tests import this file.
if (process.argv[1] && realpath(process.argv[1]) === realpath(fileURLToPath(import.meta.url))) await main();
