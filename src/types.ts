export type Tool = 'claude' | 'codex' | 'gemini' | 'kiro';
export type Status = 'waiting' | 'finished' | 'failed' | 'working' | 'idle';
export type SessionEvent =
  | { kind: 'user'; at: number; text: string }                  // a prompt the human typed
  | { kind: 'agent'; at: number; text: string }                 // prose the agent showed the human
  | { kind: 'edit'; at: number; files: string[] }               // absolute paths the agent changed
  | { kind: 'command'; at: number; command: string; ok: boolean; output: string }
  | { kind: 'ask'; at: number; reason: 'question' | 'plan'; text: string } // structured ask, still unanswered
  | { kind: 'error'; at: number; text: string }                 // API error, interrupt, cancel
  | { kind: 'turn-end'; at: number };                           // the agent finished its turn
export interface Session {
  tool: Tool;
  id: string;              // what the tool's resume command accepts
  cwd: string;             // absolute folder the session ran in
  title: string;           // ≤ 60 chars, already cleaned
  branch?: string;
  events: SessionEvent[];  // chronological
  lastActivityAt: number;  // last event's `at`, or the file mtime when there are no events
  pendingTool?: { at: number; label: string }; // the last thing was a tool call with no result yet: still running, or blocked on a permission prompt
  partialTurn?: boolean;   // the reader skipped part of the last turn, so its edits, commands or answers may be unseen
  file?: string;           // the history file it was read from
}
export interface PermissionRequest { at: number; message: string }
// `maybeBlocked`: working only because a tool call has had no result, which is also what a permission prompt looks like.
export interface Verdict { status: Status; detail: string; longText: string; maybeBlocked?: boolean }
