#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/picocolors/picocolors.js
var require_picocolors = __commonJS({
  "node_modules/picocolors/picocolors.js"(exports, module) {
    "use strict";
    var p = process || {};
    var argv = p.argv || [];
    var env = p.env || {};
    var isColorSupported = !(!!env.NO_COLOR || argv.includes("--no-color")) && (!!env.FORCE_COLOR || argv.includes("--color") || p.platform === "win32" || (p.stdout || {}).isTTY && env.TERM !== "dumb" || !!env.CI);
    var formatter = (open2, close, replace = open2) => (input) => {
      let string = "" + input, index = string.indexOf(close, open2.length);
      return ~index ? open2 + replaceClose(string, close, replace, index) + close : open2 + string + close;
    };
    var replaceClose = (string, close, replace, index) => {
      let result = "", cursor = 0;
      do {
        result += string.substring(cursor, index) + replace;
        cursor = index + close.length;
        index = string.indexOf(close, cursor);
      } while (~index);
      return result + string.substring(cursor);
    };
    var createColors = (enabled = isColorSupported) => {
      let f = enabled ? formatter : () => String;
      return {
        isColorSupported: enabled,
        reset: f("\x1B[0m", "\x1B[0m"),
        bold: f("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
        dim: f("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
        italic: f("\x1B[3m", "\x1B[23m"),
        underline: f("\x1B[4m", "\x1B[24m"),
        inverse: f("\x1B[7m", "\x1B[27m"),
        hidden: f("\x1B[8m", "\x1B[28m"),
        strikethrough: f("\x1B[9m", "\x1B[29m"),
        black: f("\x1B[30m", "\x1B[39m"),
        red: f("\x1B[31m", "\x1B[39m"),
        green: f("\x1B[32m", "\x1B[39m"),
        yellow: f("\x1B[33m", "\x1B[39m"),
        blue: f("\x1B[34m", "\x1B[39m"),
        magenta: f("\x1B[35m", "\x1B[39m"),
        cyan: f("\x1B[36m", "\x1B[39m"),
        white: f("\x1B[37m", "\x1B[39m"),
        gray: f("\x1B[90m", "\x1B[39m"),
        bgBlack: f("\x1B[40m", "\x1B[49m"),
        bgRed: f("\x1B[41m", "\x1B[49m"),
        bgGreen: f("\x1B[42m", "\x1B[49m"),
        bgYellow: f("\x1B[43m", "\x1B[49m"),
        bgBlue: f("\x1B[44m", "\x1B[49m"),
        bgMagenta: f("\x1B[45m", "\x1B[49m"),
        bgCyan: f("\x1B[46m", "\x1B[49m"),
        bgWhite: f("\x1B[47m", "\x1B[49m"),
        blackBright: f("\x1B[90m", "\x1B[39m"),
        redBright: f("\x1B[91m", "\x1B[39m"),
        greenBright: f("\x1B[92m", "\x1B[39m"),
        yellowBright: f("\x1B[93m", "\x1B[39m"),
        blueBright: f("\x1B[94m", "\x1B[39m"),
        magentaBright: f("\x1B[95m", "\x1B[39m"),
        cyanBright: f("\x1B[96m", "\x1B[39m"),
        whiteBright: f("\x1B[97m", "\x1B[39m"),
        bgBlackBright: f("\x1B[100m", "\x1B[49m"),
        bgRedBright: f("\x1B[101m", "\x1B[49m"),
        bgGreenBright: f("\x1B[102m", "\x1B[49m"),
        bgYellowBright: f("\x1B[103m", "\x1B[49m"),
        bgBlueBright: f("\x1B[104m", "\x1B[49m"),
        bgMagentaBright: f("\x1B[105m", "\x1B[49m"),
        bgCyanBright: f("\x1B[106m", "\x1B[49m"),
        bgWhiteBright: f("\x1B[107m", "\x1B[49m")
      };
    };
    module.exports = createColors();
    module.exports.createColors = createColors;
  }
});

// src/cli.ts
var import_picocolors2 = __toESM(require_picocolors(), 1);
import { spawn, spawnSync } from "child_process";
import { createInterface } from "readline/promises";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

// package.json
var version = "0.8.0";

// src/adapters/index.ts
import * as os from "os";
import * as path from "path";

// src/adapters/claude.ts
import { basename as basename2, join as join2 } from "path";

// src/text.ts
var ESCAPE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -\/]*[@-~]|[()*+\-.\/].|.)/gu;
var CONTROL_OR_SPACE = /[\x00-\x1f\x7f-\x9f\s]+/g;
var CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
var MARKDOWN_MARKS = /\*\*|__|`/g;
var LEADING_MARKERS = /^[\s#*-]*(?:\d+[.)]\s+)?/;
var SENTENCE_BREAK = /(?<=[.!?])\s+/;
var PROBLEM_WORDS = /error|fail|unknown|cannot|not found/i;
function clean(text) {
  return text.replace(ESCAPE, "").replace(CONTROL_OR_SPACE, " ").trim();
}
function sentences(text) {
  return text.replace(MARKDOWN_MARKS, "").replace(LEADING_MARKERS, "").split(SENTENCE_BREAK);
}
function oneLine(text, max) {
  const line = clean(text);
  let cutAt = 0;
  let seen = 0;
  for (const char of line) {
    if (seen === max) return `${line.slice(0, cutAt)}\u2026`;
    if (seen < max - 1) cutAt += char.length;
    seen++;
  }
  return line;
}
var commandText = (text) => text.replace(ESCAPE, "").replace(CONTROL, " ");
function firstSentence(text, max = 70) {
  return oneLine(sentences(text)[0], max);
}
function lastQuestion(text, max = 70) {
  const question = sentences(text).filter((sentence) => sentence.endsWith("?")).at(-1);
  return question === void 0 ? null : oneLine(question.split("\n").at(-1).replace(LEADING_MARKERS, ""), max);
}
function errorLine(output, max = 70) {
  const lines = output.split("\n").map(clean).filter(Boolean).reverse();
  return oneLine(lines.find((line) => PROBLEM_WORDS.test(line)) ?? lines[0] ?? "", max);
}

// src/adapters/files.ts
import { open, readdir, readFile, stat } from "fs/promises";
import { basename, join } from "path";
var SCAN_MS = 7 * 864e5;
var HEAD_BYTES = 16384;
var TAIL_BYTES = 65536;
var TITLE_MAX = 60;
var ERROR_MAX = 200;
var OUTPUT_KEEP_CHARS = 4e3;
var isMissing = (error) => error?.code === "ENOENT";
async function listFolder(folder) {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
async function mtimeOf(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function recentFiles(dir, name, sinceMs, maxDepth) {
  async function walk(folder, depth) {
    const found = await Promise.all((await listFolder(folder)).map(async (entry) => {
      const path10 = join(folder, entry.name);
      if (entry.isDirectory()) {
        return entry.name !== "subagents" && depth < maxDepth ? walk(path10, depth + 1) : [];
      }
      if (!entry.isFile() || !name.test(entry.name)) return [];
      const mtimeMs = await mtimeOf(path10);
      return mtimeMs !== null && mtimeMs > sinceMs ? [{ path: path10, mtimeMs }] : [];
    }));
    return found.flat();
  }
  return walk(dir, 1);
}
async function readRange(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.toString("utf8", 0, filled);
}
var toLines = (text) => text.split("\n").filter((line) => line !== "");
async function readHeadTail(path10) {
  let handle;
  try {
    handle = await open(path10, "r");
  } catch (error) {
    if (isMissing(error)) return { lines: [], tailStart: null };
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size <= HEAD_BYTES + TAIL_BYTES) {
      return { lines: toLines(await readRange(handle, 0, size)), tailStart: null };
    }
    const head = toLines(await readRange(handle, 0, HEAD_BYTES));
    const tail = toLines(await readRange(handle, size - TAIL_BYTES, TAIL_BYTES));
    return { lines: [...head, ...tail], tailStart: head.length };
  } finally {
    await handle.close();
  }
}
async function readText(path10) {
  try {
    return await readFile(path10, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
var str = (value) => typeof value === "string" && value !== "" ? value : void 0;
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => typeof block?.text === "string").map((block) => block.text).join("\n");
}
function parseJsonLines(lines) {
  const objects = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (typeof value === "object" && value !== null) objects.push(value);
    } catch {
    }
  }
  return objects;
}
var BACKGROUND_FOLDERS = /* @__PURE__ */ new Set(["brb-summaries", "observer-sessions"]);
function isBackgroundCwd(cwd) {
  return BACKGROUND_FOLDERS.has(basename(cwd));
}

// src/adapters/claude.ts
var INTERRUPT_PREFIX = "[Request interrupted by user";
var EDIT_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
var ASK_TOOLS = /* @__PURE__ */ new Set(["AskUserQuestion", "ExitPlanMode"]);
var NOT_HUMAN_ORIGINS = /* @__PURE__ */ new Set(["task_notification", "scheduled", "peer", "system"]);
function textOf2(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}
function addToolResult(t, block, at) {
  const id = block.tool_use_id;
  const tool = typeof id === "string" ? t.toolUses.get(id) : void 0;
  if (!tool) return;
  t.answered.add(id);
  const failed = block.is_error === true;
  if (tool.name === "Bash") {
    const command = str(tool.input?.command);
    if (command) t.events.push({ kind: "command", at, command, ok: !failed, output: textOf2(block.content).slice(-OUTPUT_KEEP_CHARS) });
  } else if (EDIT_TOOLS.has(tool.name)) {
    const file = str(tool.input?.file_path) ?? str(tool.input?.notebook_path);
    if (file && !failed) t.events.push({ kind: "edit", at, files: [file] });
  }
}
function addUser(t, line, at, inTail) {
  const content = line.message?.content;
  let hasToolResult = false;
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type !== "tool_result") continue;
    hasToolResult = true;
    addToolResult(t, block, at);
  }
  const text = textOf2(content);
  if (text.trim() === "") return;
  if (text.startsWith(INTERRUPT_PREFIX)) {
    t.events.push({ kind: "error", at, text: "interrupted" });
  } else if (!hasToolResult && line.promptSource !== "system" && !NOT_HUMAN_ORIGINS.has(line.turnOrigin)) {
    t.events.push({ kind: "user", at, text });
    if (inTail) t.humanPromptInTail = true;
  }
}
function addAssistant(t, line, at, inTail) {
  const content = line.message?.content;
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      t.events.push({ kind: "agent", at, text: block.text });
    } else if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      t.toolUses.set(block.id, { name: block.name, input: block.input, at, inTail });
    }
  }
  if (line.message?.stop_reason === "end_turn") t.events.push({ kind: "turn-end", at });
}
function addLine(t, line, inTail) {
  if (line.isSidechain === true || line.isMeta === true) return;
  t.sessionId = str(line.sessionId) ?? t.sessionId;
  t.cwd = str(line.cwd) ?? t.cwd;
  t.branch = str(line.gitBranch) ?? t.branch;
  if (line.type === "custom-title") t.customTitle = str(line.customTitle) ?? t.customTitle;
  if (line.type === "agent-name") t.agentName = str(line.agentName) ?? t.agentName;
  if (line.type === "ai-title") t.aiTitle = str(line.aiTitle) ?? t.aiTitle;
  const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
  if (Number.isNaN(at)) return;
  if (line.type === "user") addUser(t, line, at, inTail);
  else if (line.type === "assistant") addAssistant(t, line, at, inTail);
  else if (line.type === "system" && line.subtype === "api_error") t.events.push({ kind: "error", at, text: "API error" });
}
function addUnansweredAsks(t, skippedMiddle) {
  for (const [id, tool] of t.toolUses) {
    if (t.answered.has(id) || skippedMiddle && !tool.inTail) continue;
    if (tool.name === "AskUserQuestion") {
      const question = str(tool.input?.questions?.[0]?.question) ?? "has a question for you";
      t.events.push({ kind: "ask", at: tool.at, reason: "question", text: question });
    } else if (tool.name === "ExitPlanMode") {
      t.events.push({ kind: "ask", at: tool.at, reason: "plan", text: "" });
    }
  }
}
function pendingTool(t, skippedMiddle) {
  const [id, tool] = [...t.toolUses].at(-1) ?? [];
  if (!id || !tool || t.answered.has(id) || ASK_TOOLS.has(tool.name) || skippedMiddle && !tool.inTail) return void 0;
  if ((t.events.at(-1)?.at ?? -Infinity) > tool.at) return void 0;
  return { at: tool.at, label: tool.name === "Bash" && oneLine(str(tool.input?.command) ?? "", 40) || tool.name };
}
function titleOf(t) {
  const firstPrompt = t.events.find((e) => e.kind === "user");
  for (const candidate of [t.customTitle, t.agentName, t.aiTitle, firstPrompt?.kind === "user" ? firstPrompt.text : void 0]) {
    const title = oneLine(candidate ?? "", TITLE_MAX);
    if (title) return title;
  }
  return "untitled session";
}
async function readSession(file, whole = false) {
  const { lines, tailStart } = whole ? { lines: (await readText(file.path) ?? "").split("\n"), tailStart: null } : await readHeadTail(file.path);
  const t = { events: [], toolUses: /* @__PURE__ */ new Map(), answered: /* @__PURE__ */ new Set(), humanPromptInTail: false };
  const headLines = tailStart === null ? lines : lines.slice(0, tailStart);
  for (const line of parseJsonLines(headLines)) addLine(t, line, false);
  if (tailStart !== null) for (const line of parseJsonLines(lines.slice(tailStart))) addLine(t, line, true);
  if (t.cwd === void 0 || isBackgroundCwd(t.cwd)) return null;
  addUnansweredAsks(t, tailStart !== null);
  t.events.sort((a, b) => a.at - b.at);
  const session = {
    tool: "claude",
    id: t.sessionId ?? basename2(file.path, ".jsonl"),
    cwd: t.cwd,
    title: titleOf(t),
    events: t.events,
    lastActivityAt: t.events.at(-1)?.at ?? file.mtimeMs,
    file: file.path
  };
  if (t.branch !== void 0 && t.branch !== "HEAD") session.branch = t.branch;
  const pending = pendingTool(t, tailStart !== null);
  if (pending) session.pendingTool = pending;
  if (tailStart !== null && !t.humanPromptInTail) session.partialTurn = true;
  return session;
}
async function readClaudeSessions(root, o) {
  const files = await recentFiles(join2(root, "projects"), /\.jsonl$/, o.sinceMs, 2);
  const sessions = await Promise.all(files.map((file) => readSession(file)));
  return sessions.filter((s) => s !== null);
}

// src/adapters/codex.ts
import { basename as basename3, isAbsolute, join as join3, resolve } from "path";
var ID_IN_FILE_NAME = /([0-9a-f-]{36})\.jsonl$/;
var READ_ITEMS = /* @__PURE__ */ new Set(["UserMessage", "AgentMessage", "CommandExecution", "FileChange"]);
var NOT_APPLIED = /* @__PURE__ */ new Set(["failed", "declined"]);
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isReadItem = (line) => line.type === "event_msg" && line.payload?.type === "item_completed" && READ_ITEMS.has(line.payload.item?.type);
var applied = (source) => source.success !== false && !NOT_APPLIED.has(source.status);
function commandText2(command) {
  if (typeof command === "string") return command;
  return Array.isArray(command) ? command.filter((word) => typeof word === "string").join(" ") : "";
}
function addSaid(t, kind, text, at) {
  if (text.trim() !== "") t.events.push({ kind, at, text });
}
function addCommand(t, source, at) {
  const command = commandText2(source.command);
  if (command.trim() === "") return;
  const output = typeof source.aggregated_output === "string" ? source.aggregated_output : "";
  t.events.push({ kind: "command", at, command, ok: source.exit_code === 0, output: output.slice(-OUTPUT_KEEP_CHARS) });
}
function addEdit(t, changes, at) {
  if (!isRecord(changes)) return;
  const files = Object.keys(changes).map((file) => t.cwd === void 0 ? file : resolve(t.cwd, file)).filter(isAbsolute);
  if (files.length > 0) t.events.push({ kind: "edit", at, files });
}
function addPatch(t, end, at) {
  if (!applied(end)) return;
  const own = isRecord(end.changes) && Object.keys(end.changes).length > 0;
  const begun = typeof end.call_id === "string" ? t.begun.get(end.call_id) : void 0;
  addEdit(t, own ? end.changes : begun, at);
}
function addItem(t, item, at) {
  if (!isRecord(item)) return;
  if (item.type === "UserMessage") addSaid(t, "user", textOf(item.content), at);
  else if (item.type === "AgentMessage") addSaid(t, "agent", textOf(item.content), at);
  else if (item.type === "CommandExecution") addCommand(t, item, at);
  else if (item.type === "FileChange" && applied(item)) addEdit(t, item.changes, at);
}
function addLegacy(t, payload, at) {
  if (payload.type === "user_message") addSaid(t, "user", textOf(payload.message), at);
  else if (payload.type === "agent_message") addSaid(t, "agent", textOf(payload.message), at);
  else if (payload.type === "exec_command_end") addCommand(t, payload, at);
  else if (payload.type === "patch_apply_begin") {
    const callId = str(payload.call_id);
    if (callId !== void 0) t.begun.set(callId, payload.changes);
  } else if (payload.type === "patch_apply_end") addPatch(t, payload, at);
}
function addLine2(t, line) {
  const payload = line.payload;
  if (!isRecord(payload)) return;
  if (line.type === "session_meta") t.id ??= str(payload.id);
  if (line.type === "session_meta" || line.type === "turn_context") t.cwd = str(payload.cwd) ?? t.cwd;
  if (line.type !== "event_msg") return;
  const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
  if (Number.isNaN(at)) return;
  if (payload.type === "item_completed") addItem(t, payload.item, at);
  else if (payload.type === "task_complete") t.events.push({ kind: "turn-end", at });
  else if (payload.type === "turn_aborted") t.events.push({ kind: "error", at, text: "interrupted" });
  else if (payload.type === "error") t.events.push({ kind: "error", at, text: oneLine(typeof payload.message === "string" ? payload.message : "", ERROR_MAX) || "error" });
  else if (!t.hasItems) addLegacy(t, payload, at);
}
async function readTitles(file) {
  const titles = /* @__PURE__ */ new Map();
  for (const line of parseJsonLines((await readText(file) ?? "").split("\n"))) {
    const id = str(line.id);
    const name = oneLine(typeof line.thread_name === "string" ? line.thread_name : "", TITLE_MAX);
    if (id !== void 0 && name !== "") titles.set(id, name);
  }
  return titles;
}
function titleOf2(t, threadName) {
  const firstPrompt = t.events.find((e) => e.kind === "user");
  return threadName ?? (oneLine(firstPrompt?.kind === "user" ? firstPrompt.text : "", TITLE_MAX) || "untitled session");
}
async function readSession2(file, titles) {
  const text = await readText(file.path);
  if (text === null) return null;
  const lines = parseJsonLines(text.split("\n"));
  const t = { events: [], hasItems: lines.some(isReadItem), begun: /* @__PURE__ */ new Map() };
  for (const line of lines) addLine2(t, line);
  const id = ID_IN_FILE_NAME.exec(basename3(file.path))?.[1] ?? t.id;
  if (id === void 0 || t.cwd === void 0 || isBackgroundCwd(t.cwd)) return null;
  t.events.sort((a, b) => a.at - b.at);
  return {
    tool: "codex",
    id,
    cwd: t.cwd,
    title: titleOf2(t, titles.get(id)),
    events: t.events,
    lastActivityAt: t.events.at(-1)?.at ?? file.mtimeMs,
    file: file.path
  };
}
async function readCodexSessions(root, o) {
  const [files, titles] = await Promise.all([
    recentFiles(join3(root, "sessions"), /^rollout-.*\.jsonl$/, o.sinceMs, 4),
    readTitles(join3(root, "session_index.jsonl"))
  ]);
  const sessions = await Promise.all(files.map((file) => readSession2(file, titles)));
  return sessions.filter((s) => s !== null);
}

// src/adapters/gemini.ts
import { join as join4, resolve as resolve2 } from "path";
var EDIT_TOOLS2 = /* @__PURE__ */ new Set(["replace", "write_file", "edit"]);
var timeOf = (stamp) => typeof stamp === "string" ? Date.parse(stamp) : NaN;
var SHELL_META = /^(Exit Code|Process Group PGID|Background PIDs): /;
var EXIT_CODE = /^Exit Code: (-?\d+)$/m;
function readShellResult(result) {
  const texts = [];
  let exitFailed = false;
  for (const part of Array.isArray(result) ? result : []) {
    const response = part?.functionResponse?.response;
    for (const [key, value] of [["output", str(response?.output)], ["error", str(response?.error)]]) {
      if (value === void 0) continue;
      const code = EXIT_CODE.exec(value)?.[1];
      if (code !== void 0 && Number(code) !== 0) exitFailed = true;
      let text = value.split("\n").filter((line) => !SHELL_META.test(line)).join("\n");
      if (key === "output") text = text.replace(/^Output: /, "");
      if (text !== "" && text !== "(empty)") texts.push(text);
    }
  }
  return { exitFailed, output: texts.join("\n").slice(-OUTPUT_KEEP_CHARS) };
}
function addToolCall(events, call, cwd, messageAt) {
  const name = str(call?.name);
  if (name === void 0) return;
  const finishedAt = timeOf(call.timestamp);
  const at = Number.isNaN(finishedAt) ? messageAt : finishedAt;
  if (call.status === "cancelled") {
    events.push({ kind: "error", at, text: `${name} was cancelled` });
  } else if (name === "run_shell_command") {
    const command = str(call.args?.command);
    if (command?.trim()) {
      const { exitFailed, output } = readShellResult(call.result);
      events.push({ kind: "command", at, command, ok: call.status === "success" && !exitFailed, output });
    }
  } else if (EDIT_TOOLS2.has(name) && call.status === "success") {
    const file = str(call.args?.file_path);
    if (file) events.push({ kind: "edit", at, files: [resolve2(cwd, file)] });
  }
}
function addMessage(events, message, cwd) {
  const at = timeOf(message?.timestamp);
  if (Number.isNaN(at)) return;
  if (message.type === "user") {
    const text = textOf(message.content);
    if (text.trim() !== "") events.push({ kind: "user", at, text });
  } else if (message.type === "gemini") {
    const calls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
    for (const call of calls) addToolCall(events, call, cwd, at);
    const text = textOf(message.content);
    if (text.trim() !== "") events.push({ kind: "agent", at, text });
    if (calls.length === 0) events.push({ kind: "turn-end", at });
  } else if (message.type === "error") {
    events.push({ kind: "error", at, text: oneLine(textOf(message.content), ERROR_MAX) || "error" });
  }
}
async function readSession3(file, cwd) {
  const text = await readText(file.path);
  if (text === null) return null;
  let chat;
  try {
    chat = JSON.parse(text);
  } catch {
    return null;
  }
  const id = str(chat?.sessionId);
  if (id === void 0) return null;
  const events = [];
  for (const message of Array.isArray(chat.messages) ? chat.messages : []) addMessage(events, message, cwd);
  events.sort((a, b) => a.at - b.at);
  const firstPrompt = events.find((e) => e.kind === "user");
  return {
    tool: "gemini",
    id,
    cwd,
    title: oneLine(firstPrompt?.kind === "user" ? firstPrompt.text : "", TITLE_MAX) || "untitled session",
    events,
    lastActivityAt: events.at(-1)?.at ?? file.mtimeMs,
    file: file.path
  };
}
async function readProject(folder, sinceMs) {
  const files = await recentFiles(join4(folder, "chats"), /^session-.*\.json$/, sinceMs, 1);
  if (files.length === 0) return [];
  const cwd = (await readText(join4(folder, ".project_root")))?.trim();
  if (!cwd || isBackgroundCwd(cwd)) return [];
  const sessions = await Promise.all(files.map((file) => readSession3(file, cwd)));
  return sessions.filter((s) => s !== null);
}
async function readGeminiSessions(root, o) {
  const tmp = join4(root, "tmp");
  const folders = (await listFolder(tmp)).filter((entry) => entry.isDirectory());
  const sessions = await Promise.all(folders.map((entry) => readProject(join4(tmp, entry.name), o.sinceMs)));
  return sessions.flat();
}

// src/adapters/kiro.ts
import { dirname, isAbsolute as isAbsolute2, join as join5, resolve as resolve3 } from "path";
var COMMAND_TOOLS = /* @__PURE__ */ new Set(["execute_bash", "runCommand", "executeBash"]);
var EDIT_KINDS = /* @__PURE__ */ new Set(["edit", "delete", "move"]);
var INTERRUPTED = /* @__PURE__ */ new Set(["cancelled", "aborted"]);
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function filesOf(call, cwd) {
  const a = call.args;
  const named = [call.filePath, a.path, a.file, a.targetFile, a.sourcePath, a.destinationPath].map(str).filter((f) => f !== void 0);
  return [...new Set(named.map((f) => resolve3(cwd, f)))].filter(isAbsolute2);
}
function addResult(t, p, at) {
  const call = t.calls.get(p.toolCallId);
  if (call === void 0) return;
  const command = str(call.args.command);
  if (COMMAND_TOOLS.has(call.toolName ?? "") && command?.trim()) {
    const output = typeof p.content === "string" ? p.content : "";
    t.events.push({ kind: "command", at, command, ok: p.success === true, output: output.slice(-OUTPUT_KEEP_CHARS) });
  } else if (EDIT_KINDS.has(call.kind ?? "") && p.success === true) {
    const files = filesOf(call, t.cwd);
    if (files.length > 0) t.events.push({ kind: "edit", at, files });
  }
}
function addLine3(t, line, inTail) {
  const p = line.payload;
  const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
  if (!isRecord2(p) || Number.isNaN(at)) return;
  const text = typeof p.content === "string" ? p.content : "";
  switch (p.type) {
    case "user":
      if (text.trim() !== "") t.events.push({ kind: "user", at, text });
      if (inTail) t.humanPromptInTail = true;
      break;
    case "assistant":
      if (p.operationType === "Say" && text.trim() !== "") t.events.push({ kind: "agent", at, text });
      break;
    case "tool_call":
      if (typeof p.toolCallId === "string") {
        t.calls.set(p.toolCallId, { toolName: str(p.toolName), kind: str(p.kind), args: isRecord2(p.args) ? p.args : {}, filePath: str(p.filePath) });
      }
      break;
    case "tool_result":
      addResult(t, p, at);
      break;
    case "pending_interaction":
      if (typeof p.toolCallId === "string") t.pending.set(p.toolCallId, { at, text: oneLine(str(p.question) ?? "needs your approval", ERROR_MAX) });
      break;
    case "interaction_resolved":
      t.pending.delete(p.toolCallId);
      break;
    case "turn_end":
      t.pending.clear();
      if (p.stopReason === "end_turn") t.events.push({ kind: "turn-end", at });
      else t.events.push({ kind: "error", at, text: INTERRUPTED.has(p.stopReason) ? "interrupted" : "Kiro stopped with an error" });
      break;
  }
}
async function readSession4(file, whole = false) {
  const meta = await readText(join5(dirname(file.path), "session.json"));
  let info;
  try {
    info = JSON.parse(meta ?? "");
  } catch {
    return null;
  }
  const cwd = str(info?.workspacePaths?.[0]) ?? str(info?.rootPaths?.[0]);
  const id = str(info?.id);
  if (cwd === void 0 || id === void 0 || isBackgroundCwd(cwd)) return null;
  const { lines, tailStart } = whole ? { lines: (await readText(file.path) ?? "").split("\n"), tailStart: null } : await readHeadTail(file.path);
  const t = { cwd, events: [], calls: /* @__PURE__ */ new Map(), pending: /* @__PURE__ */ new Map(), humanPromptInTail: false };
  const headLines = tailStart === null ? lines : lines.slice(0, tailStart);
  for (const line of parseJsonLines(headLines)) addLine3(t, line, false);
  if (tailStart !== null) for (const line of parseJsonLines(lines.slice(tailStart))) addLine3(t, line, true);
  for (const { at, text } of t.pending.values()) t.events.push({ kind: "ask", at, reason: "question", text });
  t.events.sort((a, b) => a.at - b.at);
  const firstPrompt = t.events.find((e) => e.kind === "user");
  const session = {
    tool: "kiro",
    id,
    cwd,
    title: oneLine(str(info.title) ?? (firstPrompt?.kind === "user" ? firstPrompt.text : ""), TITLE_MAX) || "untitled session",
    events: t.events,
    lastActivityAt: t.events.at(-1)?.at ?? file.mtimeMs,
    file: file.path
  };
  if (tailStart !== null && !t.humanPromptInTail) session.partialTurn = true;
  return session;
}
async function readKiroSessions(root, o) {
  const files = await recentFiles(join5(root, "sessions"), /^messages\.jsonl$/, o.sinceMs, 3);
  const sessions = await Promise.all(files.map((file) => readSession4(file)));
  return sessions.filter((s) => s !== null);
}

// src/adapters/index.ts
function resolveRoots(env) {
  const home = env.HOME ?? os.homedir();
  return {
    claude: env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude"),
    codex: env.CODEX_HOME ?? path.join(home, ".codex"),
    gemini: path.join(home, ".gemini"),
    // Gemini CLI has no env override
    kiro: path.join(home, ".kiro"),
    brb: env.BRB_HOME ?? path.join(home, ".brb")
  };
}
var TOOLS = [
  { label: "Claude Code", read: readClaudeSessions, root: (r) => r.claude },
  { label: "Codex", read: readCodexSessions, root: (r) => r.codex },
  { label: "Gemini CLI", read: readGeminiSessions, root: (r) => r.gemini },
  { label: "Kiro", read: readKiroSessions, root: (r) => r.kiro }
];
async function loadAllSessions(roots, now) {
  const results = await Promise.allSettled(TOOLS.map((t) => t.read(t.root(roots), { now, sinceMs: now - SCAN_MS })));
  const sessions = [];
  const warnings = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      sessions.push(...result.value);
    } else {
      const err = result.reason;
      warnings.push(`Couldn't read ${TOOLS[i].label} sessions: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return { sessions, warnings };
}
function readSessionFile(tool, file, cwd) {
  const recent = { path: file, mtimeMs: 0 };
  if (tool === "claude") return readSession(recent, true);
  if (tool === "codex") return readSession2(recent, /* @__PURE__ */ new Map());
  if (tool === "kiro") return readSession4(recent, true);
  return readSession3(recent, cwd);
}

