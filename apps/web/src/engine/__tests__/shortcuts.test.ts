import { describe, expect, it } from 'vitest';
import { matchShortcut } from '../runtime/shortcuts';

const key = (k: Partial<KeyboardEvent>) =>
  ({ code: '', key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...k }) as KeyboardEvent;

describe('shortcut matching (non-mac)', () => {
  it('Shift+1 matches even though the key produces "!"', () => {
    expect(matchShortcut(key({ code: 'Digit1', key: '!', shiftKey: true }), 'shift+1')).toBe(true);
  });

  it('Ctrl++ (shift held) and numpad + both trigger mod+=', () => {
    expect(matchShortcut(key({ code: 'Equal', key: '+', ctrlKey: true, shiftKey: true }), 'mod+=')).toBe(true);
    expect(matchShortcut(key({ code: 'NumpadAdd', key: '+', ctrlKey: true }), 'mod+=')).toBe(true);
  });

  it('letters match by physical key on non-Latin layouts, and extra modifiers do not match', () => {
    expect(matchShortcut(key({ code: 'KeyZ', key: 'я', ctrlKey: true }), 'mod+z')).toBe(true);
    expect(matchShortcut(key({ code: 'KeyZ', key: 'Z', ctrlKey: true, shiftKey: true }), 'mod+z')).toBe(false);
  });

  it('punctuation on a Russian layout (a key that types a letter) still falls back to its physical position', () => {
    expect(matchShortcut(key({ code: 'BracketLeft', key: 'х', ctrlKey: true }), 'mod+[')).toBe(true);
  });
});

// Punctuation shortcuts follow the character the layout types, not the US key position.
describe('punctuation shortcuts on non-US layouts', () => {
  it('German: typing "?" (Shift+ß) opens the sheet, and Shift+- (types "_") does not', () => {
    expect(matchShortcut(key({ code: 'Minus', key: '?', shiftKey: true }), 'shift+/')).toBe(true);
    expect(matchShortcut(key({ code: 'Slash', key: '_', shiftKey: true }), 'shift+/')).toBe(false);
  });

  it('German: Ctrl++ zooms in instead of bringing to front, Ctrl+- zooms out', () => {
    const plus = key({ code: 'BracketRight', key: '+', ctrlKey: true });
    expect(matchShortcut(plus, 'mod+=')).toBe(true);
    expect(matchShortcut(plus, 'mod+]')).toBe(false);
    expect(matchShortcut(key({ code: 'Slash', key: '-', ctrlKey: true }), 'mod+-')).toBe(true);
  });

  it('French: "?" (Shift+, on the M key) opens the sheet, Ctrl+- (on the 6 key) zooms out', () => {
    expect(matchShortcut(key({ code: 'KeyM', key: '?', shiftKey: true }), 'shift+/')).toBe(true);
    expect(matchShortcut(key({ code: 'Digit6', key: '-', ctrlKey: true }), 'mod+-')).toBe(true);
  });
});
