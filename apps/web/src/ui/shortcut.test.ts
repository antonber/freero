import { describe, expect, it } from 'vitest';
import { formatShortcut, shortcutKeys } from './shortcut';

describe('formatShortcut', () => {
  it('shows Mod as Command on Mac and as Ctrl elsewhere (wrong modifier misleads users)', () => {
    expect(formatShortcut('Mod+Shift+z', true)).toBe('⌘⇧Z');
    expect(formatShortcut('Mod+Shift+z', false)).toBe('Ctrl+Shift+Z');
  });

  it('does not drop a literal "+" key when splitting on "+"', () => {
    expect(shortcutKeys('Mod++', false)).toEqual(['Ctrl', '+']);
  });
});
