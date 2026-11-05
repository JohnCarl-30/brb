# brb — design

- **Date:** 2026-11-05
- **Status:** approved by the owner on 2026-11-05
- **One line:** Step away from your AI coding sessions. When you're back, `brb` shows you everything that moved in one screen.

Items marked **(my call)** were decided by the designer, not the owner, and the owner can overturn them. Everything else was decided by the owner in conversation.

---

## 1. Intent and the why

### The moment it's for

A developer is mid-task with several AI coding sessions running: two Claude Code sessions in the same repo, a Codex task in another, maybe a Gemini CLI session. Something pulls them away: a message, a side bug, their phone while an agent works. When they come back they've lost the thread. Which session finished? Which one is sitting there waiting for an answer? What broke? What were *they* in the middle of?

Today they rebuild the picture by reading through their changes and the code until it clicks. `brb` does that reading for them and hands the thread back in seconds.

### What the owner wants out of it

An open-source repo that reaches **500+ GitHub stars**. So the tool has to be genuinely useful, and the README, demo and launch are part of the project, not an afterthought.

### Why this angle (research done 2026-11-05)

- **Claude Code already has a single-session recap.** Its built-in recap (automatic on return, or `/recap`) summarizes *one* Claude session, inside that session. It knows nothing about the other sessions, other tools, or the edits the developer made by hand.
- **The plain "where was I" tool has been tried and hasn't caught on.** At least four launched in 2026, mostly Claude-only: `danieljohnmorris/where-was-i` (1 star), `alexander-posztos/ccdash` (2), `noluyorAbi/claude-code-recap` (30), `johnemorris/WhereWasI` (0). Several are polished, with demo GIFs and npm packages. Polish alone did not get them stars.
- **Stars are going to tools that work across many AI tools.** `thedotmack/claude-mem` (113k, memory for agents), `trailhq/Trail-Code` (11k, shared agent memory), `Dicklesworthstone/coding_agent_session_search` (1.2k, search history across 30+ tools), `jazzyalex/agent-sessions` (937, browse and resume sessions).
- **The gap:** nobody gives *the human* one catch-up across *all* their agents plus their own edits. A vendor like Anthropic is unlikely to build the cross-vendor version.

**Positioning:** `/recap` knows one Claude session. `brb` knows all of them, plus Codex, Gemini and your own edits.

---

## 2. What the owner decided

| Decision | Owner's words / choice |
|---|---|
| Help you **get back on track after drifting**, not stop you drifting | "get back after drifted" |
| Start from the developer's **changes and code** | "the changes or the code" |
| Two surfaces: **a terminal command you run** + **your AI assistant gets the same catch-up** | picked "A + C" from mockups |
| **No API key**, in any mode | "can you do without using any apikey?" |
| Cover **all sessions across tools plus your own edits** | picked "All my sessions" |
| The catch-up screen as mocked in Appendix A | "Looks right" |
| **Open source** | "make it open source" |
| Name: **brb** | picked from brb / rollcall / meanwhile |
| AI summaries: each session goes **only to its own AI tool**. If that tool is missing, show facts only | "Own tool only" |

---

## 3. Goals

1. **One command, one screen.** `brb` prints a catch-up of everything that moved while you were away.
2. **Every AI session, not just Claude.** Launch support: Claude Code, Codex CLI, Gemini CLI.
3. **Your own work too.** Uncommitted edits that no AI made, and TODO/FIXME comments you added, in the current repo.
4. **Clear status per session:** waiting on you, finished, failed/stopped, still working.
5. **Needs-you first.** Order: sessions waiting on you → finished → failed → your own unfinished work.
6. **Current project first.** The project you're in gets full detail ("HERE"). Other projects with activity get one line each ("ELSEWHERE").
7. **A way back in for every item.** Each item ends with the exact command to resume it: resume the session, view the diff, open the file at the line.
8. **Zero setup, no API key.** Useful output with no config, no account, no key. Optional AI-written one-line summaries borrow an AI CLI the user already has (see 7.5).
9. **Your AI gets it too.** A Claude Code plugin gives each new Claude session the catch-up for its project, so it knows what the other sessions are doing and doesn't step on them, plus a `/brb` command inside Claude.
10. **Built to be starred.** README, demo GIF and launch plan are deliverables (section 8).

---

## 4. Non-goals (v1)

- Preventing distraction: no site blocking, timers or focus modes.
- Memory for the AI across sessions. That's claude-mem's territory.
- Searching or browsing full session history. Other tools own that.
- A long-running dashboard, daemon or full-screen app. v1 is a command you run. A `--watch` mode can come later.
- Cursor support at launch. Its history is harder to read, so it goes in v1.1 **(my call)**.
- Team features, cloud sync, accounts.

