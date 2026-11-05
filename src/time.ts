const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const UNIT_MS: Record<string, number> = { m: MINUTE, h: HOUR, d: DAY };

export function formatAge(ms: number): string {
  if (ms < MINUTE) return '<1 min';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  return `${Math.floor(ms / DAY)} d`;
}

export function parseSince(input: string): number | null {
  const match = /^(\d+)(m|h|d)$/.exec(input);
  return match ? Number(match[1]) * UNIT_MS[match[2]] : null;
}
