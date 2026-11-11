import * as fs from 'node:fs';
import * as path from 'node:path';
import { SCAN_MS } from './adapters/files';
import type { Tool } from './types';

// When you last picked each session (resumed it or opened its recap), so the list can leave it out until it moves again.
export const seenKey = (tool: Tool, id: string): string => `${tool}-${id}`;
const fileIn = (brbHome: string): string => path.join(brbHome, 'seen.json');

// A file that is missing or can't be read means nothing was seen.
export function readSeen(brbHome: string): Map<string, number> {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(fileIn(brbHome), 'utf8'));
    return new Map(Object.entries(data as object).filter((e): e is [string, number] => typeof e[1] === 'number'));
  } catch {
    return new Map();
  }
}

// shortcut: one file, read then written, so two picks in the same instant can lose one; use a file per session if that shows up.
export function markSeen(brbHome: string, key: string, now: number): void {
  const seen = readSeen(brbHome);
  seen.set(key, now);
  for (const [k, at] of seen) if (now - at > SCAN_MS) seen.delete(k); // sessions that old are no longer read at all
  fs.mkdirSync(brbHome, { recursive: true, mode: 0o700 });
  fs.writeFileSync(fileIn(brbHome), JSON.stringify(Object.fromEntries(seen)), { mode: 0o600 });
}
