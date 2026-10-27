import { describe, expect, it } from 'vitest';
import { relativeTime } from './time';

// Local-time constructor keeps the tests independent of the machine's timezone.
const now = new Date(2026, 9, 27, 15, 0, 0).getTime(); // Oct 27 2026, 15:00

describe('relativeTime', () => {
  it('says "just now" for fresh edits and for timestamps slightly in the future (clock skew)', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now + 5_000, now)).toBe('just now');
  });

  it('does not print "60 min ago" at the minute/hour boundary', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 59 * 60_000 - 50_000, now)).toBe('1 hour ago');
  });

  it('counts hours only within today', () => {
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 hours ago');
  });

  it('calls anything on the previous calendar day "Yesterday", even under 24h ago', () => {
    expect(relativeTime(new Date(2026, 9, 26, 23, 0).getTime(), now)).toBe('Yesterday');
    expect(relativeTime(new Date(2026, 9, 26, 1, 0).getTime(), now)).toBe('Yesterday');
  });

  it('switches from "N days ago" to a date after a week, adding the year only for past years', () => {
    expect(relativeTime(new Date(2026, 9, 24, 12, 0).getTime(), now)).toBe('3 days ago');
    expect(relativeTime(new Date(2026, 2, 4, 12, 0).getTime(), now)).toBe('Mar 4');
    expect(relativeTime(new Date(2024, 2, 4, 12, 0).getTime(), now)).toBe('Mar 4, 2024');
  });
});
