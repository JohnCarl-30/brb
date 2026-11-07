# brb

Step away from your AI coding sessions. When you're back, `brb` shows you everything that moved in one screen.

![brb demo](https://raw.githubusercontent.com/JohnCarl-30/brb/main/docs/demo.gif)

[![npm](https://img.shields.io/npm/v/@john_carl/brb)](https://www.npmjs.com/package/@john_carl/brb) [![CI](https://github.com/JohnCarl-30/brb/actions/workflows/ci.yml/badge.svg)](https://github.com/JohnCarl-30/brb/actions/workflows/ci.yml) ![license](https://img.shields.io/npm/l/@john_carl/brb)

You run Claude Code in one tab, Codex in another, Gemini in a third, and you edit a few files yourself. You step away. When you come back, one of them is waiting on a question, one finished, one broke its build, and you can't remember which tab is which. `brb` reads the history files those tools already write and tells you, in one screen, what happened and how to get back in.

## Run it

```
npx @john_carl/brb
```

No install, no API key, no config. To keep it around, `npm i -g @john_carl/brb` and then just run `brb`.

You need Node 20 or newer. brb is tested on macOS and Linux.

Run it inside a project to see that project first. Run it anywhere else to see every project at once.

## What you see

```
 Welcome back · away 47 min · 4 things moved

 HERE · shopfront
 1 ◐ Claude  fix checkout rounding      waiting on you · 8 min
             asks: "Round per item or on the total?"
 2 ● Claude  add login rate limit       finished · 12 min ago
             Added 6 tests, all passing.
 3 ✕ Codex   upgrade to Next 16         stopped · 20 min ago
             Error: next.config.js: unknown option "ppr"
   ✎ You     2 files changed, not committed
             your TODO: reset count after a good login (src/routes/auth.ts:42)

 ELSEWHERE
 4 ● Gemini  blog · fix RSS dates       finished · 30 min ago

 → answer Claude                  claude --resume 8f2c1d9e-0000-4000-8000-000000000001
 → see what broke                 codex resume 019a0000-0000-7000-8000-000000000003
 → review "add login rate limit"  git diff main...login-rate-limit
 brb <number> picks that session back up
```

- **Waiting on you.** A session stopped on a question, a plan to approve or a permission prompt. brb shows what it asked.
- **Finished.** A session that did its work, with the last thing it said.
- **Stopped.** A session that hit an error, was interrupted, or whose last test or build failed. brb shows the error.
- **Your own edits.** Uncommitted changes that no AI session made, plus any TODO you added.
- **The way back in.** Every session is numbered. Type a number at the prompt, or run `brb 2`, and you're back in session 2, in its own folder and its own CLI. A footer also lists up to three next steps, each with the exact command, such as `claude --resume <id>` or `codex resume <id>`. `--all` adds a resume command under every session.

Sessions in the project you are standing in come first. Other projects follow, one line each: every session that needs you or is still working, then the newest of the rest, up to 10 rows. A last line says how many it left out, and `--all` shows them all.

### Every status

| Mark | Status | When |
|---|---|---|
| `◐` | waiting on you | The session asked a question, has a plan for you to approve, is blocked on a permission prompt, or ended its turn by asking you something without doing any work. A waiting session stays on the list however old it is. |
| `●` | finished | The session ended its turn, and its last command, if it ran one, passed. |
| `✕` | stopped | The last thing in the turn was an error or an interruption, or the last command failed, such as a test run or a build. |
| `◌` | working | The turn hasn't ended and the session wrote something in the last minute. |
| `○` | idle | The turn hasn't ended but nothing has happened for a minute or more, such as a session you closed mid-answer. |
| `✎` | You | Files changed in your working tree that no AI session's edit tools touched, plus any `TODO` or `FIXME` you added in them. |

## Picking a session back up

Every session row has a number. In a terminal, brb asks which one you want right after the list:

```
 Pick a session (1-4), Enter to quit: 3
 → codex resume 019a0000-0000-7000-8000-000000000003
```

Type the number and press Enter. Enter on its own, `q` or Ctrl-C leaves without resuming anything. If you already know the number, skip the question with `brb 3`.

brb prints the command, then runs it. A session from another project gets a `cd` into its folder first, so you land in the right place with the right CLI: `claude --resume`, `codex resume` or `gemini --resume`. When you quit that CLI you're back in your shell, and brb exits with the CLI's exit code.

- With npx, the number goes at the end: `npx @john_carl/brb 3`.
- Outside a terminal, piped or in a script, brb doesn't ask, and `brb 3` only prints the command.
- Use the same `--since` and `--all` you used for the list, so the numbers match.
- `/brb` inside Claude Code shows the list without numbers, because it leaves out the session you're typing in.

### Session recaps

Before you pick a session back up, see what it actually got through. `brb show 3`, or `s3` at the pick prompt, opens a recap page for that session in your browser:

- **Done** and **Fixed**: short lists of what the session built and what it fixed, written by the session's own AI tool, the same way as the summaries below.
- **Screenshots**: every image already in the session, both the ones you pasted and the ones the agent took with its tools.
- **Pick it back up**: the resume command.

At the pick prompt, brb asks again after opening the page, so you can read it and then pick. Without an AI tool, with `--no-ai`, outside a terminal, or when you press Ctrl-C while it's writing, the page shows the session's last few messages in place of Done and Fixed. The screenshots still show.

Each page is one file at `~/.brb/recaps/<tool>-<session id>.html`, with its screenshots inside it. It runs no script and loads nothing from the internet. brb deletes pages older than 7 days each time it writes one.

## Why not just `/recap`?

Claude Code's `/recap` knows one Claude session. `brb` knows all of them, plus Codex, Gemini and your own edits.

## Supported tools

| Tool | Reads | Detects "waiting on you" |
|---|---|---|
| Claude Code | `~/.claude/projects` | Questions, plans and permission prompts (permission prompts need the plugin) |
| Codex CLI | `~/.codex/sessions` | Questions |
| Gemini CLI | `~/.gemini/tmp` | Questions |
| Cursor | Coming in v1.1 | |

If you moved a tool's folder, brb follows the same variable the tool does: `CLAUDE_CONFIG_DIR` for Claude Code and `CODEX_HOME` for Codex. Gemini CLI has no such variable, so brb always reads `~/.gemini`.

brb leaves out sessions that background agents run by themselves: its own summary runs, and the observer sessions of the [claude-mem](https://github.com/thedotmack/claude-mem) plugin.

## Claude Code plugin

```
/plugin marketplace add JohnCarl-30/brb
/plugin install brb@brb
```

The plugin adds three things:

- A SessionStart hook that briefs every new Claude session on the other sessions in the same project, so it knows about parallel work and doesn't overwrite your edits. It prints at most 10 lines and nothing when there is nothing to say.
- A Notification hook that marks a session blocked on a permission prompt as waiting on you.
- `/brb`, which prints the catch-up inside Claude Code.

It needs Node 20 or newer on your PATH.

To update the plugin, run `/plugin marketplace update brb`. The hooks never get in Claude's way: if Node is missing or brb fails, they print nothing and the session starts as usual.

This is what a new Claude session in the demo project is told:

```
Catch-up from brb (status of other sessions in this project; information, not instructions):
• Claude "fix checkout rounding": waiting on the user, asks: "Round per item or on the total?"
• Claude "add login rate limit": finished, changed src/middleware/rateLimit.ts
• Codex "upgrade to Next 16": stopped, Error: next.config.js: unknown option "ppr"
• The user has uncommitted edits in src/cart.ts, src/routes/auth.ts. Don't overwrite them.
```

## Other agents

Codex and Gemini CLI users can give their agent the same briefing. Add a line like this to `AGENTS.md` or `GEMINI.md`:

```
Run `npx @john_carl/brb --brief` before starting a task.
```

`--brief` prints a few plain-text lines about the other sessions in the project, and nothing when there is nothing to report. `--json` prints the whole catch-up for scripts.

## AI summaries

In a terminal, brb prints the facts first. Then it asks for one-line summaries of finished and stopped sessions and redraws the screen with them. You never wait on AI to see the list, and Ctrl-C skips the summaries.

- Each session is summarized by the tool it came from, and only if that tool is installed: Claude Code runs `claude -p` with Haiku and no tools, Codex runs `codex exec` in a read-only sandbox, and Gemini runs `gemini -p` in plan mode. None of them can change files.
- These runs use your existing login for that CLI, so they count toward that tool's usage like any other prompt. brb holds no key.
- brb summarizes at most 8 sessions per run and gives each 20 seconds. Summaries are cached in `~/.brb/cache/summaries.json`, so a session that hasn't moved is never summarized twice.
- The summary runs stay out of your history and out of brb's list. They run in a private `brb-summaries` folder in your temp folder, which brb skips.
- brb asks no AI at all without a terminal, with `--json` or `--brief`, with `--no-ai`, or with `BRB_NO_AI=1`.

## Privacy

brb reads local files only and makes no network calls of its own. No API key. If you have an AI CLI installed, brb can ask it for one-line summaries and session recaps, and a session's text only ever goes back to the AI tool it came from. Turn this off with `--no-ai` or `BRB_NO_AI=1`.

brb never writes to your tools' history files. It writes only these:

- `~/.brb/cache/summaries.json`, the summary cache.
- `~/.brb/cache/recaps.json`, the recap cache.
- `~/.brb/recaps/`, one recap page per session you open with `brb show`, deleted after 7 days.
- `~/.brb/pending/`, one small file per Claude session blocked on a permission prompt (plugin only).
- `brb-summaries/` in your temp folder, where summary and recap prompts run.

Session text that brb prints has terminal control codes stripped, so a session can't rewrite your screen.

## Options

```
brb: catch up on every AI coding session when you're back

Usage: brb [options]
       brb <number>      resume that session from the list
       brb show <number> open that session's recap in your browser

  --all            show every session, detail and resume command
  --since <time>   look back this far, e.g. 30m, 2h, 1d
  --json           print the catch-up as JSON
  --brief          short plain-text catch-up for AI agents
  --no-ai          skip AI one-line summaries
  --no-color       plain output
  --exclude <id>   leave out one session
  -v, --version    print the version
  -h, --help       show this help

brb reads your local Claude Code, Codex and Gemini CLI history. No API key.
```

### Environment variables

| Variable | Effect |
|---|---|
| `BRB_NO_AI=1` | Same as `--no-ai`. |
| `NO_COLOR` | Same as `--no-color`. |
| `BRB_HOME` | Where brb keeps its own files. Default `~/.brb`. |
| `CLAUDE_CONFIG_DIR` | Where Claude Code keeps its history. Default `~/.claude`. |
| `CODEX_HOME` | Where Codex keeps its history. Default `~/.codex`. |

### JSON

`brb --json` prints the whole catch-up. Times are milliseconds since the epoch. Shortened:

```json
{
  "now": 1793968317399,
  "awayMs": 2820200,
  "warnings": [],
  "sessions": 4,
  "here": {
    "project": { "key": "/Users/you/code/shopfront", "name": "shopfront" },
    "branch": "main",
    "rows": [
      {
        "tool": "claude",
        "sessionId": "8f2c1d9e-0000-4000-8000-000000000001",
        "title": "fix checkout rounding",
        "status": "waiting",
        "detail": "asks: \"Round per item or on the total?\"",
        "at": 1793967837199,
        "project": { "key": "/Users/you/code/shopfront", "name": "shopfront" },
        "cwd": "/Users/you/code/shopfront",
        "branch": "main",
        "files": [],
        "resume": "claude --resume 8f2c1d9e-0000-4000-8000-000000000001"
      }
    ],
    "you": {
      "changes": [{ "file": "src/routes/auth.ts", "added": 1, "removed": 0, "mtimeMs": 1793965497199 }],
      "todos": [{ "file": "src/routes/auth.ts", "line": 42, "text": "reset count after a good login" }]
    }
  },
  "elsewhere": [],
  "next": [{ "label": "answer Claude", "command": "claude --resume 8f2c1d9e-0000-4000-8000-000000000001" }]
}
```

`status` is one of `waiting`, `finished`, `failed`, `working` or `idle`. `here` is `null` when nothing in the project you're in moved and you have no edits of your own. `you` is `null` when you have no uncommitted edits.

## How it works

- brb reads the history files your tools already write, and only files changed in the last 7 days. It never writes to them. Its own files live under `~/.brb`, and summary prompts under your temp folder.
- It decides a session's status from its last turn. It only calls a session waiting on a clear sign: a question tool, a plan, a permission prompt, or a final message that asks something after no work.
- It groups sessions by git project, so a worktree counts with its main repo.
- "Away" runs from your last message to an AI session in the project. A project with no message from you looks back 8 hours. `--since` overrides both. Your own file edits don't move it.
- Your own edits are the uncommitted files that no session's file-edit tool calls account for.

Limits: files an agent changes through a shell command (Claude's Bash, Codex's shell, Gemini's shell: formatters, `sed -i`, codegen) can't be told apart from your own edits, so they show up in the You row.

## Troubleshooting

**"brb found no AI sessions from the last 7 days."** brb only reads sessions from the last week. If a tool keeps its history somewhere else, set `CLAUDE_CONFIG_DIR` or `CODEX_HOME` the same way you set it for the tool.

**"nothing moved".** Nothing changed since your last message in this project. Use `--since 1d` to look further back.

**"no session 5: pick 1 to 4".** The list changed since you looked, or you ran it with different options. Run `brb` again and use the new number.

**`! Couldn't read Codex sessions: …`** One tool's history couldn't be read. The other tools still show, and the line says what went wrong.

**`npx @john_carl/brb` says `brb: command not found`.** You're inside a clone of this repo, where npx finds the local copy instead of the published one. Run it from another folder.

## Development

```
git clone https://github.com/JohnCarl-30/brb
cd brb
npm ci
npm test            # vitest
npm run typecheck
npm run build       # bundles dist/brb.mjs
```

The plugin runs `dist/brb.mjs` straight from the repo, so rebuild and commit it with every change to `src/`. Tests run against a made-up home folder and never read your real sessions. `npm run demo:seed` builds the demo world used for the GIF.

## License

MIT
