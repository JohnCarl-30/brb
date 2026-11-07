# Session Recap Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `brb show <n>` and `s<n>` at the pick prompt write a one-session HTML recap (Done, Fixed, screenshots, resume command) and open it in the browser.

**Architecture:**
- Sessions and rows learn their source file. A recap re-reads that one file whole, both for the AI's input and for its images.
- New `src/recap.ts` covers four things: finding the images, building the AI's input text, parsing the AI's reply, and rendering and writing the HTML.
- AI and cache plumbing is shared with `src/summarize.ts`.
- `src/cli.ts` gains `show`, `s<n>` and opening the browser.

**Tech Stack:** TypeScript ESM, Node ≥ 20, vitest, tsup (`dist/brb.mjs` is committed and must be rebuilt), picocolors.

**Spec:** `docs/superpowers/specs/2026-11-07-session-recap-design.md`

## Global Constraints

- Tests only use synthetic fixtures (`test/support/fake-home.ts`), and the AI CLIs are stubbed through `Runner` / `which`. Never read real `~/.claude`, `~/.codex`, `~/.gemini` or `~/.brb`, and never run brb against the real home.
- **Page safety:**
  - All text in the page is HTML-escaped.
  - Only `image/png`, `image/jpeg`, `image/gif` and `image/webp` are embedded, as `data:` URIs, with base64 that matches `^[A-Za-z0-9+/]+={0,2}$`.
  - The page head has `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">` and no `<script>`.
- **Files and modes:**
  - Pages go to `<brb home>/recaps/<tool>-<session id>.html`.
  - The folder is mode 0700 and each file 0600.
  - Pages older than 7 days (mtime) are deleted whenever a recap is written.
- **Limits:**
  - Total embedded image bytes are capped at 50 MB. Past the cap, the page says "N more screenshots not shown".
- **When the AI is asked:**
  - The recap asks the AI only when stdout is a TTY and neither `--no-ai` nor `BRB_NO_AI=1` is set.
  - It sends the text only to the session's own tool, through `commandFor`, in the private `brb-summaries` folder with `BRB_INTERNAL=1`.
- **When the AI doesn't answer:** no AI, a timeout, Ctrl-C or an unparseable reply all give the fallback page. The fallback shows the last 6 user/agent messages in place of Done and Fixed, and the screenshots stay.
- **Usage error:** `show` combined with `--json` or `--brief`.
- **Release and commits:**
  - Bump the version to 0.5.0 in `package.json` and `.claude-plugin/plugin.json`.
  - Commit subjects use Conventional Commits (`feat:`, `docs:`, `test:`).

## Review Focus

- **A session file over 80 KB**, where Done and the images sit in the skipped middle. The recap must still see them, because it re-reads the whole file (Task 1 test).
- **The same image recorded twice** (Codex writes a pasted image both in the event and in the response item). It shows once (Task 2 test).
- **Session text containing `<script>` or `</title>`.** It shows escaped, and the page has no script (Task 2 test).
- **An AI reply with chatter around the lines, or with no DONE/FIXED lines.** The first is parsed; the second gives the fallback (Task 2 test).
- **`brb show 9` with only 3 rows**, which is the same error as `brb 9`; and **`brb show` with no number** (Task 4 tests).

---

### Task 1: Sessions know their file; read one session whole

**Files:**
- Modify: `src/types.ts` (Session), `src/catchup.ts` (Row and the row build), `src/render.ts` (`renderJson` drops `file`)
- Modify: `src/adapters/claude.ts`, `src/adapters/codex.ts`, `src/adapters/gemini.ts`, `src/adapters/index.ts`
- Test: `test/adapters/claude.test.ts`, `test/adapters/index.test.ts`, `test/render.test.ts`

**Interfaces:**
- Produces: `Session.file?: string` and `Row.file?: string`, the absolute path of the session's history file.
- Produces: `readSessionFile(tool: Tool, file: string, cwd: string): Promise<Session | null>` in `src/adapters/index.ts`. It reads the whole file whatever its size, including Claude's. `cwd` is used for Gemini, which keeps its folder outside the chat file. Codex gets an empty titles map.

