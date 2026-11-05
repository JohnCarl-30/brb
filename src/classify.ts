import { errorLine, firstSentence, lastQuestion } from './text';
import { formatAge } from './time';
import type { PermissionRequest, Session, SessionEvent, Verdict } from './types';

const WORKING_WITHIN_MS = 60_000;
const PERMISSION_SLACK_MS = 2_000;
const OUTPUT_TAIL_CHARS = 1_500;

type EventOf<K extends SessionEvent['kind']> = Extract<SessionEvent, { kind: K }>;

function ofKind<K extends SessionEvent['kind']>(events: SessionEvent[], kind: K): EventOf<K>[] {
  return events.filter((e): e is EventOf<K> => e.kind === kind);
}

// Decides a session's status from what happened in its last turn (spec 7.2).
// The rules run in order and the first match wins.
export function classify(s: Session, now: number, permission?: PermissionRequest): Verdict {
  // The last turn is everything after the last human prompt (every event when there is none).
  const turn = s.events.slice(s.events.map((e) => e.kind).lastIndexOf('user') + 1);
  const last = turn.at(-1);
  const said = ofKind(turn, 'agent').at(-1)?.text ?? '';

  if (permission && permission.at >= s.lastActivityAt - PERMISSION_SLACK_MS) {
    return { status: 'waiting', detail: permission.message, longText: said };
  }

  const asked = ofKind(turn, 'ask').at(-1);
  if (asked) {
    const detail = asked.reason === 'plan' ? 'has a plan waiting for your approval' : `asks: "${asked.text}"`;
    return { status: 'waiting', detail, longText: said };
  }

  if (last?.kind === 'error') {
    return { status: 'failed', detail: last.text, longText: last.text };
  }

  // A turn that has ended is never "working", however recently the file was written.
  if (last?.kind !== 'turn-end') {
    const quietFor = now - s.lastActivityAt;
    return quietFor < WORKING_WITHIN_MS
      ? { status: 'working', detail: firstSentence(said) || 'working…', longText: said }
      : { status: 'idle', detail: `no activity for ${formatAge(quietFor)}`, longText: said };
  }

  const lastCommand = ofKind(turn, 'command').at(-1);
  if (lastCommand && !lastCommand.ok) {
    return {
      status: 'failed',
      detail: errorLine(lastCommand.output) || `${lastCommand.command} failed`,
      longText: `${lastCommand.command}\n${lastCommand.output.slice(-OUTPUT_TAIL_CHARS)}`,
    };
  }

  const question = lastQuestion(said);
  const didWork = turn.some((e) => e.kind === 'edit' || e.kind === 'command');
  if (question && !didWork) {
    return { status: 'waiting', detail: `asks: "${question}"`, longText: said };
  }

  return { status: 'finished', detail: firstSentence(said) || 'done', longText: said };
}
