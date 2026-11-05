import { expect, test } from 'vitest';
import { formatAge, parseSince } from '../src/time';

test('formatAge', () => {
  expect(formatAge(30_000)).toBe('<1 min');
  expect(formatAge(8 * 60_000)).toBe('8 min');
  expect(formatAge(47 * 60_000 + 59_000)).toBe('47 min');
  expect(formatAge(3 * 3_600_000 + 5 * 60_000)).toBe('3 h');
  expect(formatAge(2 * 86_400_000 + 1)).toBe('2 d');
});

test('parseSince', () => {
  expect(parseSince('30m')).toBe(1_800_000);
  expect(parseSince('2h')).toBe(7_200_000);
  expect(parseSince('1d')).toBe(86_400_000);
  expect(parseSince('2 hours')).toBeNull();
  expect(parseSince('')).toBeNull();
});