- [ ] **Step 1: Write the failing tests.**
  - Each adapter test asserts that `session.file` equals the fixture path the writer returned.
  - `readSessionFile` test: a Claude fixture padded past `HEAD_BYTES + TAIL_BYTES`, with a user prompt `'middle prompt'` in the middle. `readSessionFile('claude', path, cwd)` has a `user` event with that text and no `partialTurn`.
  - `renderJson` output has no `"file"` key.
- [ ] **Step 2: Run `npx vitest run test/adapters test/render.test.ts`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Each adapter's `readSession` sets `file: file.path`.
  - Claude's `readSession(file, whole = false)`: when `whole`, it reads `readText` lines with `tailStart: null`.
  - `buildCatchUp` copies `s.file` to the row.
  - `renderJson`'s replacer drops `key === 'file'` as well as `longText`.
- [ ] **Step 4: Run `npx vitest run`.** Expected: all PASS.
- [ ] **Step 5: Commit** with `feat: remember each session's file and read one session whole`.

### Task 2: Recap content (pure functions)

**Files:**
- Create: `src/recap.ts`
- Test: `test/recap.test.ts`

**Interfaces:**
- Consumes: `Session` (Task 1), `Row`, `TOOL_NAME`, `formatAge`, `commandText`.
- Produces:
  - `interface Image { mediaType: string; data: string }`.
  - `findImages(text: string): Image[]` takes the whole file text. It parses each line as JSON and, if no line parses, parses the whole text (Gemini). It then deep-walks the values and takes any of three shapes:
    - `{type:'image', source:{type:'base64', media_type, data}}` (Claude, including inside `tool_result` content);
    - `{type:'input_image', image_url:'data:image/…;base64,…'}` (Codex);
    - `{inlineData:{mimeType, data}}` (Gemini).
  - `findImages` keeps file order and drops repeats of the same `data`. Disallowed types and bad base64 are skipped.
  - `recapInput(s: Session, max = 24_000): string` holds lines `User: …`, `Agent: …`, `$ <command>` (with ` (failed)` when not ok) and `Edited: <files>`. It keeps the **last** `max` chars.
  - `RECAP_PROMPT` asks for up to 6 lines `DONE: …` and up to 6 lines `FIXED: …`, each from the text only, with nothing else in the reply.
  - `parseRecap(reply: string): { done: string[]; fixed: string[] } | null` matches `^\s*[-*]?\s*(DONE|FIXED):\s*(.+)$` (case-insensitive) per line, each item `oneLine(…, 200)`, at most 6 per list. It returns null when both lists are empty.
  - `lastMessages(s: Session, n = 6): string[]` holds the last n user/agent texts as `You: …` / `<Tool>: …`, each `oneLine(…, 500)`.
  - `renderRecapHtml(r: Row, now: number, body: { recap: {done: string[]; fixed: string[]} | null; messages: string[]; images: Image[]; hiddenImages: number }): string` returns a full document with:
    - the head: CSP meta, `<title>` from the title, inline CSS that works with `prefers-color-scheme`;
    - a header with the title, project name, tool, `formatAge` and the status label;
    - a Done section, a Fixed section only if non-empty, or "Last messages" when `recap` is null;
    - a Screenshots section only if there are images, plus the "N more screenshots not shown" line;
    - the resume command in `<code>`.

