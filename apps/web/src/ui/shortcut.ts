// Formats shortcut strings like "Mod+Shift+Z" for display.
// "Mod" is the Command key on Apple platforms and Ctrl elsewhere.

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(p);
}

const MAC: Record<string, string> = {
  mod: '⌘', cmd: '⌘', meta: '⌘', ctrl: '⌃', control: '⌃', alt: '⌥', option: '⌥', shift: '⇧',
  enter: '↩', return: '↩', backspace: '⌫', delete: '⌫', del: '⌦', escape: 'Esc', esc: 'Esc', tab: '⇥',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', up: '↑', down: '↓', left: '←', right: '→',
  space: 'Space', plus: '+', pageup: 'Page Up', pagedown: 'Page Down',
};

const OTHER: Record<string, string> = {
  mod: 'Ctrl', cmd: 'Ctrl', meta: 'Win', ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift',
  enter: 'Enter', return: 'Enter', backspace: 'Backspace', delete: 'Del', del: 'Del', escape: 'Esc', esc: 'Esc', tab: 'Tab',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', up: '↑', down: '↓', left: '←', right: '→',
  space: 'Space', plus: '+', pageup: 'Page Up', pagedown: 'Page Down',
};

/** Splits a shortcut into display keys, e.g. "Mod+Shift+Z" -> ["⌘","⇧","Z"] on macOS. */
export function shortcutKeys(shortcut: string, apple = isApplePlatform()): string[] {
  const table = apple ? MAC : OTHER;
  // Allow a literal "+" key: "Mod++" or "Mod+Plus".
  const parts = shortcut.replace(/\+\+$/, '+plus').split('+').filter(Boolean);
  return parts.map((raw) => {
    const k = raw.trim();
    const mapped = table[k.toLowerCase()];
    if (mapped) return mapped;
    return k.length === 1 ? k.toUpperCase() : k;
  });
}

/** "Mod+Shift+Z" -> "⌘⇧Z" (macOS) or "Ctrl+Shift+Z" (others). */
export function formatShortcut(shortcut: string, apple = isApplePlatform()): string {
  return shortcutKeys(shortcut, apple).join(apple ? '' : '+');
}
