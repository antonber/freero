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

/** The character US Shift types on each punctuation key. */
const US_SHIFTED: Record<string, string> = {
  '/': '?', '[': '{', ']': '}', ',': '<', '.': '>', ';': ':', "'": '"', '\\': '|', '`': '~', '=': '+', '-': '_',
};
/** One shortcut, either character: Ctrl+= and Ctrl++ both zoom in, Ctrl+- and Ctrl+_ both zoom out. */
const SAME_KEY: Record<string, string> = { '+': '=', '_': '-' };

/** US characters of the punctuation keys, by physical position. */
const PUNCT_CODES: Record<string, string> = {
  BracketRight: ']', BracketLeft: '[', Equal: '=', NumpadAdd: '=', Minus: '-', NumpadSubtract: '-',
  Slash: '/', Backslash: '\\', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", Backquote: '`',
};

/** A single typed character that is neither a letter, a digit nor whitespace. */
const isPunctuation = (k: string) => k.length === 1 && !/[\p{L}\p{N}\s]/u.test(k);

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
  let shift = parts.includes('shift');
  // Bindings name US keys ('shift+/'); what they mean is the character that types ('?').
  if (shift && US_SHIFTED[key]) {
    key = US_SHIFTED[key];
    shift = false;
  }
  key = SAME_KEY[key] ?? key;
  const sc: Shortcut = {
    mod: parts.includes('mod') || parts.includes('ctrl') || parts.includes('cmd'),
    shift,
    alt: parts.includes('alt') || parts.includes('option'),
    key,
  };
  cache.set(s, sc);
  return sc;
}

/**
 * Every name a key press answers to, its main one first:
 * - letters by physical key (`code`), so tool keys and Ctrl+Z work on any layout (Cyrillic too);
 * - punctuation by the character the layout types (`key`): '?' is Shift+ß on a German keyboard and
 *   Shift+, on a French one, so bindings for '?', '[', ']', '=' and '-' follow what people type;
 * - digits by physical key too, so Shift+1 still answers 'shift+1' while it types '!';
 * - a punctuation key that types no punctuation (a letter on a Russian layout) by its US character.
 */
export function eventKeys(e: Pick<KeyboardEvent, 'code' | 'key'>): string[] {
  const code = e.code || '';
  const key = e.key || '';
  const typed = isPunctuation(key) ? (SAME_KEY[key] ?? key) : null;
  if (code.startsWith('Key')) {
    const letter = code.slice(3).toLowerCase();
    return typed ? [letter, typed] : [letter];
  }
  if (code.startsWith('Digit')) return typed ? [typed, code.slice(5)] : [code.slice(5)];
  if (typed) return [typed];
  return [PUNCT_CODES[code] ?? key.toLowerCase()];
}

/** The key's main name (see `eventKeys`): a letter by position, punctuation as typed. */
export function eventKey(e: Pick<KeyboardEvent, 'code' | 'key'>): string {
  return eventKeys(e)[0];
}

type ShortcutEvent = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export interface MatchOptions {
  /**
   * Also accept AltGr + a typed punctuation character for a `mod+<that character>` binding (not on
   * macOS). Windows reports AltGr as Ctrl+Alt, and where '[' / ']' need AltGr (German AltGr+8/9,
   * French AltGr+5/°) that chord is the only way to press "Ctrl+[" at all. Off while typing text:
   * there, AltGr+8 must type '['.
   */
  altGr?: boolean;
}

export function matchShortcut(e: ShortcutEvent, shortcut: string | Shortcut, opts: MatchOptions = {}): boolean {
  const sc = typeof shortcut === 'string' ? parseShortcut(shortcut) : shortcut;
  if (matches(e, sc, e.altKey)) return true;
  const altGr = !!opts.altGr && !isMac && e.ctrlKey && e.altKey && isPunctuation(e.key);
  return altGr && sc.mod && !sc.alt && isPunctuation(sc.key) && matches(e, sc, false);
}

function matches(e: ShortcutEvent, sc: Shortcut, alt: boolean): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== sc.mod) return false;
  if (alt !== sc.alt) return false;
  // A punctuation character already says whether that layout needed Shift to type it.
  if (!isPunctuation(sc.key) && e.shiftKey !== sc.shift) return false;
  return eventKeys(e).includes(sc.key);
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
