import { describe, expect, it } from 'vitest';
import { initials, readableTextColor } from './color';

describe('readableTextColor', () => {
  it('uses dark text on light colours (white on yellow is unreadable)', () => {
    expect(readableTextColor('#ffe066')).toBe('#17162b');
    expect(readableTextColor('#fff')).toBe('#17162b');
  });
  it('uses white text on saturated dark colours', () => {
    expect(readableTextColor('#5b3ff0')).toBe('#ffffff');
  });
});

describe('initials', () => {
  it('uses first and last word and ignores extra whitespace', () => {
    expect(initials('  grace  brewster hopper ')).toBe('GH');
  });
  it('does not render an empty avatar for a blank name', () => {
    expect(initials('   ')).toBe('?');
  });
});
