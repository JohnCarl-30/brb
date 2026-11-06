import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import pkg from '../package.json';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brb-entry-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// R6: `npx brb` runs a symlink to dist/brb.mjs. If the entry-point guard stops matching, brb prints nothing and exits 0, which no other test notices.
// This runs the built file, so it needs dist/brb.mjs to be current; CI checks that right after.
test.skipIf(process.platform === 'win32')('the built file runs through a symlink, as npx runs it', () => {
  const link = path.join(tmp, 'brb');
  fs.symlinkSync(path.resolve(import.meta.dirname, '../dist/brb.mjs'), link);
  const out = execFileSync(process.execPath, [link, '--version'], { env: { HOME: tmp }, encoding: 'utf8' });
  expect(out).toBe(`${pkg.version}\n`);
});
