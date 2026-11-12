import * as fs from 'node:fs';
import { expect, test } from 'vitest';
import { HELP } from '../src/cli';
import { EXPECTED_BRIEF, EXPECTED_TERMINAL, HERO, POSITIONING, PRIVACY } from './support/expected';

const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test.each([
  ['the pitch', HERO],
  ['the /recap comparison', POSITIONING],
  ['the privacy promise', PRIVACY],
  ['the --help text', HELP.trim()],
  ['the sample screen', EXPECTED_TERMINAL],
  ['the sample briefing', EXPECTED_BRIEF],
])('README has %s verbatim', (_name, text) => {
  expect(readme).toContain(text);
});
