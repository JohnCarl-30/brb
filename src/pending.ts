import * as fs from 'node:fs';
import * as path from 'node:path';
import { SCAN_MS } from './adapters/files';
import type { PermissionRequest } from './types';

// A hook leaves one marker per session that is blocked on a permission prompt: Claude's Notification, Codex's PermissionRequest.
// Session ids are UUIDs, so the two tools' markers share one map without clashing.
const MARKER = /^(?:claude|codex)-([\w-]+)\.json$/;

// Left by every hook run, so brb can tell whether the plugin's hooks are installed without reading Claude's settings.
const hooksMarker = (brbHome: string): string => path.join(brbHome, 'hooks-on');
export const hooksHaveRun = (brbHome: string): boolean => fs.existsSync(hooksMarker(brbHome));
export function recordHookRun(brbHome: string): void {
  if (hooksHaveRun(brbHome)) return;
  fs.mkdirSync(brbHome, { recursive: true, mode: 0o700 });
  fs.writeFileSync(hooksMarker(brbHome), '', { mode: 0o600 });
}

export function recordPermissionRequest(brbHome: string, sessionId: string, message: string, now: number, tool: 'claude' | 'codex' = 'claude'): void {
  if (!/^[\w-]+$/.test(sessionId)) return; // the id comes from hook input and becomes a file name, so it must not hold a path
  const dir = path.join(brbHome, 'pending');
  // Private, like the summary cache: the message can name the command a session wants to run.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${tool}-${sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: now, message }), { mode: 0o600 });
  fs.chmodSync(file, 0o600); // writeFileSync's mode only applies to a new file
}

// Markers older than the scan window can no longer matter, so they are deleted. One that can't be read is skipped.
export function readPermissionRequests(brbHome: string, now: number): Map<string, PermissionRequest> {
  const dir = path.join(brbHome, 'pending');
  const found = new Map<string, PermissionRequest>();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of names) {
    const id = MARKER.exec(name)?.[1];
    if (id === undefined) continue;
    try {
      const marker: unknown = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const { at, message } = marker as Partial<PermissionRequest>;
      if (typeof at !== 'number' || typeof message !== 'string') continue;
      if (now - at > SCAN_MS) fs.rmSync(path.join(dir, name), { force: true });
      else found.set(id, { at, message });
    } catch {
      // unreadable or half-written
    }
  }
  return found;
}