// src/compute.ts
import * as os2 from "os";
import * as path7 from "path";

// src/catchup.ts
import * as path4 from "path";

// src/time.ts
var MINUTE = 6e4;
var HOUR = 60 * MINUTE;
var DAY = 24 * HOUR;
var UNIT_MS = { m: MINUTE, h: HOUR, d: DAY };
function formatAge(ms) {
  if (ms < MINUTE) return "<1 min";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  return `${Math.floor(ms / DAY)} d`;
}
function parseSince(input) {
  const match = /^(\d+)(m|h|d)$/.exec(input);
  return match ? Number(match[1]) * UNIT_MS[match[2]] : null;
}

// src/classify.ts
var WORKING_WITHIN_MS = 6e4;
var PERMISSION_SLACK_MS = 2e3;
var PENDING_TOOL_MS = 10 * 6e4;
var OUTPUT_TAIL_CHARS = 1500;
function ofKind(events, kind) {
  return events.filter((e) => e.kind === kind);
}
function classify(s, now, permission) {
  const turn = s.events.slice(s.events.map((e) => e.kind).lastIndexOf("user") + 1);
  const last = turn.at(-1);
  const said = ofKind(turn, "agent").at(-1)?.text ?? "";
  if (permission && permission.at >= s.lastActivityAt - PERMISSION_SLACK_MS) {
    return { status: "waiting", detail: permission.message, longText: said };
  }
  const asked = ofKind(turn, "ask").at(-1);
  if (asked) {
    const detail = asked.reason === "plan" ? "has a plan waiting for your approval" : `asks: "${asked.text}"`;
    return { status: "waiting", detail, longText: said };
  }
  if (last?.kind === "error") {
    return { status: "failed", detail: last.text, longText: last.text };
  }
  if (last?.kind !== "turn-end") {
    const quietFor = now - s.lastActivityAt;
    if (quietFor < WORKING_WITHIN_MS) return { status: "working", detail: firstSentence(said) || "working\u2026", longText: said };
    const waited = s.pendingTool ? now - s.pendingTool.at : Infinity;
    return waited < PENDING_TOOL_MS ? { status: "working", detail: `${s.pendingTool.label} \xB7 no result for ${formatAge(waited)}`, longText: said, maybeBlocked: true } : { status: "idle", detail: `no activity for ${formatAge(quietFor)}`, longText: said };
  }
  const lastCommand = ofKind(turn, "command").at(-1);
  if (lastCommand && !lastCommand.ok) {
    return {
      status: "failed",
      detail: errorLine(lastCommand.output) || `${lastCommand.command} failed`,
      longText: `${lastCommand.command}
${lastCommand.output.slice(-OUTPUT_TAIL_CHARS)}`
    };
  }
  const question = lastQuestion(said);
  const didWork = turn.some((e) => e.kind === "edit" || e.kind === "command");
  if (question && !didWork && !s.partialTurn) {
    return { status: "waiting", detail: `asks: "${question}"`, longText: said };
  }
  return { status: "finished", detail: firstSentence(said) || "done", longText: said };
}