- [ ] **Step 1: Write the failing tests** in `test/recap.test.ts`.
  - `findImages` on three lines, one per shape, plus a repeated Codex image, a `image/svg+xml` image and a `data` of `"not base64!"`: it returns exactly 3, in order.
  - `findImages` on a whole Gemini JSON doc with an `inlineData` part: 1 image.
  - `recapInput` on a session with 30k chars of prompts ends with the last event and is ≤ 24 000 chars.
  - `parseRecap('Sure!\nDONE: added tracing\n- FIXED: crash on empty input\nthanks')` returns `{done:['added tracing'], fixed:['crash on empty input']}`. `parseRecap('no idea')` returns `null`.
  - `renderRecapHtml`:
    - with a title `'<script>alert(1)</script>'`, the output contains `&lt;script&gt;`, has no `<script`, and contains the CSP meta;
    - with `fixed: []`, it has no `Fixed` heading;
    - with `recap: null` and messages, it shows `Last messages`;
    - with 2 images, there are 2 `<img src="data:image/png;base64,`.
- [ ] **Step 2: Run `npx vitest run test/recap.test.ts`.** Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** the functions above in `src/recap.ts`. Escape with one `esc()` covering `& < > " '`.
- [ ] **Step 4: Run `npx vitest run test/recap.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: build session recap pages from session files`.

### Task 3: Write a recap (AI, cache, file, cleanup)

**Files:**
- Modify: `src/summarize.ts`. Export `privateFolder`, `readCache` and a new `writeCache(file, cache, fresh)` taken out of `summarizeRows`. `Runner` options gain `signal?: AbortSignal`, which `defaultRunner` passes to `execFile`.
- Modify: `src/recap.ts`
- Test: `test/recap.test.ts`, `test/summarize.test.ts` (must still pass unchanged)

