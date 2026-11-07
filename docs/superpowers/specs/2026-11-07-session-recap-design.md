# Session recap page

## Intent

When the owner comes back to a session, the `brb` list tells them its status and one line about it. That isn't enough to remember what a long session actually got through. A recap page answers "what did this session do?" before they pick it back up: what it built, what it fixed, and the screenshots that were in it.

The reader is the owner alone. Nothing is shared or uploaded.

## What it is

A page for **one session**, opened in the default browser. It has, top to bottom:

1. **Header**: the session's title, project, tool (Claude / Codex / Gemini), when it was last active, and its status. These are the same facts the `brb` row shows.
2. **Done**: a short list of what the session built.
3. **Fixed**: a short list of what it fixed. If there is nothing, the section is left out.
4. **Screenshots**: every image already in the session, in order, both pasted by the owner and returned by tools (for example a browser screenshot tool). brb never takes new screenshots. If there are none, the section is left out.
5. **Pick it back up**: the resume command, the same string `brb <n>` runs.

Layout: one page, one session (option A in the mockup). It is not an all-sessions page.

## How you get there (owner decided: both)

- **`brb show <n>`** writes the recap for row `n` (same numbering as the list and `brb <n>`), opens it in the browser and exits. Without a terminal it writes the page with the fallback (no AI, keeping the README's promise that brb asks no AI without a terminal) and only prints the file's path. `show` with `--json` or `--brief` is a usage error. *(My calls.)*
- **From the "Pick a session" prompt**: typing a number still resumes it, as now. Typing `s<n>` (for example `s2`) writes and opens that session's recap, then asks again, so the owner can read and then pick. *(My call: the `s` prefix. The prompt text gains a hint for it.)*
- The list's footer hint and `--help` mention `brb show <number>`.

## Where Done and Fixed come from (my call)

The same AI CLI brb already uses for one-liners writes them, under the same rules as `src/summarize.ts`. A session's text goes only to the tool it came from, and only if that tool is installed. It runs with no tools, MCP or write access, in brb's private summaries folder, with `BRB_INTERNAL=1`. No API key, nothing new to set up.

- It is one call per recap, asking for the Done and Fixed lists in a fixed, easy-to-parse format. The input is the session's prompts, the agent's prose and its commands, trimmed to a cap that is kept well under the OS argv limit.
- The call takes longer than a one-liner, so the timeout is longer. While it runs, the terminal shows one line ("writing recap… Ctrl-C to skip"). Skipping or a timeout still writes the page, using the fallback below.
- The result is cached under `~/.brb/cache/` by the same key as summaries (tool, session id, last activity), so reopening an unchanged session is instant.
- **Fallback** (no AI CLI, `--no-ai` / `BRB_NO_AI=1`, timeout, unparseable reply): Done and Fixed are replaced by the session's last few prompts and agent messages, verbatim. The screenshots still show.

## Where the page lives (my call)

- It is a single self-contained HTML file at `~/.brb/recaps/<tool>-<session id>.html`. The folder is mode 0700 and the file 0600. It is rewritten each time.
- **Cleanup (owner decided).** Each time a recap is written, pages in `~/.brb/recaps/` older than 7 days (by mtime) are deleted. That matches the list's 7-day window. The README says so.
- Images are embedded as `data:` URIs, so the file opens anywhere and needs no network.
- It is opened with `open` on macOS, `xdg-open` on Linux and `start` on Windows. If opening fails, brb prints the path.

## Constraints

- **Privacy (the project's promise).** Local files only. Nothing leaves the machine except the text going to the user's own AI CLI, as summaries already do. The README's Privacy section is updated to list the new files, and its sentence about one-line summaries is reworded to also cover recaps (the `PRIVACY` constant in `test/support/expected.ts` changes with it). *(My call.)*
- **Untrusted content.** Session text and AI output can contain HTML or injected instructions. All text is HTML-escaped. Only images with media type png, jpeg, gif or webp are embedded. The page carries a CSP meta tag (`default-src 'none'; img-src data:; style-src 'unsafe-inline'`), so no script runs and nothing loads from the network.
- **Reading the whole session.** The list adapters read only the head and tail of each file (`readHeadTail`). A recap needs the full session, including images, so it re-reads that one session's whole file. Rows/sessions therefore need to carry their source file path. The list path keeps its head and tail reads and must not get slower.
- **Huge images or sessions.** Cap the total embedded image bytes (for example 50 MB). Beyond it, show "N more screenshots not shown".
- **Tests and dev safety.** Use synthetic fixtures only. Never read real `~/.claude`, `~/.codex`, `~/.gemini` or `~/.brb` data, and stub the AI CLIs in tests. Never run brb against the real home: use `env -i HOME=<fake> PATH="$PATH"`.

## Goals

- Glance at one session's work and screenshots in the browser, then resume it.
- Works with no setup. Degrades to "last messages + screenshots" without AI.

## Non-goals

- A page with all sessions. Sharing, publishing or uploading the page.
- Taking new screenshots, or screenshots of the app.
- Recaps in the terminal (the list stays as it is).
- `--json` / `--brief` output for recaps.

## Anti-goals (a failure even if it works)

- The `brb` list gets slower, or reads whole session files.
- Any network request from the page, or any script in it.
- A recap that invents work. When the AI isn't sure, the lists stay short. The prompt says to list only what the session text shows.

## Left to the builder

- Each tool's on-disk image shape. Claude: `image` blocks in user messages and inside `tool_result` content. Codex: input image items in the rollout. Gemini: inline data parts. Check these against each tool's public format and build fixtures from them. If one tool's images can't be found reliably, ship without that tool's screenshots and say so.
- The exact AI prompt and reply format, the text cap, the timeout and the page's styling. Plain styling that reads well in light and dark is enough.
- Version bump (minor), README sections (Picking a session back up, Privacy, Options), and the demo/launch docs only if they become wrong.