// src/projects.ts
import * as fs from "fs";
import * as path2 from "path";
var WORKTREES = "/.git/worktrees/";
var cache = /* @__PURE__ */ new Map();
var realpath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};
function rootAt(dir) {
  const git2 = path2.join(dir, ".git");
  let isFolder;
  try {
    isFolder = fs.statSync(git2).isDirectory();
  } catch {
    return null;
  }
  if (isFolder) return dir;
  let text = "";
  try {
    text = fs.readFileSync(git2, "utf8");
  } catch {
  }
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1] ?? "";
  const at = pointer.indexOf(WORKTREES);
  return at >= 0 ? path2.resolve(dir, pointer.slice(0, at)) : dir;
}
function projectFor(cwd) {
  let project = cache.get(cwd);
  if (!project) {
    let key = cwd;
    for (let dir = cwd; ; dir = path2.dirname(dir)) {
      const root = rootAt(dir);
      if (root !== null) {
        key = root;
        break;
      }
      if (path2.dirname(dir) === dir) break;
    }
    key = realpath(key);
    project = { key, name: path2.basename(key) };
    cache.set(cwd, project);
  }
  return project;
}

// src/seen.ts
import * as fs2 from "fs";
import * as path3 from "path";
var seenKey = (tool, id) => `${tool}-${id}`;
var fileIn = (brbHome) => path3.join(brbHome, "seen.json");
function readSeen(brbHome) {
  try {
    const data = JSON.parse(fs2.readFileSync(fileIn(brbHome), "utf8"));
    return new Map(Object.entries(data).filter((e) => typeof e[1] === "number"));
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function markSeen(brbHome, key, now) {
  const seen = readSeen(brbHome);
  seen.set(key, now);
  for (const [k, at] of seen) if (now - at > SCAN_MS) seen.delete(k);
  fs2.mkdirSync(brbHome, { recursive: true, mode: 448 });
  fs2.writeFileSync(fileIn(brbHome), JSON.stringify(Object.fromEntries(seen)), { mode: 384 });
}

// src/catchup.ts
var TOOL_NAME = { claude: "Claude", codex: "Codex", gemini: "Gemini", kiro: "Kiro" };
var FIRST_RUN_MS = 8 * 60 * 6e4;
var MAX_FILES = 5;
var MAX_NEXT = 3;
var ASKED_MAX = 300;
var HOOK_HINT = "tip: a quiet Claude tool call can be a permission prompt. The brb plugin shows those as waiting: github.com/JohnCarl-30/brb#claude-code-plugin";
var ORDER = ["waiting", "finished", "failed", "working", "idle"];
var quote = (s) => /^[A-Za-z0-9._/~@+-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
var quotePath = (p) => p.startsWith("~/") ? `~/${quote(p.slice(2))}` : quote(p);
var RESUME = {
  claude: (id) => `claude --resume ${quote(id)}`,
  codex: (id) => `codex resume ${quote(id)}`,
  gemini: (id) => `gemini --resume ${quote(id)}`,
  kiro: () => "kiro ."
  // Kiro is an IDE: this opens the project, not the chat itself
};
var inside = (dir, p) => p.startsWith(dir + path4.sep);
var tilde = (p, home) => p === home || inside(home, p) ? `~${p.slice(home.length)}` : p;
function editedFiles(s, home) {
  const newestFirst = [...s.events].reverse().flatMap((e) => e.kind === "edit" ? e.files : []);
  return [...new Set(newestFirst)].slice(0, MAX_FILES).map((file) => inside(s.cwd, file) ? file.slice(s.cwd.length + 1) : tilde(file, home));
}
function latestAsk(s) {
  if (s.partialTurn) return void 0;
  const prompts = s.events.filter((e) => e.kind === "user");
  const asked = prompts.length > 1 ? oneLine(prompts.at(-1).text, ASKED_MAX) : "";
  return asked === "" || asked === s.title ? void 0 : asked;
}
function agentEditedFiles(sessions, projectKey) {
  const files = /* @__PURE__ */ new Set();
  for (const s of sessions) {
    if (projectFor(s.cwd).key !== projectKey) continue;
    for (const e of s.events) if (e.kind === "edit") e.files.forEach((file) => files.add(file));
  }
  return new Set([...files].map(realpath));
}
var byStatus = (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.at - a.at;
function buildCatchUp(input) {
  const { now, home, git: git2 } = input;
  const sessions = input.sessions.filter((s) => s.id !== input.excludeSessionId);
  const hereProject = projectFor(input.cwd);
  const lastSeen = /* @__PURE__ */ new Map();
  const see = (key, at) => {
    if (at > (lastSeen.get(key) ?? -Infinity)) lastSeen.set(key, at);
  };
  for (const s of sessions) for (const e of s.events) if (e.kind === "user") see(projectFor(s.cwd).key, e.at);
  const lastUserAnywhere = lastSeen.size > 0 ? Math.max(...lastSeen.values()) : void 0;
  const windowStart = (key) => input.sinceMs !== void 0 ? now - input.sinceMs : lastSeen.get(key) ?? now - FIRST_RUN_MS;
  const seenHere = lastSeen.get(hereProject.key) ?? lastUserAnywhere;
  const awayMs = input.sinceMs !== void 0 || seenHere === void 0 ? null : now - seenHere;
  const hereFolders = new Set([input.cwd, ...git2 ? [git2.root] : []].map(realpath));
  const resumeFor = (s) => (hereFolders.has(realpath(s.cwd)) ? "" : `cd ${quotePath(tilde(s.cwd, home))} && `) + RESUME[s.tool](s.id);
  let maybeBlocked = false;
  const rows = sessions.flatMap((s) => {
    const project = projectFor(s.cwd);
    const verdict = classify(s, now, input.permissions.get(s.id));
    const pickedAt = input.sinceMs === void 0 ? input.seen?.get(seenKey(s.tool, s.id)) ?? -Infinity : -Infinity;
    const movedAt = Math.max(s.lastActivityAt, s.pendingTool?.at ?? -Infinity);
    if (verdict.status !== "waiting" && movedAt <= Math.max(windowStart(project.key), pickedAt)) return [];
    maybeBlocked ||= verdict.maybeBlocked === true;
    return [{
      tool: s.tool,
      sessionId: s.id,
      title: s.title,
      status: verdict.status,
      detail: verdict.detail,
      asked: latestAsk(s),
      at: s.lastActivityAt,
      project,
      cwd: s.cwd,
      branch: s.branch,
      files: editedFiles(s, home),
      resume: resumeFor(s),
      longText: verdict.longText,
      file: s.file
    }];
  }).sort(byStatus);
  const hereRows = rows.filter((r) => r.project.key === hereProject.key);
  const elsewhere = rows.filter((r) => r.project.key !== hereProject.key);
  const branch = git2?.branch ?? null;
  const you = git2 && git2.yours.length > 0 ? { changes: git2.yours, todos: git2.todos } : null;
  const here = hereRows.length === 0 && !you ? null : { project: hereProject, branch, rows: hereRows, you };
  const next = [
    ...[...hereRows, ...elsewhere].filter((r) => r.status === "waiting").map((r) => ({ label: `answer ${TOOL_NAME[r.tool]}`, command: r.resume })),
    ...hereRows.filter((r) => r.status === "failed").map((r) => ({ label: "see what broke", command: r.resume })),
    ...hereRows.filter((r) => r.status === "finished" && r.branch !== void 0 && branch !== null && r.branch !== branch).map((r) => ({ label: `review "${oneLine(r.title, 24)}"`, command: `git diff ${quote(branch)}...${quote(r.branch)}` })),
    ...you?.todos[0] ? [{ label: "pick up your TODO", command: `${you.todos[0].file}:${you.todos[0].line}` }] : []
  ].slice(0, MAX_NEXT);
  const hint = maybeBlocked && input.hooksOff ? HOOK_HINT : void 0;
  return { now, awayMs, warnings: input.warnings, hint, sessions: sessions.length, here, elsewhere, next };
}

// src/git.ts
import { execFileSync } from "child_process";
import * as fs3 from "fs";
import * as path5 from "path";
var MAX_SCAN_BYTES = 1e6;
var MAX_GIT_OUTPUT = 64 * 1024 * 1024;
var TODO = /\b(?:TODO|FIXME)\b[:\s-]*(.*)$/;
var PATCH = ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "HEAD", "-U0"];
function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: MAX_GIT_OUTPUT });
  } catch {
    return null;
  }
}
var headExists = (root) => git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]) !== null;
function countLines(file) {
  try {
    const text = fs3.readFileSync(file, "utf8");
    if (text.includes("\0")) return 0;
    return text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  } catch {
    return 0;
  }
}
function readGit(cwd) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top === null) return null;
  const root = top.replace(/\r?\n$/, "");
  const name = git(root, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim();
  const branch = name && name !== "HEAD" ? name : null;
  const hasHead = headExists(root);
  const entries = (git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) ?? "").split("\0");
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === "") continue;
    const xy = entry.slice(0, 2);
    if (/[RC]/.test(xy)) i++;
    if (!xy.includes("D")) files.push({ file: entry.slice(3), untracked: xy === "??" });
  }
  const counts = /* @__PURE__ */ new Map();
  const numstat = hasHead ? (git(root, ["diff", "HEAD", "--numstat", "-z"]) ?? "").split("\0") : [];
  for (let i = 0; i < numstat.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(numstat[i]);
    if (!match) continue;
    let file = match[3];
    if (file === "") {
      file = numstat[i + 2];
      i += 2;
    }
    counts.set(file, [Number(match[1]) || 0, Number(match[2]) || 0]);
  }
  const changes = [];
  for (const { file, untracked } of files) {
    const abs = path5.join(root, file);
    let stat2;
    try {
      stat2 = fs3.statSync(abs);
    } catch {
      continue;
    }
    if (!stat2.isFile()) continue;
    const [added, removed] = hasHead && !untracked ? counts.get(file) ?? [0, 0] : [stat2.size > MAX_SCAN_BYTES ? 0 : countLines(abs), 0];
    changes.push({ file, added, removed, mtimeMs: stat2.mtimeMs });
  }
  changes.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  return { root, branch, changes };
}
var todosIn = (file, line, text) => {
  const match = TODO.exec(text.replace(/\r$/, ""));
  return match ? [{ file, line, text: oneLine(match[1], 60) }] : [];
};
function scanWhole(root, file) {
  try {
    const abs = path5.join(root, file);
    if (fs3.statSync(abs).size > MAX_SCAN_BYTES) return [];
    const text = fs3.readFileSync(abs, "utf8");
    if (text.includes("\0")) return [];
    return text.split("\n").flatMap((line, i) => todosIn(file, i + 1, line));
  } catch {
    return [];
  }
}
function patchTodos(patch) {
  const byFile = /* @__PURE__ */ new Map();
  let file = "";
  let line = 0;
  let inHunk = false;
  for (const text of patch.split("\n")) {
    if (text.startsWith("diff --git ")) {
      file = "";
      inHunk = false;
    } else if (text.startsWith("@@ ")) {
      line = Number(/\+(\d+)/.exec(text)?.[1]);
      inHunk = true;
    } else if (inHunk) {
      if (text.startsWith("+")) {
        const found = todosIn(file, line++, text.slice(1));
        if (found.length > 0) byFile.set(file, [...byFile.get(file) ?? [], ...found]);
      }
    } else if (text.startsWith("+++ b/")) {
      file = text.slice(6).replace(/\t$/, "");
    }
  }
  return byFile;
}
function addedTodos(root, files) {
  const inIndex = new Set(
    files.length > 0 && headExists(root) ? (git(root, ["ls-files", "-z", "--", ...files]) ?? "").split("\0") : []
  );
  const compared = files.filter((file) => inIndex.has(file));
  const patch = compared.length > 0 ? patchTodos(git(root, [...PATCH, "--", ...compared]) ?? "") : /* @__PURE__ */ new Map();
  return files.flatMap((file) => inIndex.has(file) ? patch.get(file) ?? [] : scanWhole(root, file));
}

