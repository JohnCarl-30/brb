// Escape sequences, matched in this order at each ESC:
//   ESC ] ... (BEL | ESC \)   OSC: window titles, hyperlinks
//   ESC [ ... final byte      CSI: colors, cursor movement, erasing
//   ESC ( x                   charset designation (also ESC ) * + - . / x), e.g. ESC ( B from tput sgr0
//   ESC x                     any other two-character escape
// The u flag makes `.` take a whole code point, so removing an escape never leaves half a surrogate pair.
const ESCAPE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -\/]*[@-~]|[()*+\-.\/].|.)/gu;
// What the escapes leave behind: control characters (C0, DEL and C1) and whitespace become one space.
const CONTROL_OR_SPACE = /[\x00-\x1f\x7f-\x9f\s]+/g;
const MARKDOWN_MARKS = /\*\*|__|`/g;
// Heading and bullet markers at the start of the text ("# ", "- ", "* "), then one numbered-list
// marker ("1. ", "2) "). The marker is not inside a repeated group, so a huge run of them can't
// overflow the regex stack.
const LEADING_MARKERS = /^[\s#*-]*(?:\d+[.)]\s+)?/;
// A sentence ends at a ., ! or ? that is followed by whitespace or the end of the text.
const SENTENCE_BREAK = /(?<=[.!?])\s+/;
const PROBLEM_WORDS = /error|fail|unknown|cannot|not found/i;

function clean(text: string): string {
  return text.replace(ESCAPE, '').replace(CONTROL_OR_SPACE, ' ').trim();
}

function sentences(text: string): string[] {
  return text.replace(MARKDOWN_MARKS, '').replace(LEADING_MARKERS, '').split(SENTENCE_BREAK);
}

export function oneLine(text: string, max: number): string {
  const line = clean(text);
  // Count code points rather than UTF-16 units, so the cut never splits a surrogate pair.
  let cutAt = 0; // UTF-16 length of the first max - 1 code points
  let seen = 0;
  for (const char of line) {
    if (seen === max) return `${line.slice(0, cutAt)}…`;
    if (seen < max - 1) cutAt += char.length;
    seen++;
  }
  return line;
}

export function firstSentence(text: string, max = 70): string {
  return oneLine(sentences(text)[0], max);
}

export function lastQuestion(text: string, max = 70): string | null {
  const question = sentences(text).filter((sentence) => sentence.endsWith('?')).at(-1);
  return question === undefined ? null : oneLine(question, max);
}

export function errorLine(output: string, max = 70): string {
  const lines = output.split('\n').map(clean).filter(Boolean).reverse();
  return oneLine(lines.find((line) => PROBLEM_WORDS.test(line)) ?? lines[0] ?? '', max);
}
