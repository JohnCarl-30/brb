import { expect, test } from 'vitest';
import { commandText, errorLine, firstSentence, lastQuestion, oneLine } from '../src/text';

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

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

test('oneLine treats C1 control characters like other control characters', () => {
  // U+009B is the 8-bit form of CSI
  expect(oneLine('a\u009b2Jb', 80)).toBe('a 2Jb');
  // both ends of U+0080-U+009F, and NEL
  expect(oneLine('a\u0080b\u009fc\u0085d', 80)).toBe('a b c d');
  // ordinary non-ASCII text is kept
  expect(oneLine('café ¡hola! …', 80)).toBe('café ¡hola! …');
});

test('oneLine removes charset designations as one sequence', () => {
  // ESC ( B is what tput sgr0 prints before the reset
  expect(oneLine('red\x1b(B\x1b[m text', 80)).toBe('red text');
  // all seven designators
  for (const designator of '()*+-./') {
    expect(oneLine(`a\x1b${designator}Bb`, 80)).toBe('ab');
  }
});

test('oneLine collapses whitespace and trims', () => {
  expect(oneLine('  a \n\n  b\t\tc  ', 80)).toBe('a b c');
});

test('oneLine measures max on the cleaned text', () => {
  expect(oneLine('x'.repeat(10), 10)).toBe('xxxxxxxxxx');
  expect(oneLine('\x1b[31m' + 'x'.repeat(10) + '\x1b[0m', 10)).toBe('xxxxxxxxxx');
});

test('oneLine cuts by code points and never splits a surrogate pair', () => {
  expect(oneLine('😀'.repeat(10), 4)).toBe('😀😀😀…');
  expect(oneLine('a😀b😀c', 3)).toBe('a😀…');
  // exactly max code points is kept whole, one more is cut
  expect(oneLine('😀'.repeat(4), 4)).toBe('😀😀😀😀');
  expect(oneLine('😀'.repeat(5), 4)).toBe('😀😀😀…');
  expect(oneLine('x'.repeat(11), 10)).toBe('xxxxxxxxx…');
  // no lone surrogate at any cut position
  for (let max = 1; max <= 12; max++) {
    expect(oneLine('a😀b😀c😀d😀e😀', max)).not.toMatch(LONE_SURROGATE);
  }
  // an escape followed by an astral character takes the whole character
  expect(oneLine('a\x1b😀b', 80)).toBe('ab');
  expect(oneLine('a\x1b(😀b', 80)).toBe('ab');
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
  expect(firstSentence('## Fixed the bug. Added a test.')).toBe('Fixed the bug.');
  expect(firstSentence('__Done__: wrote `cart.ts`. More')).toBe('Done: wrote cart.ts.');
  expect(firstSentence('')).toBe('');
  expect(firstSentence('**')).toBe('');
});

test('firstSentence and lastQuestion strip a leading numbered-list marker', () => {
  expect(firstSentence('1. Fixed the bug. 2. Added tests.')).toBe('Fixed the bug.');
  expect(firstSentence('2) Fixed the bug. Added tests.')).toBe('Fixed the bug.');
  expect(firstSentence('10. Fixed the bug. Added tests.')).toBe('Fixed the bug.');
  expect(lastQuestion('1) Should I continue?')).toBe('Should I continue?');
  // after a bullet or leading whitespace
  expect(firstSentence('- 1. Fixed the bug. Added tests.')).toBe('Fixed the bug.');
  expect(firstSentence('\n\n  1. Fixed the bug. Added tests.')).toBe('Fixed the bug.');
  // a decimal number is not a marker
  expect(firstSentence('2.5 is the new version. Next')).toBe('2.5 is the new version.');
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

test('lastQuestion starts at the line the question is on, not at the last period', () => {
  // A pasted brb catch-up has no periods, so without this the "question" began at "Welcome back".
  const pasted = 'Welcome back · away 3 min · 28 things moved\n\nEVERYWHERE\n 1 ◐ Claude langfuse\n\n- Which one do you want first?';
  expect(lastQuestion(pasted)).toBe('Which one do you want first?');
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

test('commandText strips escapes and control characters but keeps spaces and length', () => {
  expect(commandText("cd ~/'a  b\x1b[31m'\r\n&& x\x07")).toBe("cd ~/'a  b'  && x ");
  expect(commandText('x'.repeat(500))).toBe('x'.repeat(500));
});