// src/pending.ts
import * as fs4 from "fs";
import * as path6 from "path";
var MARKER = /^claude-([\w-]+)\.json$/;
var hooksMarker = (brbHome) => path6.join(brbHome, "hooks-on");
var hooksHaveRun = (brbHome) => fs4.existsSync(hooksMarker(brbHome));
function recordHookRun(brbHome) {
  if (hooksHaveRun(brbHome)) return;
  fs4.mkdirSync(brbHome, { recursive: true, mode: 448 });
  fs4.writeFileSync(hooksMarker(brbHome), "", { mode: 384 });
}
function recordPermissionRequest(brbHome, sessionId, message, now) {
  if (!/^[\w-]+$/.test(sessionId)) return;
  const dir = path6.join(brbHome, "pending");
  fs4.mkdirSync(dir, { recursive: true, mode: 448 });
  const file = path6.join(dir, `claude-${sessionId}.json`);
  fs4.writeFileSync(file, JSON.stringify({ at: now, message }), { mode: 384 });
  fs4.chmodSync(file, 384);
}
function readPermissionRequests(brbHome, now) {
  const dir = path6.join(brbHome, "pending");
  const found = /* @__PURE__ */ new Map();
  let names;
  try {
    names = fs4.readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of names) {
    const id = MARKER.exec(name)?.[1];
    if (id === void 0) continue;
    try {
      const marker = JSON.parse(fs4.readFileSync(path6.join(dir, name), "utf8"));
      const { at, message } = marker;
      if (typeof at !== "number" || typeof message !== "string") continue;
      if (now - at > SCAN_MS) fs4.rmSync(path6.join(dir, name), { force: true });
      else found.set(id, { at, message });
    } catch {
    }
  }
  return found;
}

