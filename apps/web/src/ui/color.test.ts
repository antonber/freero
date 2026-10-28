import { describe, expect, it } from 'vitest';
import { contrastRatio, initials, readableTextColor } from './color';

describe('readableTextColor', () => {
  it('uses dark text on light colours (white on yellow is unreadable)', () => {
    expect(readableTextColor('#ffe066')).toBe('#17162b');
    expect(readableTextColor('#fff')).toBe('#17162b');
  });
  it('uses white text on saturated dark colours', () => {
    expect(readableTextColor('#5b3ff0')).toBe('#ffffff');
  });
  it('gives mid-tone avatar colours initials that pass AA (white on orange is only 3.6:1, on bright blue 3.9:1)', () => {
    for (const bg of ['#e8590c', '#1c7ed6', '#0c8599', '#d6336c', '#2f9e44', '#f08c00', '#d6409f', '#12a594'])
      expect(contrastRatio(bg, readableTextColor(bg))).toBeGreaterThanOrEqual(4.5);
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
