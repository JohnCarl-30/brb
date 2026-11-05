// Escape sequences, matched in this order at each ESC:
//   ESC ] ... (BEL | ESC \)   OSC: window titles, hyperlinks
//   ESC [ ... final byte      CSI: colors, cursor movement, erasing
//   ESC x                     any other two-character escape
const ESCAPE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -\/]*[@-~]|.)/g;
// What the escapes leave behind: control characters and whitespace become one space.
const CONTROL_OR_SPACE = /[\x00-\x1f\x7f\s]+/g;
const MARKDOWN_MARKS = /\*\*|__|`/g;
const LEADING_MARKERS = /^[\s#*-]+/;
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
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
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