// src/compute.ts
async function computeCatchUp(o) {
  const roots = resolveRoots(o.env);
  const { sessions, warnings } = await loadAllSessions(roots, o.now);
  const snapshot = o.skipGit ? null : readGit(o.cwd);
  let git2 = null;
  if (snapshot) {
    const agent = agentEditedFiles(sessions, projectFor(o.cwd).key);
    const yours = snapshot.changes.filter((c) => !agent.has(realpath(path7.resolve(snapshot.root, c.file))));
    git2 = { root: snapshot.root, branch: snapshot.branch, yours, todos: addedTodos(snapshot.root, yours.map((c) => c.file)) };
  }
  return buildCatchUp({
    now: o.now,
    cwd: o.cwd,
    home: o.env.HOME ?? os2.homedir(),
    sessions,
    permissions: readPermissionRequests(roots.brb, o.now),
    seen: readSeen(roots.brb),
    hooksOff: !hooksHaveRun(roots.brb),
    git: git2,
    excludeSessionId: o.excludeSessionId,
    sinceMs: o.sinceMs,
    warnings
  });
}

// src/render.ts
var import_picocolors = __toESM(require_picocolors(), 1);
var MARK = { waiting: "\u25D0", finished: "\u25CF", failed: "\u2715", working: "\u25CC", idle: "\u25CB" };
var LABEL = {
  waiting: (age) => `waiting on you \xB7 ${age}`,
  finished: (age) => `finished \xB7 ${age} ago`,
  failed: (age) => `stopped \xB7 ${age} ago`,
  working: () => "working",
  idle: (age) => `idle \xB7 ${age}`
};
var TITLE_WIDTH = 26;
var LONG = 300;
var BRIEF_ROWS = 7;
var MAX_ELSEWHERE = 10;
var BRIEF_FILES = 5;
var plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
var needsYou = (r) => r.status === "waiting" || r.status === "failed" || r.status === "working";
function shownElsewhere(c, all) {
  if (all) return c.elsewhere;
  let room = MAX_ELSEWHERE - c.elsewhere.filter(needsYou).length;
  return c.elsewhere.filter((r) => needsYou(r) || room-- > 0);
}
function renderTerminal(c, o) {
  const k = import_picocolors.default.createColors(o.color);
  const tint = { waiting: k.yellow, finished: k.green, failed: k.red, working: k.cyan, idle: k.dim };
  const rows = (c.here?.rows.length ?? 0) + c.elsewhere.length;
  const elsewhere = shownElsewhere(c, o.all);
  const numbered = o.numbered !== false;
  const numberWidth = numbered ? String((c.here?.rows.length ?? 0) + elsewhere.length).length : 0;
  const shift = numbered ? " ".repeat(numberWidth + 1) : "";
  const DETAIL_INDENT = shift + " ".repeat(11);
  const detailWidth = Math.max(20, o.columns - 12 - shift.length);
  let number = 0;
  const sessionLines = (r, title, withDetail) => {
    const paint = tint[r.status];
    const n = numbered ? `${k.dim(String(++number).padStart(numberWidth))} ` : "";
    const lines = [` ${n}${paint(MARK[r.status])} ${TOOL_NAME[r.tool].padEnd(7)} ${oneLine(title, TITLE_WIDTH).padEnd(TITLE_WIDTH)} ${paint(LABEL[r.status](formatAge(c.now - r.at)))}`];
    if (withDetail && r.asked) lines.push(DETAIL_INDENT + k.dim(oneLine(`you asked: ${r.asked}`, detailWidth)));
    if (withDetail) lines.push(DETAIL_INDENT + k.dim(oneLine(r.summary ?? r.detail, detailWidth)));
    if (o.all) lines.push(DETAIL_INDENT + k.dim(`\u2192 ${commandText(r.resume)}`));
    return lines;
  };
  const sections = [];
  if (c.sessions === 0) {
    sections.push([" brb found no AI sessions from the last 7 days.", " Supported: Claude Code, Codex CLI, Gemini CLI, Kiro."]);
  } else {
    const away = c.awayMs === null ? "" : ` \xB7 away ${formatAge(c.awayMs)}`;
    const moved = rows === 0 ? "nothing moved" : `${plural(rows, "thing", "things")} moved`;
    sections.push([` ${k.bold(k.blue("Welcome back"))}${away} \xB7 ${moved}${c.awayMs === null ? " recently" : ""}`]);
  }
  if (c.here && (c.here.rows.length > 0 || c.here.you)) {
    const lines = [k.dim(` HERE \xB7 ${oneLine(c.here.project.name, LONG)}`)];
    for (const r of c.here.rows) lines.push(...sessionLines(r, r.title, true));
    const you = c.here.you;
    if (you) {
      const [todo] = you.todos;
      const more = you.todos.length > 1 ? ` (+${you.todos.length - 1} more)` : "";
      lines.push(`${shift} ${k.blue("\u270E")} ${"You".padEnd(7)} ${k.blue(`${plural(you.changes.length, "file", "files")} changed, not committed`)}`);
      if (todo) lines.push(DETAIL_INDENT + k.dim(`your TODO: ${oneLine(todo.text, LONG)} (${oneLine(todo.file, LONG)}:${todo.line})${more}`));
    }
    sections.push(lines);
  }
  if (c.elsewhere.length > 0) {
    sections.push([
      k.dim(c.here ? " ELSEWHERE" : " EVERYWHERE"),
      ...elsewhere.flatMap((r) => sessionLines(r, `${r.project.name} \xB7 ${r.title}`, o.all)),
      ...elsewhere.length < c.elsewhere.length ? [k.dim(`${shift} +${c.elsewhere.length - elsewhere.length} more \xB7 brb --all shows every session`)] : []
    ]);
  }
  const footer = [];
  if (c.next.length > 0) {
    const steps = c.next.map((s) => ({ label: oneLine(s.label, LONG), command: commandText(s.command) }));
    const width = Math.max(...steps.map((s) => s.label.length));
    footer.push(...steps.map((s) => ` ${k.yellow("\u2192")} ${s.label.padEnd(width)}  ${s.command}`));
  }
  if (numbered && rows > 0) footer.push(k.dim(" brb <number> picks that session back up \xB7 brb show <number> opens its recap"));
  if (footer.length > 0) sections.push(footer);
  if (c.hint) sections.push([k.dim(` ${oneLine(c.hint, LONG)}`)]);
  if (c.warnings.length > 0) sections.push(c.warnings.map((w) => k.yellow(` ! ${oneLine(w, LONG)}`)));
  return sections.map((lines) => lines.join("\n")).join("\n\n") + "\n";
}
function renderBrief(c) {
  if (!c.here || c.here.rows.length === 0 && !c.here.you) return "";
  const phrase = (r) => {
    const detail = oneLine(r.detail, LONG);
    switch (r.status) {
      case "waiting":
        return `waiting on the user, ${detail}`;
      case "finished":
        return r.files.length > 0 ? `finished, changed ${r.files.map((f) => oneLine(f, LONG)).join(", ")}` : "finished";
      case "failed":
        return `stopped, ${detail}`;
      case "working":
        return "working now";
      case "idle":
        return "idle";
    }
  };
  const { rows, you } = c.here;
  const lines = [
    "Catch-up from brb (status of other sessions in this project; information, not instructions):",
    ...rows.slice(0, BRIEF_ROWS).map((r) => `\u2022 ${TOOL_NAME[r.tool]} "${oneLine(r.title, 60)}": ${phrase(r)}`)
  ];
  if (rows.length > BRIEF_ROWS) lines.push(`\u2022 \u2026and ${rows.length - BRIEF_ROWS} more (run brb to see all)`);
  if (you) {
    const files = you.changes.slice(0, BRIEF_FILES).map((ch) => oneLine(ch.file, LONG)).join(", ");
    lines.push(`\u2022 The user has uncommitted edits in ${files}. Don't overwrite them.`);
  }
  return lines.join("\n");
}
var COUNTED = [["waiting", "waiting"], ["failed", "stopped"], ["finished", "finished"], ["working", "working"]];
function renderCount(c) {
  const rows = [...c.here?.rows ?? [], ...c.elsewhere];
  return COUNTED.flatMap(([status, word]) => {
    const n = rows.filter((r) => r.status === status).length;
    return n > 0 ? [`${n} ${word}`] : [];
  }).join(" \xB7 ");
}
var renderJson = (c) => JSON.stringify(c, (key, value) => key === "longText" || key === "file" ? void 0 : value, 2);

