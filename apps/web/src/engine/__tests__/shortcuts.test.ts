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
});
