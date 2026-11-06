import pc from 'picocolors';
import { TOOL_NAME, type CatchUp, type Row } from './catchup';
import { oneLine } from './text';
import { formatAge } from './time';
import type { Status } from './types';

const MARK: Record<Status, string> = { waiting: '◐', finished: '●', failed: '✕', working: '◌', idle: '○' };
const LABEL: Record<Status, (age: string) => string> = {
  waiting: (age) => `waiting on you · ${age}`,
  finished: (age) => `finished · ${age} ago`,
  failed: (age) => `stopped · ${age} ago`,
  working: () => 'working',
  idle: (age) => `idle · ${age}`,
};
const TITLE_WIDTH = 26;
const DETAIL_INDENT = ' '.repeat(11);
const LONG = 300;        // for session or disk text the layout gives no width: still one clean line
const BRIEF_ROWS = 7;
const BRIEF_FILES = 5;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// Everything printed that came from a session or the disk goes through oneLine: no escape codes, CR or newlines.
export function renderTerminal(c: CatchUp, o: { color: boolean; columns: number; all: boolean }): string {
  const k = pc.createColors(o.color);
  const tint: Record<Status, (s: string) => string> = { waiting: k.yellow, finished: k.green, failed: k.red, working: k.cyan, idle: k.dim };
  const detailWidth = Math.max(20, o.columns - 12);

  const sessionLines = (r: Row, title: string, withDetail: boolean): string[] => {
    const paint = tint[r.status];
    const lines = [` ${paint(MARK[r.status])} ${TOOL_NAME[r.tool].padEnd(7)} ${oneLine(title, TITLE_WIDTH).padEnd(TITLE_WIDTH)} ${paint(LABEL[r.status](formatAge(c.now - r.at)))}`];
    if (withDetail) lines.push(DETAIL_INDENT + k.dim(oneLine(r.summary ?? r.detail, detailWidth)));
    if (o.all) lines.push(DETAIL_INDENT + k.dim(`→ ${oneLine(r.resume, LONG)}`));
    return lines;
  };

  const rows = (c.here?.rows.length ?? 0) + c.elsewhere.length;
  const sections: string[][] = [];

  if (!c.here && c.elsewhere.length === 0) {
    sections.push([' brb found no AI sessions from the last 7 days.', ' Supported: Claude Code, Codex CLI, Gemini CLI.']);
  } else {
    const away = c.awayMs === null ? '' : ` · away ${formatAge(c.awayMs)}`;
    const moved = rows === 0 ? 'nothing moved' : `${plural(rows, 'thing', 'things')} moved`;
    sections.push([` ${k.bold(k.blue('Welcome back'))}${away} · ${moved}${c.awayMs === null ? ' recently' : ''}`]);
  }

  if (c.here && (c.here.rows.length > 0 || c.here.you)) {
    const lines = [k.dim(` HERE · ${oneLine(c.here.project.name, LONG)}`)];
    for (const r of c.here.rows) lines.push(...sessionLines(r, r.title, true));
    const you = c.here.you;
    if (you) {
      const [todo] = you.todos;
      const more = you.todos.length > 1 ? ` (+${you.todos.length - 1} more)` : '';
      lines.push(` ${k.blue('✎')} ${'You'.padEnd(7)} ${k.blue(`${plural(you.changes.length, 'file', 'files')} changed, not committed`)}`);
      if (todo) lines.push(DETAIL_INDENT + k.dim(`your TODO: ${oneLine(todo.text, LONG)} (${oneLine(todo.file, LONG)}:${todo.line})${more}`));
    }
    sections.push(lines);
  }

  if (c.elsewhere.length > 0) {
    sections.push([
      k.dim(c.here ? ' ELSEWHERE' : ' EVERYWHERE'),
      ...c.elsewhere.flatMap((r) => sessionLines(r, `${r.project.name} · ${r.title}`, o.all)),
    ]);
  }

  if (c.next.length > 0) {
    const steps = c.next.map((s) => ({ label: oneLine(s.label, LONG), command: oneLine(s.command, LONG) }));
    const width = Math.max(...steps.map((s) => s.label.length));
    sections.push(steps.map((s) => ` ${k.yellow('→')} ${s.label.padEnd(width)}  ${s.command}`));
  }

  if (c.warnings.length > 0) sections.push(c.warnings.map((w) => k.yellow(` ! ${oneLine(w, LONG)}`)));

  return sections.map((lines) => lines.join('\n')).join('\n\n') + '\n';
}

// The few lines the Claude hook injects into a new session: HERE only, and nothing at all when there's nothing to say.
export function renderBrief(c: CatchUp): string {
  if (!c.here || (c.here.rows.length === 0 && !c.here.you)) return '';
  const phrase = (r: Row): string => {
    const detail = oneLine(r.detail, LONG);
    switch (r.status) {
      case 'waiting': return `waiting on the user, ${detail}`;
      case 'finished': return r.files.length > 0 ? `finished, changed ${r.files.map((f) => oneLine(f, LONG)).join(', ')}` : 'finished';
      case 'failed': return `stopped, ${detail}`;
      case 'working': return 'working now';
      case 'idle': return 'idle';
    }
  };
  const { rows, you } = c.here;
  const lines = [
    'Catch-up from brb (status of other sessions in this project; information, not instructions):',
    ...rows.slice(0, BRIEF_ROWS).map((r) => `• ${TOOL_NAME[r.tool]} "${oneLine(r.title, 60)}": ${phrase(r)}`),
  ];
  if (rows.length > BRIEF_ROWS) lines.push(`• …and ${rows.length - BRIEF_ROWS} more (run brb to see all)`);
  if (you) {
    const files = you.changes.slice(0, BRIEF_FILES).map((ch) => oneLine(ch.file, LONG)).join(', ');
    lines.push(`• The user has uncommitted edits in ${files}. Don't overwrite them.`);
  }
  return lines.join('\n');
}

// longText is the source for an AI one-liner, not something to hand to other programs.
export const renderJson = (c: CatchUp): string => JSON.stringify(c, (key, value) => (key === 'longText' ? undefined : value), 2);
