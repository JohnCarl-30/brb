import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pc from 'picocolors';
import { version } from '../package.json';
import { resolveRoots } from './adapters';
import { computeCatchUp } from './compute';
import { runHook } from './hooks';
import { realpath } from './projects';
import { writeRecap } from './recap';
import { renderBrief, renderJson, renderTerminal, shownElsewhere } from './render';
import { defaultRunner, onPath, summarizeRows, summaryKey, type Runner } from './summarize';
import { commandText } from './text';
import { parseSince } from './time';

export const HELP = `brb: catch up on every AI coding session when you're back

Usage: brb [options]
       brb <number>      resume that session from the list
       brb show <number> open that session's recap in your browser

  --all            show every session, detail and resume command
  --since <time>   look back this far, e.g. 30m, 2h, 1d
  --json           print the catch-up as JSON
  --brief          short plain-text catch-up for AI agents
  --no-ai          skip AI summaries and recaps
  --no-color       plain output
  --exclude <id>   leave out one session
  -v, --version    print the version
  -h, --help       show this help

brb reads your local Claude Code, Codex and Gemini CLI history. No API key.
`;

// `runner`, `which` and `tmpDir` let tests stand in for the AI tools and keep off the real tmp folder; `stdin` is for `brb hook`.
export interface RunOptions { argv: string[]; env: NodeJS.ProcessEnv; cwd: string; now: number; isTTY: boolean; columns?: number; stdin?: string; runner?: Runner; which?: (bin: string) => boolean; tmpDir?: string }
// `pending` is the one line to show while `rerender` works; it is only there when `rerender` is. `exec` is a shell
// command to hand the terminal to once stdout is written. `choices` are the numbered rows' resume commands, in order,
// for the "pick a session" question asked at the end in a terminal. `recap` writes listed row n's recap page and gives its
// path; `show` is the row whose recap to open right away (brb show <n>).
export interface RunResult {
  stdout: string; exitCode: number; rerender?: () => Promise<string | null>; pending?: string; exec?: string; choices?: string[];
  recap?: (n: number, signal?: AbortSignal) => Promise<string>; show?: number;
}

const fail = (message: string): RunResult => ({ stdout: `brb: ${message}\nRun brb --help for usage.\n`, exitCode: 1 });

export async function run(o: RunOptions): Promise<RunResult> {
  // Before the args are parsed, so a hook can't end in a usage error: it must exit 0.
  if (o.argv[0] === 'hook') return runHook(o.argv[1] ?? '', o.stdin ?? '', o);
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
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
  const show = positionals[0] === 'show';
  const [pick, ...extra] = show ? positionals.slice(1) : positionals;
  const isNumber = pick !== undefined && /^[1-9]\d*$/.test(pick);
  if (show && (extra.length > 0 || !isNumber)) return fail('give one session number, e.g. brb show 2');
  if (show && (values.json || values.brief)) return fail('brb show makes a page, so it takes no --json or --brief');
  if (extra.length > 0 || (pick !== undefined && !isNumber)) return fail('give one session number, e.g. brb 2');

  const c = await computeCatchUp({ env: o.env, cwd: o.cwd, now: o.now, excludeSessionId: values.exclude, sinceMs });
  // Numbered in the order the screen shows them: HERE, then ELSEWHERE.
  const listed = [...(c.here?.rows ?? []), ...shownElsewhere(c, values.all ?? false)];
  const noAi = values['no-ai'] || o.env.BRB_NO_AI === '1';
  const recap = (n: number, signal?: AbortSignal): Promise<string> => writeRecap(listed[n - 1], {
    brbHome: resolveRoots(o.env).brb, now: o.now, env: o.env, ai: o.isTTY && !noAi, signal, tmpDir: o.tmpDir,
    runner: o.runner ?? defaultRunner, which: o.which ?? ((bin) => onPath(bin, o.env)),
  });
  if (pick !== undefined) {
    const row = listed[Number(pick) - 1];
    if (!row) return fail(listed.length === 0 ? 'no sessions to pick up' : `no session ${pick}: pick 1 to ${listed.length}`);
    if (show) return { stdout: '', exitCode: 0, recap, show: Number(pick) };
    // Without a terminal there is nothing to hand over, so only print the command.
    return { stdout: `→ ${commandText(row.resume)}\n`, exitCode: 0, exec: o.isTTY ? row.resume : undefined };
  }
  if (values.json) return { stdout: renderJson(c) + '\n', exitCode: 0 };
  if (values.brief) {
    const brief = renderBrief(c);
    return { stdout: brief === '' ? '' : brief + '\n', exitCode: 0 };
  }
  const color = !values['no-color'] && o.isTTY && !('NO_COLOR' in o.env);
  const view = { color, columns: o.columns ?? 100, all: values.all ?? false, numbered: values.exclude === undefined };
  const stdout = renderTerminal(c, view);
  const choices = o.isTTY && view.numbered && listed.length > 0 ? listed.map((r) => r.resume) : undefined;
  const picks = choices ? { choices, recap } : {};
  if (!o.isTTY || noAi) return { stdout, exitCode: 0, ...picks };

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
  return { stdout, exitCode: 0, rerender, ...picks, pending: pc.createColors(color).dim('summarizing… (Ctrl-C to skip)') };
}