## 5. Anti-goals (failure even if it "works")

- **Needing an API key, account or config file** before it shows anything useful.
- **Sending code or history anywhere new.** brb itself makes no network calls. The optional summaries send a session's text only to the AI tool that session came from, so nothing reaches a company it hadn't already gone to.
- **Wrong status.** Saying "waiting on you" when a session isn't (or missing one that is) kills trust. When unsure, show a neutral "idle" rather than guess.
- **Slow.** The facts must appear fast, with a target under 1 second on a machine with ~100 projects of agent history **(my call)**. AI summaries fill in afterwards and never block the facts.
- **Touching the AI tools' files.** brb is strictly read-only toward every agent's data.
- **Noise.** The Claude hook stays short and says nothing when there's nothing relevant. brb never pops up uninvited anywhere else.
- **One tool's format change breaking everything.** If an adapter can't parse a tool's files, brb skips that tool with a one-line note and shows the rest.

---

## 6. Constraints

- **Language and packaging (my call):** TypeScript on Node (current LTS, ≥ 20), published to npm as `brb` so `npx brb` works with nothing installed. The `brb` name was free on npm on 2026-11-05. Re-check before the first publish.
- **License (my call):** MIT.
- **One repo** holding the core library, the CLI and the Claude Code plugin.
- **Platforms (my call):** macOS and Linux at launch. Windows best-effort.
- **Data sources are local files.** Checked on the owner's machine on 2026-11-05, structure only, no content read:
  - **Claude Code:** `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. One JSON object per line with `type` (`user`, `assistant`, `system`, `attachment`, `custom-title`, `last-prompt`, `agent-name`, …), `cwd`, `gitBranch`, `sessionId`, `timestamp`. Desktop-app Code sessions appear here too.
  - **Codex CLI:** `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. Lines with `type` (`event_msg`, `response_item`, `turn_context`, …) and `payload.type` (`message`, `task_started`, `task_complete`, tool calls, …). Codex also keeps `~/.codex/session_index.jsonl` and SQLite state files.
  - **Gemini CLI:** `~/.gemini/tmp/<project>/` containing `chats/`, `logs.json` and `.project_root`, plus `~/.gemini/projects.json`.
  - These formats are undocumented and change between versions (Codex's versioned files show this). Each tool sits behind its own adapter, parses defensively, and is tested against recorded sample files.
- **Privacy:** sample files and the demo must never contain real user data. Build them by hand.

---

## 7. How it behaves

### 7.1 `brb` in the terminal

The approved mock is in Appendix A. Structure:

- **Header:** `Welcome back · away <duration> · <n> things moved`
- **HERE · <project>:** one row per AI session in this project that changed state while you were away, plus a **You** row.
  - Line 1: status mark, tool (Claude / Codex / Gemini), session title, status and age.
  - Line 2: the detail, such as the question it's asking, what it finished, or the error it stopped on.
- **ELSEWHERE:** each other project with activity, one line per session.
- **Footer:** 1–3 suggested next steps with exact commands, needs-you first (e.g. `claude --resume <id>`, `git diff …`, `code file:line`).

### 7.2 What each status means (my call, following the approved mock)

| Status | Meaning |
|---|---|
| Waiting on you | The session's last turn ended **blocked on you**. That means one of: a pending permission or approval request, a structured question (e.g. Claude's question tool, or a plan waiting for approval), or a turn that made no changes and ended by asking you something. |
| Finished | The last turn did its work (edits, commands) and isn't blocked. A closing offer like "Want me to add tests too?" does **not** make it "waiting". The offer can show as the detail line. |
| Failed / stopped | The turn errored or was interrupted, **or** its last test, build or command failed with no later success. |
| Working | Its history file was written in the last ~60 seconds. |
| Idle | Doesn't clearly match any of the above. Never guess "waiting". |

- Status comes from **what happened in the session's last turn**, not from whether its window is still open. A closed session with an unanswered question is still "waiting on you", and its resume command reopens it.
- Waiting sessions stay visible for **7 days** **(my call)**, even outside the "away" window. Older ones drop off. That also caps how much history brb reads: only files changed in the last 7 days.
- None of this needs AI. The builder works out how to detect these signals for each tool (section 9).

### 7.3 The "You" row

- Uncommitted changes in the current repo that **no AI session made**. Agent edits can be told apart using the file-edit tool calls recorded in the transcripts.
- TODO / FIXME comments added in those uncommitted changes, with file:line.

### 7.4 "While you were away"