**Interfaces:**
- Consumes: `readSessionFile` (Task 1); `findImages`, `recapInput`, `parseRecap`, `lastMessages`, `renderRecapHtml` (Task 2); `commandFor`, `summaryKey`, `Runner`.
- Produces: `writeRecap(r: Row, o: { brbHome: string; now: number; env: NodeJS.ProcessEnv; ai: boolean; runner: Runner; which: (bin: string) => boolean; tmpDir?: string; signal?: AbortSignal }): Promise<string>`. It returns the page path, and throws only when `r.file` is missing or the page can't be written.
  - It reads the file text once, then gets the images with `findImages`. For the session it calls `readSessionFile` (it re-reads the file, which is acceptable for a one-off).
  - When `o.ai`, it looks in the cache `<brbHome>/cache/recaps.json`, keyed by `summaryKey(r)`, which stores the raw reply. If not cached and the tool is installed, it runs `commandFor(r.tool, RECAP_PROMPT + recapInput(s))` with a 90 000 ms timeout, in `<tmpDir>/brb-summaries` (`privateFolder`), with `BRB_INTERNAL: '1'` and `signal`. A parsed reply is cached, capped like summaries.
  - Images are kept in order while the running total of `data.length` stays ≤ 50 000 000. The rest count toward `hiddenImages`.
  - It creates `<brbHome>/recaps` (0700), deletes `*.html` there with mtime older than `now - 7 days`, and writes `<tool>-<id>.html` (0600). Any `/` or `\` in the id is replaced with `_`.

- [ ] **Step 1: Write the failing tests** using a fake home and a Claude fixture with one image block.
  - With `ai: true` and a stub runner replying `DONE: wrote tests`, the page contains `wrote tests` and the image. The runner was called once with `bin === 'claude'`, `env.BRB_INTERNAL === '1'`, and `cwd` ending in `brb-summaries`. A second call is served from the cache, with the runner not called.
  - With `ai: false`: the runner is never called and the page has `Last messages`.
  - A runner replying `code: 1`: the page has `Last messages`.
  - A pre-existing `recaps/old.html` with mtime `now - 8 days` is deleted. One with `now - 1 day` stays. The written file's mode is `0o600` (skip the mode check on win32).
- [ ] **Step 2: Run `npx vitest run test/recap.test.ts`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `writeRecap` and the `summarize.ts` exports and signal.
- [ ] **Step 4: Run `npx vitest run`.** Expected: all PASS, including the unchanged `test/summarize.test.ts`.
- [ ] **Step 5: Commit** with `feat: write recap pages with AI done/fixed lists and cleanup`.

### Task 4: CLI, prompt, docs, release

**Files:**
- Modify: `src/cli.ts`, `src/render.ts` (footer hint), `README.md`, `test/support/expected.ts` (PRIVACY, EXPECTED_TERMINAL hint), `package.json`, `.claude-plugin/plugin.json`, `dist/brb.mjs` (rebuilt)
- Test: `test/cli.test.ts`, `test/render.test.ts`, `test/readme.test.ts`

**Interfaces:**
- Consumes: `writeRecap` (Task 3).
- Produces:
  - `RunResult.recap?: (n: number, signal?: AbortSignal) => Promise<string>`, the page path for listed row n (1-based, same list as `brb <n>`). Its `ai` is `o.isTTY && !values['no-ai'] && o.env.BRB_NO_AI !== '1'`.
  - `RunResult.show?: number`.
  - `parsePick` additionally returns `{ show: number }` for `s<n>` / `S <n>` in range.

- [ ] **Step 1: Write the failing tests.**
  - `run(['show','2'])` (non-TTY) returns `show: 2` and a `recap` whose page path ends `.html`. With a stub runner, it never calls the AI.
  - `run(['show','9'])` with 3 rows gives exit 1 and `no session 9: pick 1 to 3`.
  - `run(['show'])` gives exit 1 and `give one session number, e.g. brb show 2`.
  - `run(['show','1','--json'])` gives exit 1.
  - `parsePick('s2', 3)` gives `{show: 2}`; `parsePick('s9', 3)` gives `'again'`.
  - The terminal footer hint is ` brb <number> picks that session back up · brb show <number> opens its recap`.
- [ ] **Step 2: Run `npx vitest run test/cli.test.ts test/render.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **In `run()`:**
    - A first positional of `show` takes exactly one number; any other positional keeps today's rules.
    - The listed rows come from one place, used by pick, show and `choices`.
    - `recap` is set whenever there are listed rows (and numbering is on).
  - **In `main()`:**
    - **Showing a recap:** while it is written, print `pc.dim(' writing recap… (Ctrl-C to skip)')`, with a `process.once('SIGINT')` that aborts the controller and is removed afterwards. Then print ` → recap: <path>`. If stdout is a TTY, open the page with `open` (darwin), `xdg-open` (linux) or `cmd /c start ""` (win32) via `spawnSync(…, {stdio:'ignore'})`. If that fails, the printed path is the fallback.
    - **`result.show`:** show that recap, then exit.
    - **At the prompt:** `askPick` now makes one readline per question and returns the `parsePick` result. The loop shows the recap for `{show}` and asks again, resumes on a number, and quits on `'quit'`.
    - **Prompt text:** `` ` Pick a session (1-${n}), s<n> for its recap, Enter to quit: ` ``.
  - **HELP** gains `       brb show <number> open that session's recap in your browser` under the `brb <number>` line.
  - **README:**
    - Add a "Session recaps" subsection under "Picking a session back up". It covers what is on the page, the `s<n>` prompt, the fallback, and the 7-day cleanup.
    - Add `~/.brb/recaps/` and `~/.brb/cache/recaps.json` to the Privacy file list.
    - Reword the privacy sentence, and mirror it in `PRIVACY`, to: "If you have an AI CLI installed, brb can ask it for one-line summaries and session recaps, and a session's text only ever goes back to the AI tool it came from."
    - Paste the HELP into Options verbatim.
  - **Release:** version 0.5.0 in both manifests, then `npm run build`.
- [ ] **Step 4: Run `npx vitest run && npx tsc --noEmit`.** Expected: all PASS.
- [ ] **Step 5: Manual check** in a fake home (`env -i HOME=<fake> PATH="<stub bin>:$PATH"`), with stub `claude` and `open` scripts. `node dist/brb.mjs show 1` writes the page, and the stub `open` receives its path. The page opens in a real browser from the scratchpad copy only.
- [ ] **Step 6: Commit** with `feat: add brb show <n> and s<n> to open a session recap`.
