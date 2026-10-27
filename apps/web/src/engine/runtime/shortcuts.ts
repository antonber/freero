// Keyboard shortcut parsing, matching and display. 'mod' = ⌘ on macOS, Ctrl elsewhere.

export interface Shortcut {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

const ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  plus: '=',
  minus: '-',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  return: 'enter',
  space: ' ',
};

const cache = new Map<string, Shortcut>();

export function parseShortcut(s: string): Shortcut {
  const hit = cache.get(s);
  if (hit) return hit;
  const parts = s.toLowerCase().split('+');
  // 'mod++' → last part empty: the key is '+'
  let key = parts.pop() ?? '';
  if (key === '' && s.endsWith('+')) {
    parts.pop();
    key = '=';
  }
  key = ALIASES[key] ?? key;
  const sc: Shortcut = {
    mod: parts.includes('mod') || parts.includes('ctrl') || parts.includes('cmd'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt') || parts.includes('option'),
    key,
  };
  cache.set(s, sc);
  return sc;
}

/** Layout-robust key name: letters/digits from e.code, the rest from e.key. */
export function eventKey(e: Pick<KeyboardEvent, 'code' | 'key'>): string {
  const code = e.code || '';
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  switch (code) {
    case 'BracketRight': return ']';
    case 'BracketLeft': return '[';
    case 'Equal':
    case 'NumpadAdd': return '=';
    case 'Minus':
    case 'NumpadSubtract': return '-';
    case 'Slash': return '/';
    case 'Backslash': return '\\';
    case 'Period': return '.';
    case 'Comma': return ',';
  }
  return (e.key || '').toLowerCase();
}

const SHIFT_INSENSITIVE = new Set(['=', '-']);

export function matchShortcut(
  e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  shortcut: string | Shortcut,
): boolean {
  const sc = typeof shortcut === 'string' ? parseShortcut(shortcut) : shortcut;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== sc.mod) return false;
  if (e.altKey !== sc.alt) return false;
  if (!SHIFT_INSENSITIVE.has(sc.key) && e.shiftKey !== sc.shift) return false;
  return eventKey(e) === sc.key;
}

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  delete: 'Del',
  backspace: '⌫',
  enter: '↵',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
  '=': '+',
  tab: 'Tab',
};

/** Human label, e.g. 'mod+shift+z' → '⌘⇧Z' on mac, 'Ctrl+Shift+Z' elsewhere. */
export function formatShortcut(s: string | undefined): string {
  if (!s) return '';
  const sc = parseShortcut(s);
  const key = KEY_LABELS[sc.key] ?? sc.key.toUpperCase();
  if (isMac) return `${sc.mod ? '⌘' : ''}${sc.alt ? '⌥' : ''}${sc.shift ? '⇧' : ''}${key}`;
  return [sc.mod && 'Ctrl', sc.alt && 'Alt', sc.shift && 'Shift', key].filter(Boolean).join('+');
}

/** True for events whose key would insert a visible character. */
export function isPrintableKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !(e.altKey && !isMac) && e.key !== ' ';
}
