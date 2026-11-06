import { basename, join } from 'node:path';
import { oneLine } from '../text';
import type { Session, SessionEvent } from '../types';
import { isSummaryCwd, parseJsonLines, readHeadTail, recentFiles } from './files';
import type { RecentFile } from './files';

const TITLE_MAX = 60;
// errorLine is linear in the output and classify only reads its end, so a huge build log is never kept whole.
const OUTPUT_KEEP_CHARS = 4_000;
const INTERRUPT_PREFIX = '[Request interrupted by user';
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
// Prompts the system sent for a background task or a schedule, that it wrote itself, or that another Claude
// session sent as a peer are not the human talking. Queued prompts and accepted suggestions are.
const NOT_HUMAN_ORIGINS = new Set(['task_notification', 'scheduled', 'peer', 'system']);

// A tool call whose result may still come. `inTail` says which side of a skipped middle section its line was on.
interface ToolUse { name: string; input: any; at: number; inTail: boolean }

// Everything gathered from one file's lines.
interface Transcript {
  events: SessionEvent[];
  toolUses: Map<string, ToolUse>;
  answered: Set<string>; // ids of AskUserQuestion / ExitPlanMode calls that got a result
  sessionId?: string;
  cwd?: string;
  branch?: string;
  customTitle?: string;
  agentName?: string;
  aiTitle?: string;
  humanPromptInTail: boolean;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

// A string as it is, or the text blocks joined with newlines. Other blocks (images, tool results) add nothing.
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

function addToolResult(t: Transcript, block: any, at: number): void {
  const id = block.tool_use_id;
  const tool = typeof id === 'string' ? t.toolUses.get(id) : undefined;
  if (!tool) return; // its call sits in the part of the file that was skipped
  const failed = block.is_error === true;
  if (tool.name === 'Bash') {
    const command = str(tool.input?.command);
    if (command) t.events.push({ kind: 'command', at, command, ok: !failed, output: textOf(block.content).slice(-OUTPUT_KEEP_CHARS) });
  } else if (EDIT_TOOLS.has(tool.name)) {
    const file = str(tool.input?.file_path) ?? str(tool.input?.notebook_path);
    if (file && !failed) t.events.push({ kind: 'edit', at, files: [file] });
  } else if (ASK_TOOLS.has(tool.name)) {
    t.answered.add(id);
  }
}

function addUser(t: Transcript, line: any, at: number, inTail: boolean): void {
  const content = line.message?.content;
  let hasToolResult = false;
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type !== 'tool_result') continue;
    hasToolResult = true;
    addToolResult(t, block, at);
  }
  const text = textOf(content);
  if (text.trim() === '') return;
  if (text.startsWith(INTERRUPT_PREFIX)) {
    t.events.push({ kind: 'error', at, text: 'interrupted' });
  } else if (!hasToolResult && line.promptSource !== 'system' && !NOT_HUMAN_ORIGINS.has(line.turnOrigin)) {
    // A line that carries a tool result is the harness answering the agent, so it is never a human prompt,
    // whatever text rides along. The interrupt notice above is the one thing such a line can say.
    t.events.push({ kind: 'user', at, text });
    if (inTail) t.humanPromptInTail = true;
  }
}

function addAssistant(t: Transcript, line: any, at: number, inTail: boolean): void {
  const content = line.message?.content;
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      t.events.push({ kind: 'agent', at, text: block.text });
    } else if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      t.toolUses.set(block.id, { name: block.name, input: block.input, at, inTail });
    }
  }
  if (line.message?.stop_reason === 'end_turn') t.events.push({ kind: 'turn-end', at });
}

function addLine(t: Transcript, line: any, inTail: boolean): void {
  if (line.isSidechain === true || line.isMeta === true) return;
  t.sessionId = str(line.sessionId) ?? t.sessionId;
  t.cwd = str(line.cwd) ?? t.cwd;
  t.branch = str(line.gitBranch) ?? t.branch;

  if (line.type === 'custom-title') t.customTitle = str(line.customTitle) ?? t.customTitle;
  if (line.type === 'agent-name') t.agentName = str(line.agentName) ?? t.agentName;
  if (line.type === 'ai-title') t.aiTitle = str(line.aiTitle) ?? t.aiTitle;

  const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
  if (Number.isNaN(at)) return;
  if (line.type === 'user') addUser(t, line, at, inTail);
  else if (line.type === 'assistant') addAssistant(t, line, at, inTail);
  else if (line.type === 'system' && line.subtype === 'api_error') t.events.push({ kind: 'error', at, text: 'API error' });
}

// A question or plan the human never answered. When part of the file was skipped, one asked before the
// tail may have been answered in the skipped bytes, so only asks from the tail count.
function addUnansweredAsks(t: Transcript, skippedMiddle: boolean): void {
  for (const [id, tool] of t.toolUses) {
    if (t.answered.has(id) || (skippedMiddle && !tool.inTail)) continue;
    if (tool.name === 'AskUserQuestion') {
      const question = str(tool.input?.questions?.[0]?.question) ?? 'has a question for you';
      t.events.push({ kind: 'ask', at: tool.at, reason: 'question', text: question });
    } else if (tool.name === 'ExitPlanMode') {
      t.events.push({ kind: 'ask', at: tool.at, reason: 'plan', text: '' });
    }
  }
}

// The first of the custom title, the agent name, Claude's own ai-title and the first prompt that says anything.
function titleOf(t: Transcript): string {
  const firstPrompt = t.events.find((e) => e.kind === 'user');
  for (const candidate of [t.customTitle, t.agentName, t.aiTitle, firstPrompt?.kind === 'user' ? firstPrompt.text : undefined]) {
    const title = oneLine(candidate ?? '', TITLE_MAX);
    if (title) return title;
  }
  return 'untitled session';
}

async function readSession(file: RecentFile): Promise<Session | null> {
  const { lines, tailStart } = await readHeadTail(file.path);
  const t: Transcript = { events: [], toolUses: new Map(), answered: new Set(), humanPromptInTail: false };
  // The head and the tail are parsed apart, so every parsed line still knows which side of the skipped middle it was on.
  const headLines = tailStart === null ? lines : lines.slice(0, tailStart);
  for (const line of parseJsonLines(headLines)) addLine(t, line, false);
  if (tailStart !== null) for (const line of parseJsonLines(lines.slice(tailStart))) addLine(t, line, true);

  if (t.cwd === undefined || isSummaryCwd(t.cwd)) return null;
  addUnansweredAsks(t, tailStart !== null);
  t.events.sort((a, b) => a.at - b.at); // stable, so events with the same time keep the order they were written in

  const session: Session = {
    tool: 'claude',
    id: t.sessionId ?? basename(file.path, '.jsonl'),
    cwd: t.cwd,
    title: titleOf(t),
    events: t.events,
    lastActivityAt: t.events.at(-1)?.at ?? file.mtimeMs,
  };
  if (t.branch !== undefined && t.branch !== 'HEAD') session.branch = t.branch;
  // Without a human prompt in the tail, the last turn began in the part that was skipped.
  if (tailStart !== null && !t.humanPromptInTail) session.partialTurn = true;
  return session;
}

// `root` is the Claude folder (~/.claude). `o.now` is unused here: every adapter takes the same options.
export async function readClaudeSessions(root: string, o: { now: number; sinceMs: number }): Promise<Session[]> {
  const files = await recentFiles(join(root, 'projects'), /\.jsonl$/, o.sinceMs, 2);
  const sessions = await Promise.all(files.map(readSession));
  return sessions.filter((s): s is Session => s !== null);
}