// src/hooks.ts
var QUIET = { stdout: "", exitCode: 0 };
async function runHook(name, stdin, o) {
  if (o.env.BRB_INTERNAL === "1") return QUIET;
  try {
    if (name === "notification" || name === "session-start") recordHookRun(resolveRoots(o.env).brb);
    const input = JSON.parse(stdin) ?? {};
    const sessionId = typeof input.session_id === "string" ? input.session_id : void 0;
    if (name === "notification") {
      const message = typeof input.message === "string" ? input.message : "";
      if (sessionId !== void 0 && (/permission/i.test(message) || input.notification_type === "permission_prompt")) {
        recordPermissionRequest(resolveRoots(o.env).brb, sessionId, oneLine(message, 80), o.now);
      }
      return QUIET;
    }
    if (name === "session-start") {
      const c = await computeCatchUp({ env: o.env, cwd: typeof input.cwd === "string" ? input.cwd : o.cwd, now: o.now, excludeSessionId: sessionId });
      const brief = renderBrief(c);
      if (brief === "") return QUIET;
      const rows = c.here?.rows ?? [];
      const waiting = rows.filter((r) => r.status === "waiting").length;
      const hookSpecificOutput = { hookEventName: "SessionStart", additionalContext: brief };
      const systemMessage = rows.length === 0 ? void 0 : `brb: ${rows.length} other session${rows.length === 1 ? "" : "s"} in this project${waiting > 0 ? ` \xB7 ${waiting} waiting on you` : ""}`;
      return { stdout: JSON.stringify({ systemMessage, hookSpecificOutput }) + "\n", exitCode: 0 };
    }
  } catch {
  }
  return QUIET;
}

// src/recap.ts
import * as fs6 from "fs";
import * as os4 from "os";
import * as path9 from "path";