Default window **(my call; the builder may refine it)**: since your last message to any AI session or your last commit in this project, whichever is later. On a first run with no history, use the last 8 hours. Re-running `brb` immediately should still show anything waiting on you.

### 7.5 Optional AI one-liners (no API key)

- Facts (status, files, questions, errors, TODOs) come straight from local files and need no AI.
- **Each session is summarized only by its own tool (owner's decision).** Claude Code sessions go to `claude -p` with a small, fast model, Codex sessions to `codex exec`, and Gemini sessions to `gemini -p`. A session's text never goes to a different company's tool. If a session's own tool isn't installed, that session shows its facts with no summary.
- This runs on the user's existing logins and subscriptions, so no key is involved.
- Facts print first. Summaries fill in when ready. `codex exec` and `gemini -p` can be much slower than `claude -p`, so the facts never wait on them.
- Summaries are cached per session and last event, so re-runs cost nothing. Prompts stay tiny because each call counts toward the user's plan.
- `--no-ai` (and an env var) turns this off.

### 7.6 Claude Code plugin

- **On session start:** inject a short catch-up for *this project only* (other sessions' status, files they changed, what's waiting) so Claude knows about parallel work and avoids clashing. About 10 lines at most. Silent when there's nothing relevant.
- **`/brb` inside Claude:** shows the full catch-up.
- The plugin needs no AI call of its own because the Claude session is the AI.

### 7.7 Other agents and scripts (my call)

- `brb --json`: machine-readable output.
- `brb --brief`: the compact project catch-up the Claude hook uses, so Codex or Gemini users can wire it into their own agent instructions. The README shows how.
- `brb --all`: expand every project. `brb --since 2h`: override the window.

---

## 8. Launch plan (part of the deliverable)

- **README:**
  - One-line pitch and the demo GIF at the very top
  - `npx brb` as the whole install
  - A "Why not just `/recap`?" section
  - Supported-tools table
  - Privacy promise: reads local files, no API key, and a session's text only ever goes back to the AI tool it came from
- **Demo:** a scripted, reproducible recording of a hand-made demo project with fake sessions. No real data. Recording tool is the builder's choice.
- **Before launch:** list the Claude Code plugin in plugin directories and marketplaces. Open PRs to "awesome" lists for Claude Code and AI coding tools.
- **Launch day:** Show HN, r/ClaudeAI, r/ChatGPTCoding, and an X post with the GIF, midweek, US morning. The owner posts these. The builder drafts the posts.
- **After launch:** fast replies to issues in week one. Cursor support ships as follow-up news (v1.1).
- **Assumption (my call, not confirmed):** the owner has no existing following, so the plan relies only on places that don't need one.
- **Success:** 500+ stars (owner's goal). No deadline was set.

---

## 9. Left to the builder

- Status detection per tool: transcript patterns, checking for running processes, and/or having the Claude plugin's hooks record session state to a small local file. Prefer correct over clever.
- Mapping sessions to projects (cwd → git root, including worktrees).
- Telling agent edits from human edits.
- Terminal rendering: colors, widths, no-color and narrow-terminal behavior.
- Performance: e.g. read only recently modified files, and only their tails.
- Test approach (sample files per tool and version).
- Claude Code plugin packaging.
- Demo recording tooling.

---

## 10. Questions from the design review

- **How is a session's status decided?** By what happened in its last turn, following the approved mock. The rules are in 7.2 **(my call)**.
- **May one company's AI summarize another tool's sessions?** No. Each session goes only to its own tool (owner's decision, 7.5).

---

## Appendix A — approved mock

In the terminal:

```
~/shopfront $ brb

 Welcome back · away 47 min · 4 things moved

 HERE · shopfront
 ◐ Claude  fix checkout rounding     waiting on you · 8 min
           asks: "Round per item or on the total?"
 ● Claude  add login rate limit      finished · 12 min ago
           6 tests added, all passing
 ✕ Codex   upgrade to Next 16        stopped · build failed
           next.config.js: unknown option "ppr"
 ✎ You     2 files changed, not committed
           your TODO: reset count after a good login (rateLimit.ts:42)

 ELSEWHERE
 ● Gemini  blog · fix RSS dates      finished · 30 min ago

 → answer Claude        claude --resume 8f2c
 → review the limiter   git diff main...login-rate-limit
```

In a new Claude session in the same project:

```
 ⎿ Catch-up from brb · 3 other sessions touched this project
   • Claude "add login rate limit" finished, changed auth.ts
   • Claude "fix checkout rounding" is waiting on you
   • Codex "upgrade to Next 16" failed on next.config.js

 > fix the flaky cart test

 ● Another session just changed auth.ts, so I'll stay out of it.
   The flaky test is cart.test.ts:58...
```
