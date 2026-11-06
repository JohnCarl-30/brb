# brb

Step away from your AI coding sessions. When you're back, `brb` shows you everything that moved in one screen.

![brb demo](docs/demo.gif)

## Run it

```
npx brb
```

No install, no API key, no config.

## What you see

- **Waiting on you.** A session stopped on a question, a plan to approve or a permission prompt. brb shows what it asked.
- **Finished.** A session that did its work, with the last thing it said.
- **Stopped.** A session that hit an error, was interrupted, or whose last test or build failed. brb shows the error.
- **Your own edits.** Uncommitted changes that no AI session made, plus any TODO you added.
- **The way back in.** Each item ends with the exact command to jump back in, such as `claude --resume <id>` or `codex resume <id>`.

Sessions in the project you are standing in come first. Other projects follow, one line each.

## Why not just `/recap`?

Claude Code's `/recap` knows one Claude session. `brb` knows all of them, plus Codex, Gemini and your own edits.

## Supported tools

| Tool | Reads | Detects "waiting on you" |
|---|---|---|
| Claude Code | `~/.claude/projects` | Questions, plans and permission prompts (permission prompts need the plugin) |
| Codex CLI | `~/.codex/sessions` | Questions |
| Gemini CLI | `~/.gemini/tmp` | Questions |
| Cursor | Coming in v1.1 | |

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

## Other agents

Codex and Gemini CLI users can give their agent the same briefing. Add a line like this to `AGENTS.md` or `GEMINI.md`:

```
Run `npx brb --brief` before starting a task.
```

`--brief` prints a few plain-text lines about the other sessions in the project, and nothing when there is nothing to report. `--json` prints the whole catch-up for scripts.

## Privacy

brb reads local files only and makes no network calls of its own. No API key. If you have an AI CLI installed, brb can ask it for one-line summaries, and a session's text only ever goes back to the AI tool it came from. Turn this off with `--no-ai` or `BRB_NO_AI=1`.

## Options

```
brb: catch up on every AI coding session when you're back

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
```

## How it works

- brb reads the history files your tools already write, and only files changed in the last 7 days. It never writes to them. Its own files live under `~/.brb`, and summary prompts under your temp folder.
- It decides a session's status from its last turn. It never guesses "waiting": when the signs are unclear the session is idle.
- It groups sessions by git project, so a worktree counts with its main repo.
- "Away" runs from your last message to an AI session in the project. On a first run it looks back 8 hours. `--since` overrides both.
- Your own edits are the uncommitted files that no session's file-edit tool calls account for.

Limits: files Codex changes through shell commands, rather than its patch tool, can't be told apart from your own edits, so they may show up in the You row.

## License

MIT