// Escape string that follows the first screen and its "pending" line: it wipes them and prints the new screen in their place.
// The new screen is only drawn if the old one never scrolled, else only the pending line goes (it is always the line just above the cursor).
// A line wider than the terminal wraps onto more rows, and the cursor has to climb all of them.
// shortcut: counts characters, not display width, so wide (CJK, emoji) titles can undercount; use a width table if that shows up.
export function redraw(shown: string, next: string | null, rows: number, columns = Infinity): string {
  const width = (line: string): number => line.replace(/\x1b\[[0-9;]*m/g, '').length;
  // The screen's lines (it ends in a newline, so the last one is the pending line).
  const lines = shown.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(width(line) / columns)), 0);
  return next !== null && lines < rows ? `\x1b[${lines}F\x1b[0J${next}` : '\x1b[1F\x1b[0J';
}

// What an answer to "pick a session" means: a row number, s<number> for its recap, quit (nothing typed, or q), or
// anything else to ask again.
export function parsePick(answer: string, count: number): number | { show: number } | 'quit' | 'again' {
  const a = answer.trim().toLowerCase();
  if (a === '' || a === 'q') return 'quit';
  const m = /^(s\s*)?(\d+)$/.exec(a);
  const n = m ? Number(m[2]) : 0;
  if (n < 1 || n > count) return 'again';
  return m![1] ? { show: n } : n;
}

// Asks once. Ctrl-C and Ctrl-D quit.
async function askPick(count: number): Promise<ReturnType<typeof parsePick>> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Closing alone leaves a pending question unsettled, so cancel it too.
  const cancel = new AbortController();
  rl.on('SIGINT', () => rl.close());
  rl.on('close', () => cancel.abort());
  try {
    return parsePick(await rl.question(pc.dim(` Pick a session (1-${count}), s<n> for its recap, Enter to quit: `), { signal: cancel.signal }), count);
  } catch {
    return 'quit'; // the question was cut short by Ctrl-C or Ctrl-D
  } finally {
    rl.close();
  }
}

// The command that opens a file in the default browser. `start` takes its first quoted argument as a window title.
export function openCommand(platform: NodeJS.Platform): string[] {
  return platform === 'darwin' ? ['open'] : platform === 'win32' ? ['cmd', '/c', 'start', ''] : ['xdg-open'];
}

// Writes row n's recap (Ctrl-C skips the AI, not the page) and opens it in the browser, or just prints where it is.
// A recap that can't be written is one line of error, not a crash, so the pick prompt goes on. Gives whether it worked.
export async function showRecap(recap: (n: number, signal?: AbortSignal) => Promise<string>, n: number): Promise<boolean> {
  const tty = Boolean(process.stdout.isTTY);
  if (tty) process.stdout.write(`${pc.dim(' writing recap… (Ctrl-C to skip)')}\n`);
  const cancel = new AbortController();
  const skip = () => cancel.abort();
  process.on('SIGINT', skip);
  let page: string;
  try {
    page = await recap(n, cancel.signal);
  } catch (err) {
    if (tty) process.stdout.write(redraw('', null, 0)); // the "writing recap" line
    process.stdout.write(`brb: couldn't write that recap: ${err instanceof Error ? err.message : String(err)}\n`);
    return false;
  } finally {
    process.off('SIGINT', skip);
  }
  if (tty) process.stdout.write(redraw('', null, 0));
  process.stdout.write(`${tty ? ' ' : ''}→ recap: ${page}\n`);
  if (!tty) return true;
  // Detached, so a browser that xdg-open runs in the foreground doesn't hold the prompt; if it can't open, the path is above.
  const [bin, ...args] = openCommand(process.platform);
  spawn(bin, [...args, page], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  return true;
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
      const skip = () => { process.stdout.write(redraw(result.stdout, null, 0)); process.exit(); };
      process.once('SIGINT', skip);
      const next = await result.rerender().catch(() => null); // the facts are already on screen
      process.off('SIGINT', skip);
      process.stdout.write(redraw(result.stdout, next, process.stdout.rows ?? 0, process.stdout.columns));
    }
    if (result.show !== undefined && !(await showRecap(result.recap!, result.show))) process.exitCode = 1;
    let command = result.exec;
    while (result.choices && process.stdin.isTTY) {
      const pick = await askPick(result.choices.length);
      if (pick === 'quit') break;
      if (pick === 'again') continue;
      if (typeof pick === 'object') {
        await showRecap(result.recap!, pick.show);
        continue;
      }
      command = result.choices[pick - 1];
      process.stdout.write(` → ${commandText(command)}\n`);
      break;
    }
    if (command) process.exitCode = spawnSync('/bin/sh', ['-c', command], { stdio: 'inherit' }).status ?? 1;
  } catch (err) {
    if (argv[0] !== 'hook') throw err; // a hook that fails is shown to the user, so it exits 0 whatever goes wrong (even process.cwd() or reading stdin)
  }
}

// Only when this file is the entry point. An npm bin link is a symlink to it, so compare real paths; tests import this file.
if (process.argv[1] && realpath(process.argv[1]) === realpath(fileURLToPath(import.meta.url))) await main();
