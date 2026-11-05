import { expect, test } from 'vitest';
import { errorLine, firstSentence, lastQuestion, oneLine } from '../src/text';

test('oneLine strips color codes and turns control characters into spaces', () => {
  expect(oneLine('a\x1b[31mred\x1b[0m\nnext\tline', 80)).toBe('ared next line');
});

test('oneLine strips OSC sequences and bells', () => {
  expect(oneLine('bell\x07 and \x1b]0;title\x07 osc', 80)).toBe('bell and osc');
});

test('oneLine cuts to max characters and ends in an ellipsis', () => {
  expect(oneLine('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
});

test('oneLine strips the other escape forms', () => {
  // OSC hyperlinks, ended by ESC \ instead of a bell
  expect(oneLine('see \x1b]8;;https://example.com\x1b\\the docs\x1b]8;;\x1b\\ now', 80)).toBe('see the docs now');
  // OSC window titles can hold spaces
  expect(oneLine('a\x1b]0;user@host: ~/my dir\x07b', 80)).toBe('ab');
  // CSI sequences with parameters and a final byte other than m: erase screen, move cursor
  expect(oneLine('ok\x1b[2J\x1b[1;1H done', 80)).toBe('ok done');
  // CSI with a private parameter (hide cursor) and an intermediate byte (set cursor style)
  expect(oneLine('a\x1b[?25lb\x1b[3 qc', 80)).toBe('abc');
  // two-character escapes: reset and save cursor
  expect(oneLine('a\x1bcb\x1b7c', 80)).toBe('abc');
  // NUL and DEL
  expect(oneLine('a\x7fb\x00c', 80)).toBe('a b c');
  // a lone ESC, at the end or before a newline
  expect(oneLine('a\x1b', 80)).toBe('a');
  expect(oneLine('a\x1b\nb', 80)).toBe('a b');
});

test('oneLine collapses whitespace and trims', () => {
  expect(oneLine('  a \n\n  b\t\tc  ', 80)).toBe('a b c');
});

test('oneLine measures max on the cleaned text', () => {
  expect(oneLine('x'.repeat(10), 10)).toBe('xxxxxxxxxx');
  expect(oneLine('\x1b[31m' + 'x'.repeat(10) + '\x1b[0m', 10)).toBe('xxxxxxxxxx');
});

test('firstSentence drops bold markers before cutting', () => {
  expect(firstSentence('**Done.** Added 6 tests. Want more?')).toBe('Done.');
});

test('firstSentence cuts after the first sentence', () => {
  expect(firstSentence('Added 6 tests, all passing. Want me to open a PR?')).toBe('Added 6 tests, all passing.');
  expect(firstSentence('Why did it fail? Checking now.')).toBe('Why did it fail?');
  expect(firstSentence('Done.\nNext line')).toBe('Done.');
});

test('firstSentence only ends a sentence at a mark followed by whitespace or the end', () => {
  expect(firstSentence('Edited cart.ts and utils.ts then stopped')).toBe('Edited cart.ts and utils.ts then stopped');
  expect(firstSentence('Wow!')).toBe('Wow!');
});

test('firstSentence strips markdown markers', () => {
  expect(firstSentence('# Fixed the bug. Added a test.')).toBe('Fixed the bug.');
  expect(firstSentence('- Fixed the bug. Added a test.')).toBe('Fixed the bug.');
  expect(firstSentence('* Fixed the bug! Added a test.')).toBe('Fixed the bug!');
  expect(firstSentence('__Done__: wrote `cart.ts`. More')).toBe('Done: wrote cart.ts.');
  expect(firstSentence('')).toBe('');
  expect(firstSentence('**')).toBe('');
});

test('firstSentence applies oneLine with its own max, 70 by default', () => {
  expect(firstSentence('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
  expect(firstSentence('x'.repeat(100))).toBe('x'.repeat(69) + '…');
});

test('lastQuestion finds the last sentence ending in a question mark', () => {
  expect(lastQuestion('I changed the cart. Round per item or on the total?')).toBe('Round per item or on the total?');
  expect(lastQuestion('Which one? I will wait. Or this one?')).toBe('Or this one?');
  expect(lastQuestion('Round per item or on the total? I will wait.')).toBe('Round per item or on the total?');
});

test('lastQuestion is null when nothing asks', () => {
  expect(lastQuestion('All done.')).toBeNull();
  expect(lastQuestion('')).toBeNull();
});

test('lastQuestion drops bold markers and applies oneLine with its own max, 70 by default', () => {
  expect(lastQuestion('**Should I continue?**')).toBe('Should I continue?');
  expect(lastQuestion('Is ' + 'x'.repeat(100) + '?', 10)).toBe('Is xxxxxx…');
  expect(lastQuestion('Is ' + 'x'.repeat(100) + '?')).toBe('Is ' + 'x'.repeat(66) + '…');
});

test('errorLine returns the error line of build output', () => {
  expect(errorLine('> build\n> next build\n\nError: next.config.js: unknown option "ppr"\n')).toBe('Error: next.config.js: unknown option "ppr"');
});

test('errorLine falls back to the last non-empty line', () => {
  expect(errorLine('just output\nlast line')).toBe('last line');
  expect(errorLine('last real line\n\x1b[0m\n')).toBe('last real line');
  expect(errorLine('')).toBe('');
});

test('errorLine prefers the last line that mentions a problem', () => {
  expect(errorLine('Error: first\nok\nTests failed: 2\ndone')).toBe('Tests failed: 2');
});

test('errorLine recognises each problem word in any case', () => {
  for (const word of ['error', 'FAIL', 'unknown', 'Cannot', 'NOT FOUND']) {
    expect(errorLine(`${word} here\nlast line`)).toBe(`${word} here`);
  }
});

test('errorLine cleans lines and applies oneLine with its own max, 70 by default', () => {
  expect(errorLine('\x1b[31mError: boom\x1b[0m\n')).toBe('Error: boom');
  expect(errorLine('Error: ' + 'x'.repeat(100))).toBe('Error: ' + 'x'.repeat(62) + '…');
  expect(errorLine('Error: boom', 9)).toBe('Error: b…');
});
