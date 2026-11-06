# Reddit drafts

Link in both: https://github.com/JohnCarl-30/brb. Attach `docs/demo.gif`. Check each subreddit's self-promotion rules before posting.

## r/ClaudeAI (leads with the plugin and /recap)

Title:

```
I made a plugin that tells Claude, and you, what your other sessions did while you were away
```

Body:

```
Claude Code's /recap knows one Claude session. I usually have several going in different worktrees, plus Codex and Gemini CLI, so I wrote brb. It reads the history files those tools already write and prints one screen: what is waiting on you, what finished, what stopped on an error, and what you edited yourself. Every session is numbered, so typing a number drops you straight back into it, in the right folder.

The plugin adds three things:

- A SessionStart hook that briefs each new Claude session on the other sessions in the same project, so it knows about parallel work and doesn't overwrite your edits. It prints at most 10 lines, and nothing when there is nothing to say.
- A Notification hook that marks a session blocked on a permission prompt as waiting on you.
- /brb, which prints the catch-up inside Claude Code.

Install: /plugin marketplace add JohnCarl-30/brb, then /plugin install brb@brb. It needs Node 20 or newer.

It reads local files only and makes no network calls of its own. No API key. Without the plugin, npx @john_carl/brb works from any terminal.

https://github.com/JohnCarl-30/brb
```

## r/ChatGPTCoding (leads with cross-tool)

Title:

```
One screen for what Claude Code, Codex and Gemini CLI did while you were away
```

Body:

```
If you run more than one AI coding tool, coming back to your desk means opening each one to find out what happened. brb reads the local session history of Claude Code, Codex CLI and Gemini CLI and prints a single catch-up: what is waiting on you, what finished, what stopped on an error, and what you changed yourself. Type a session's number and brb resumes it with the right CLI in the right folder: claude --resume, codex resume or gemini --resume.

npx @john_carl/brb. No install, no API key, no config.

It reads local files only and makes no network calls of its own. If you have an AI CLI installed it can ask that tool for a one-line summary of its own sessions, and a session's text never goes to a different tool. --no-ai turns that off.

Codex and Gemini are detected for questions they asked. Claude Code also gets plans and permission prompts, with the plugin. To brief a Codex or Gemini agent, add "Run `npx @john_carl/brb --brief` before starting a task" to AGENTS.md or GEMINI.md. Cursor support is planned for v1.1.

https://github.com/JohnCarl-30/brb
```