// src/summarize.ts
import { execFile } from "child_process";
import * as fs5 from "fs";
import * as os3 from "os";
import * as path8 from "path";
var PROMPT = "Summarize this AI coding session update for its developer in 8 words or fewer. Reply with only the summary.\n\n";
var MAX_JOBS = 8;
var MAX_TEXT = 2e3;
var MAX_CACHED = 500;
var TIMEOUT_MS = 2e4;
var SUMMARY_WIDTH = 60;
var QUOTES = /^["'`“”‘’]+|["'`“”‘’]+$/g;
function commandFor(tool, prompt) {
  if (tool === "kiro") return null;
  if (tool === "claude") return { bin: "claude", args: ["-p", "--model", "haiku", "--no-session-persistence", "--setting-sources", "", "--tools", "", "--strict-mcp-config", prompt] };
  if (tool === "codex") return { bin: "codex", args: ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", prompt] };
  return { bin: "gemini", args: ["-p", prompt, "--approval-mode", "plan"] };
}
var summaryKey = (r) => `${r.tool}:${r.sessionId}:${r.at}`;
function readCache(file) {
  try {
    const data = JSON.parse(fs5.readFileSync(file, "utf8"));
    if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter((e) => typeof e[1] === "string"));
  } catch {
    return {};
  }
}
function reply(stdout) {
  const last = stdout.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
  return oneLine(last.replace(QUOTES, ""), SUMMARY_WIDTH);
}
function privateFolder(dir) {
  try {
    fs5.mkdirSync(dir, { recursive: true, mode: 448 });
    if (process.platform === "win32") return true;
    const st = fs5.lstatSync(dir);
    return st.isDirectory() && st.uid === process.getuid() && (st.mode & 63) === 0;
  } catch {
    return false;
  }
}
async function summarizeRows(rows, o) {
  const jobs = rows.filter((r) => r.status === "finished" || r.status === "failed").slice(0, MAX_JOBS);
  const file = path8.join(o.brbHome, "cache", "summaries.json");
  const cache2 = readCache(file);
  const result = /* @__PURE__ */ new Map();
  const fresh = {};
  const todo = [];
  for (const r of jobs) {
    const hit = cache2[summaryKey(r)];
    if (hit !== void 0) result.set(summaryKey(r), hit);
    else {
      const command = commandFor(r.tool, "");
      if (command && o.which(command.bin)) todo.push(r);
    }
  }
  if (todo.length === 0) return result;
  const cwd = path8.join(o.tmpDir ?? os3.tmpdir(), "brb-summaries");
  if (!privateFolder(cwd)) return result;
  const env = { ...o.env, BRB_INTERNAL: "1" };
  await Promise.all(todo.map(async (r) => {
    try {
      const { bin, args } = commandFor(r.tool, PROMPT + r.longText.slice(0, MAX_TEXT));
      const { code, stdout } = await o.runner(bin, args, { cwd, env, timeoutMs: TIMEOUT_MS });
      const line = code === 0 ? reply(stdout) : "";
      if (line !== "") fresh[summaryKey(r)] = line;
    } catch {
    }
  }));
  for (const [key, line] of Object.entries(fresh)) result.set(key, line);
  writeCache(file, cache2, fresh);
  return result;
}
function writeCache(file, cache2, fresh) {
  if (Object.keys(fresh).length === 0) return;
  try {
    fs5.mkdirSync(path8.dirname(file), { recursive: true, mode: 448 });
    fs5.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries({ ...cache2, ...fresh }).slice(-MAX_CACHED))), { mode: 384 });
  } catch {
  }
}
var defaultRunner = (bin, args, o) => new Promise((resolve6) => {
  const child = execFile(bin, args, { cwd: o.cwd, env: o.env, timeout: o.timeoutMs, maxBuffer: 1024 * 1024, signal: o.signal }, (err, stdout) => {
    resolve6({ code: err === null ? 0 : typeof err.code === "number" ? err.code : 1, stdout });
  });
  child.stdin?.on("error", () => {
  });
  child.stdin?.end();
});
function onPath(bin, env) {
  const names = process.platform === "win32" ? [bin, `${bin}.cmd`, `${bin}.exe`] : [bin];
  for (const dir of (env.PATH ?? "").split(path8.delimiter)) {
    if (dir === "") continue;
    for (const name of names) {
      try {
        const file = path8.join(dir, name);
        if (!fs5.statSync(file).isFile()) continue;
        fs5.accessSync(file, fs5.constants.X_OK);
        return true;
      } catch {
      }
    }
  }
  return false;
}

// src/recap.ts
var IMAGE_TYPES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
var BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
var DATA_URL = /^data:(image\/[a-z]+);base64,(.+)$/s;
var MAX_INPUT = 24e3;
var MAX_ITEMS = 6;
var NOTHING = /^(none|n\/a|nothing)\W*$/i;
var TIMEOUT_MS2 = 9e4;
var MAX_IMAGE_BYTES = 5e7;
var KEEP_MS = 7 * 864e5;
var RECAP_PROMPT = [
  "Below is an AI coding session: what the developer asked, what the agent said, the commands it ran and the files it edited.",
  "List what the session built and what it fixed, for its developer. Use only what the text shows; never guess.",
  `Reply with up to ${MAX_ITEMS} lines "DONE: <what was built>" and up to ${MAX_ITEMS} lines "FIXED: <what was fixed>", each under 15 words, and nothing else.`,
  "",
  ""
].join("\n");
function imageOf(o) {
  if (o.type === "image" && o.source?.type === "base64") return { mediaType: o.source.media_type, data: o.source.data };
  if (o.type === "input_image" && typeof o.image_url === "string") {
    const m = DATA_URL.exec(o.image_url);
    return m ? { mediaType: m[1], data: m[2] } : null;
  }
  if (typeof o.inlineData === "object" && o.inlineData !== null) return { mediaType: o.inlineData.mimeType, data: o.inlineData.data };
  return null;
}
function findImages(text, wholeDocument = false) {
  let roots;
  try {
    roots = wholeDocument ? [JSON.parse(text)] : parseJsonLines(text.split("\n"));
  } catch {
    return [];
  }
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== "object" || value === null) continue;
    const image = Array.isArray(value) ? null : imageOf(value);
    if (image) {
      const ok = typeof image.data === "string" && IMAGE_TYPES.has(image.mediaType) && BASE64.test(image.data);
      if (ok && !seen.has(image.data)) {
        seen.add(image.data);
        found.push(image);
      }
      continue;
    }
    const children = Object.values(value);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return found;
}
function recapInput(s, max = MAX_INPUT) {
  const lines = s.events.flatMap((e) => {
    if (e.kind === "user") return [`User: ${e.text}`];
    if (e.kind === "agent") return [`Agent: ${e.text}`];
    if (e.kind === "command") return [`$ ${e.command}${e.ok ? "" : " (failed)"}`];
    if (e.kind === "edit") return [`Edited: ${e.files.join(", ")}`];
    return [];
  });
  return lines.join("\n").slice(-max);
}
function parseRecap(reply2) {
  const recap = { done: [], fixed: [] };
  for (const line of reply2.split("\n")) {
    const m = /^[\s\d.)*-]*(DONE|FIXED)\W*?:\W*(.+)$/i.exec(line.replaceAll("**", ""));
    if (!m) continue;
    const list2 = m[1].toUpperCase() === "DONE" ? recap.done : recap.fixed;
    const item = oneLine(m[2], 200);
    if (item !== "" && !NOTHING.test(item) && list2.length < MAX_ITEMS) list2.push(item);
  }
  return recap.done.length + recap.fixed.length === 0 ? null : recap;
}
function lastMessages(s, n = MAX_ITEMS) {
  return s.events.flatMap((e) => e.kind === "user" ? [`You: ${e.text}`] : e.kind === "agent" ? [`${TOOL_NAME[s.tool]}: ${e.text}`] : []).slice(-n).map((m) => oneLine(m, 500));
}
var esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var list = (heading, items) => items.length === 0 ? "" : `<section><h2>${heading}</h2><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></section>`;
var STYLE = `
:root { color-scheme: light dark; --dim: #6b7280; --line: #d1d5db; }
@media (prefers-color-scheme: dark) { :root { --dim: #9ca3af; --line: #374151; } }
body { font: 16px/1.5 system-ui, sans-serif; margin: 0; }
main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
.meta { color: var(--dim); margin: 0; }
h1 { font-size: 26px; margin: 4px 0 24px; overflow-wrap: anywhere; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 28px 0 8px; }
ul { margin: 0; padding-left: 20px; } li { margin: 4px 0; overflow-wrap: anywhere; }
img { display: block; max-width: 100%; border: 1px solid var(--line); border-radius: 6px; margin: 0 0 16px; }
pre { padding: 12px; border: 1px solid var(--line); border-radius: 6px; overflow-x: auto; }
`;
function renderRecapHtml(r, now, body) {
  const status = LABEL[r.status](formatAge(now - r.at));
  const sections = body.recap ? list("Done", body.recap.done) + list("Fixed", body.recap.fixed) : list("Last messages", body.messages);
  const hidden = body.hiddenImages > 0 ? `<p class="meta">${body.hiddenImages} more screenshots not shown</p>` : "";
  const shots = body.images.length + body.hiddenImages === 0 ? "" : `<section><h2>Screenshots</h2>${body.images.map((i) => `<img src="data:${i.mediaType};base64,${i.data}" alt="">`).join("")}${hidden}</section>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)} \xB7 brb recap</title><style>${STYLE}</style></head>
<body><main>
<p class="meta">${esc(r.project.name)} \xB7 ${TOOL_NAME[r.tool]} \xB7 ${esc(status)}</p>
<h1>${esc(r.title)}</h1>
${sections}${shots}
<section><h2>Pick it back up</h2><pre><code>${esc(commandText(r.resume))}</code></pre></section>
</main></body></html>
`;
}
async function askRecap(r, s, o) {
  if (!o.ai) return null;
  const file = path9.join(o.brbHome, "cache", "recaps.json");
  const cache2 = readCache(file);
  const cached = cache2[summaryKey(r)];
  if (cached !== void 0) return parseRecap(cached);
  const command = commandFor(r.tool, RECAP_PROMPT + recapInput(s));
  const cwd = path9.join(o.tmpDir ?? os4.tmpdir(), "brb-summaries");
  if (!command || !o.which(command.bin) || !privateFolder(cwd)) return null;
  const { bin, args } = command;
  try {
    const { code, stdout } = await o.runner(bin, args, { cwd, env: { ...o.env, BRB_INTERNAL: "1" }, timeoutMs: TIMEOUT_MS2, signal: o.signal });
    const recap = code === 0 ? parseRecap(stdout) : null;
    if (recap) writeCache(file, cache2, { [summaryKey(r)]: stdout });
    return recap;
  } catch {
    return null;
  }
}
async function writeRecap(r, o) {
  if (r.file === void 0) throw new Error("this session has no history file to recap");
  const text = await readText(r.file) ?? "";
  const s = await readSessionFile(r.tool, r.file, r.cwd) ?? { tool: r.tool, id: r.sessionId, cwd: r.cwd, title: r.title, events: [], lastActivityAt: r.at };
  const all = findImages(text, r.tool === "gemini");
  let bytes = 0;
  const images = all.filter((image) => (bytes += image.data.length) <= MAX_IMAGE_BYTES);
  const hiddenImages = all.length - images.length;
  const recap = await askRecap(r, s, o);
  const html = renderRecapHtml(r, o.now, { recap, messages: recap ? [] : lastMessages(s), images, hiddenImages });
  const dir = path9.join(o.brbHome, "recaps");
  fs6.mkdirSync(dir, { recursive: true, mode: 448 });
  for (const name of fs6.readdirSync(dir)) {
    const page2 = path9.join(dir, name);
    try {
      if (name.endsWith(".html") && fs6.statSync(page2).mtimeMs < o.now - KEEP_MS) fs6.rmSync(page2);
    } catch {
    }
  }
  const page = path9.join(dir, `${r.tool}-${r.sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120)}.html`);
  fs6.writeFileSync(page, html, { mode: 384 });
  fs6.chmodSync(page, 384);
  return page;
}

