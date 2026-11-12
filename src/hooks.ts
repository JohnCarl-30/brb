import { resolveRoots } from './adapters';
import type { RunOptions, RunResult } from './cli';
import { computeCatchUp } from './compute';
import { recordHookRun, recordPermissionRequest } from './pending';
import { renderBrief } from './render';
import { oneLine } from './text';

const QUIET: RunResult = { stdout: '', exitCode: 0 };

// What Codex is about to ask the user to approve, from its PermissionRequest input. Its own reason when it gives one.
function codexAsk(input: { tool_name?: unknown; tool_input?: unknown }): string {
  const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
  const { description, command } = (input.tool_input ?? {}) as { description?: unknown; command?: unknown };
  if (typeof description === 'string' && description.trim() !== '') return description;
  if (tool === 'apply_patch') return 'Codex needs your approval to edit files';
  if (tool === 'Bash' && typeof command === 'string') return `Codex needs your approval to run ${command}`;
  return `Codex needs your approval${tool ? ` to use ${tool}` : ''}`;
}

// Claude Code and Codex show a failing hook to the user, so this never throws and always exits 0.
// A third argument of `codex` says Codex ran the hook (`brb hook session-start codex`).
export async function runHook(name: string, stdin: string, o: RunOptions): Promise<RunResult> {
  if (o.env.BRB_INTERNAL === '1') return QUIET; // brb's own AI calls start Claude sessions that run these hooks too
  try {
    // Only Claude's hooks count: the marker is what stops the tip about Claude's permission prompts.
    if ((name === 'notification' || name === 'session-start') && o.argv[2] !== 'codex') recordHookRun(resolveRoots(o.env).brb);
    const input = (JSON.parse(stdin) ?? {}) as { session_id?: unknown; cwd?: unknown; message?: unknown; notification_type?: unknown; tool_name?: unknown; tool_input?: unknown };
    const sessionId = typeof input.session_id === 'string' ? input.session_id : undefined;

    if (name === 'notification') {
      const message = typeof input.message === 'string' ? input.message : '';
      if (sessionId !== undefined && (/permission/i.test(message) || input.notification_type === 'permission_prompt')) {
        recordPermissionRequest(resolveRoots(o.env).brb, sessionId, oneLine(message, 80), o.now);
      }
      return QUIET;
    }

    // Codex runs this as it is about to ask for approval. Printing nothing leaves the decision to the user.
    if (name === 'permission-request') {
      if (sessionId !== undefined) recordPermissionRequest(resolveRoots(o.env).brb, sessionId, oneLine(codexAsk(input), 80), o.now, 'codex');
      return QUIET;
    }

    if (name === 'session-start') {
      const c = await computeCatchUp({ env: o.env, cwd: typeof input.cwd === 'string' ? input.cwd : o.cwd, now: o.now, excludeSessionId: sessionId });
      const brief = renderBrief(c);
      if (brief === '') return QUIET;
      const rows = c.here?.rows ?? [];
      const waiting = rows.filter((r) => r.status === 'waiting').length;
      const hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: brief };
      // With no other sessions the brief is only about uncommitted edits: Claude gets it, and there's nothing to count for the user.
      const systemMessage = rows.length === 0 ? undefined
        : `brb: ${rows.length} other session${rows.length === 1 ? '' : 's'} in this project${waiting > 0 ? ` · ${waiting} waiting on you` : ''}`;
      return { stdout: JSON.stringify({ systemMessage, hookSpecificOutput }) + '\n', exitCode: 0 };
    }
  } catch {
    // a hook that fails is worse than one that says nothing
  }
  return QUIET;
}