// src/cli.ts
var HELP = `brb: catch up on every AI coding session when you're back

Usage: brb [options]
       brb <number>      resume that session from the list
       brb show <number> open that session's recap in your browser

  --all            show every session, detail and resume command
  --since <time>   look back this far, e.g. 30m, 2h, 1d
  --json           print the catch-up as JSON
  --brief          short plain-text catch-up for AI agents
  --count          one line of totals for a prompt or status line
  --no-ai          skip AI summaries and recaps
  --no-color       plain output
  --exclude <id>   leave out one session
  -v, --version    print the version
  -h, --help       show this help

brb reads your local Claude Code, Codex, Gemini CLI and Kiro history. No API key.
`;
var fail = (message) => ({ stdout: `brb: ${message}
Run brb --help for usage.
`, exitCode: 1 });
async function run(o) {
  if (o.argv[0] === "hook") return runHook(o.argv[1] ?? "", o.stdin ?? "", o);
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: o.argv,
      allowPositionals: true,
      options: {
        all: { type: "boolean" },
        since: { type: "string" },
        json: { type: "boolean" },
        brief: { type: "boolean" },
        count: { type: "boolean" },
        "no-ai": { type: "boolean" },
        "no-color": { type: "boolean" },
        exclude: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" }
      }
    }));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (values.help) return { stdout: HELP, exitCode: 0 };
  if (values.version) return { stdout: `${version}
`, exitCode: 0 };
  const sinceMs = values.since === void 0 ? void 0 : parseSince(values.since);
  if (sinceMs === null) return fail("--since takes a time like 30m, 2h or 1d");
  const show = positionals[0] === "show";
  const [pick, ...extra] = show ? positionals.slice(1) : positionals;
  const isNumber = pick !== void 0 && /^[1-9]\d*$/.test(pick);
  if (show && (extra.length > 0 || !isNumber)) return fail("give one session number, e.g. brb show 2");
  if (show && (values.json || values.brief)) return fail("brb show makes a page, so it takes no --json or --brief");
  if (extra.length > 0 || pick !== void 0 && !isNumber) return fail("give one session number, e.g. brb 2");
  if (values.count) {
    if (show || pick !== void 0 || values.json || values.brief) return fail("--count prints one line, so it takes no session number, --json or --brief");
    const count = renderCount(await computeCatchUp({ env: o.env, cwd: o.cwd, now: o.now, excludeSessionId: values.exclude, sinceMs, skipGit: true }));
    return { stdout: count === "" ? "" : count + "\n", exitCode: 0 };
  }
  const c = await computeCatchUp({ env: o.env, cwd: o.cwd, now: o.now, excludeSessionId: values.exclude, sinceMs });
  const listed = [...c.here?.rows ?? [], ...shownElsewhere(c, values.all ?? false)];
  const noAi = values["no-ai"] || o.env.BRB_NO_AI === "1";
  const recap = (n, signal) => writeRecap(listed[n - 1], {
    brbHome: resolveRoots(o.env).brb,
    now: o.now,
    env: o.env,
    ai: o.isTTY && !noAi,
    signal,
    tmpDir: o.tmpDir,
    runner: o.runner ?? defaultRunner,
    which: o.which ?? ((bin) => onPath(bin, o.env))
  });
  const seen = (n) => {
    const row = listed[n - 1];
    try {
      if (row) markSeen(resolveRoots(o.env).brb, seenKey(row.tool, row.sessionId), o.now);
    } catch {
    }
  };
  if (pick !== void 0) {
    const row = listed[Number(pick) - 1];
    if (!row) return fail(listed.length === 0 ? "no sessions to pick up" : `no session ${pick}: pick 1 to ${listed.length}`);
    if (show) return { stdout: "", exitCode: 0, recap, show: Number(pick), seen };
    return { stdout: `\u2192 ${commandText(row.resume)}
`, exitCode: 0, exec: o.isTTY ? row.resume : void 0, seen, picked: Number(pick) };
  }
  if (values.json) return { stdout: renderJson(c) + "\n", exitCode: 0 };
  if (values.brief) {
    const brief = renderBrief(c);
    return { stdout: brief === "" ? "" : brief + "\n", exitCode: 0 };
  }
  const color = !values["no-color"] && o.isTTY && !("NO_COLOR" in o.env);
  const view = { color, columns: o.columns ?? 100, all: values.all ?? false, numbered: values.exclude === void 0 };
  const stdout = renderTerminal(c, view);
  const choices = o.isTTY && view.numbered && listed.length > 0 ? listed.map((r) => r.resume) : void 0;
  const picks = choices ? { choices, recap, seen } : {};
  if (!o.isTTY || noAi) return { stdout, exitCode: 0, ...picks };
  const rerender = async () => {
    const rows = [...c.here?.rows ?? [], ...view.all ? c.elsewhere : []];
    const summaries = await summarizeRows(rows, {
      brbHome: resolveRoots(o.env).brb,
      env: o.env,
      runner: o.runner ?? defaultRunner,
      which: o.which ?? ((bin) => onPath(bin, o.env)),
      tmpDir: o.tmpDir
    });
    if (summaries.size === 0) return null;
    for (const r of rows) r.summary = summaries.get(summaryKey(r));
    return renderTerminal(c, view);
  };
  return { stdout, exitCode: 0, rerender, ...picks, pending: import_picocolors2.default.createColors(color).dim("summarizing\u2026 (Ctrl-C to skip)") };
}
function redraw(shown, next, rows, columns = Infinity) {
  const width = (line) => line.replace(/\x1b\[[0-9;]*m/g, "").length;
  const lines = shown.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(width(line) / columns)), 0);
  return next !== null && lines < rows ? `\x1B[${lines}F\x1B[0J${next}` : "\x1B[1F\x1B[0J";
}
function parsePick(answer, count) {
  const a = answer.trim().toLowerCase();
  if (a === "" || a === "q") return "quit";
  const m = /^(s\s*)?(\d+)$/.exec(a);
  const n = m ? Number(m[2]) : 0;
  if (n < 1 || n > count) return "again";
  return m[1] ? { show: n } : n;
}
async function askPick(count) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const cancel = new AbortController();
  rl.on("SIGINT", () => rl.close());
  rl.on("close", () => cancel.abort());
  try {
    return parsePick(await rl.question(import_picocolors2.default.dim(` Pick a session (1-${count}), s<n> for its recap, Enter to quit: `), { signal: cancel.signal }), count);
  } catch {
    return "quit";
  } finally {
    rl.close();
  }
}
function openCommand(platform) {
  return platform === "darwin" ? ["open"] : platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"];
}
async function showRecap(recap, n) {
  const tty = Boolean(process.stdout.isTTY);
  if (tty) process.stdout.write(`${import_picocolors2.default.dim(" writing recap\u2026 (Ctrl-C to skip)")}
`);
  const cancel = new AbortController();
  const skip = () => cancel.abort();
  process.on("SIGINT", skip);
  let page;
  try {
    page = await recap(n, cancel.signal);
  } catch (err) {
    if (tty) process.stdout.write(redraw("", null, 0));
    process.stdout.write(`brb: couldn't write that recap: ${err instanceof Error ? err.message : String(err)}
`);
    return false;
  } finally {
    process.off("SIGINT", skip);
  }
  if (tty) process.stdout.write(redraw("", null, 0));
  process.stdout.write(`${tty ? " " : ""}\u2192 recap: ${page}
`);
  if (!tty) return true;
  const [bin, ...args] = openCommand(process.platform);
  spawn(bin, [...args, page], { detached: true, stdio: "ignore" }).on("error", () => {
  }).unref();
  return true;
}
async function readStdin() {
  if (process.stdin.isTTY) return "";
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}
async function main() {
  const argv = process.argv.slice(2);
  try {
    const result = await run({
      argv,
      env: process.env,
      cwd: process.cwd(),
      now: Date.now(),
      isTTY: Boolean(process.stdout.isTTY),
      columns: process.stdout.columns,
      stdin: argv[0] === "hook" ? await readStdin() : void 0
    });
    process.stdout.write(result.stdout);
    process.exitCode = result.exitCode;
    if (result.rerender) {
      process.stdout.write(`${result.pending}
`);
      const skip = () => {
        process.stdout.write(redraw(result.stdout, null, 0));
        process.exit();
      };
      process.once("SIGINT", skip);
      const next = await result.rerender().catch(() => null);
      process.off("SIGINT", skip);
      process.stdout.write(redraw(result.stdout, next, process.stdout.rows ?? 0, process.stdout.columns));
    }
    if (result.show !== void 0) {
      if (await showRecap(result.recap, result.show)) result.seen?.(result.show);
      else process.exitCode = 1;
    }
    if (result.picked !== void 0) result.seen?.(result.picked);
    let command = result.exec;
    while (result.choices && process.stdin.isTTY) {
      const pick = await askPick(result.choices.length);
      if (pick === "quit") break;
      if (pick === "again") continue;
      if (typeof pick === "object") {
        if (await showRecap(result.recap, pick.show)) result.seen?.(pick.show);
        continue;
      }
      command = result.choices[pick - 1];
      result.seen?.(pick);
      process.stdout.write(` \u2192 ${commandText(command)}
`);
      break;
    }
    if (command) process.exitCode = spawnSync("/bin/sh", ["-c", command], { stdio: "inherit" }).status ?? 1;
  } catch (err) {
    if (argv[0] !== "hook") throw err;
  }
}
if (process.argv[1] && realpath(process.argv[1]) === realpath(fileURLToPath(import.meta.url))) await main();
export {
  HELP,
  openCommand,
  parsePick,
  redraw,
  run,
  showRecap
};
