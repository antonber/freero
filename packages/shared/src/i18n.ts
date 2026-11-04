// Interface languages (#5; docs/design/i18n.md): the languages Freero ships, how a browser's
// languages map onto them, and a small ICU MessageFormat formatter used by the web app and the
// server (emails, notifications) alike. Locale data comes from the platform's Intl.

/** Every language the interface ships, English (the source) first. */
export const LOCALES = ['en', 'de', 'fr', 'es', 'pt-BR', 'ja', 'ko', 'zh-CN', 'ar', 'he'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language's own name for itself (the picker shows these, never translated). */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  ja: '日本語',
  ko: '한국어',
  'zh-CN': '简体中文',
  ar: 'العربية',
  he: 'עברית',
};

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** Does this language write right to left (its interface mirrors)? */
export function isRtlLocale(locale: string): boolean {
  return RTL_LANGUAGES.has(locale.split('-')[0].toLowerCase());
}

/** Legacy or alternative tags browsers still send. */
const ALIASES: Record<string, string> = { iw: 'he', 'zh-hans': 'zh-CN', 'zh-sg': 'zh-CN', pt: 'pt-BR' };

/**
 * The shipped language for a list of wanted ones (navigator.languages, Accept-Language), in order
 * of preference: an exact match (any case), then the same language in another region we ship
 * (`de-AT` → `de`, `pt-PT` → `pt-BR`, `zh-TW` → `zh-CN`). Null when none is shipped.
 */
export function negotiateLocale(wanted: readonly string[]): Locale | null {
  for (const raw of wanted) {
    const tag = raw.trim().replace(/_/g, '-');
    if (!tag || tag === '*') continue;
    const lower = tag.toLowerCase();
    const want = (ALIASES[lower] ?? lower).toLowerCase();
    const exact = LOCALES.find((l) => l.toLowerCase() === want);
    if (exact) return exact;
    const base = want.split('-')[0];
    const viaAlias = (ALIASES[base] ?? base).toLowerCase();
    const sameLanguage = LOCALES.find((l) => l.toLowerCase() === viaAlias) ?? LOCALES.find((l) => l.split('-')[0].toLowerCase() === base);
    if (sameLanguage) return sameLanguage;
  }
  return null;
}

/** Languages from an Accept-Language header, most wanted first. */
export function acceptLanguages(header: string | undefined | null): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
}

// ---------------------------------------------------------------------------------------------
// ICU MessageFormat (the subset an interface needs; see docs/design/i18n.md)
// ---------------------------------------------------------------------------------------------

export type MessageValue = string | number | Date | boolean | null | undefined;
export type MessageVars = Record<string, MessageValue>;

type Part =
  | string
  | { k: 'arg'; name: string }
  | { k: 'number' | 'date' | 'time'; name: string; style: string }
  | { k: 'plural' | 'selectordinal'; name: string; offset: number; options: Record<string, Part[]> }
  | { k: 'select'; name: string; options: Record<string, Part[]> }
  | { k: 'pound' };

export class MessageSyntaxError extends Error {
  constructor(message: string, public readonly pattern: string, public readonly at: number) {
    super(`${message} at ${at} in "${pattern}"`);
  }
}

class Parser {
  i = 0;
  constructor(readonly s: string) {}

  fail(msg: string): never {
    throw new MessageSyntaxError(msg, this.s, this.i);
  }

  /** A message up to (not including) a closing '}' at this depth, or the end. */
  message(inPlural: boolean, nested: boolean): Part[] {
    const out: Part[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push(text);
      text = '';
    };
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === "'") {
        const next = s[this.i + 1];
        if (next === "'") {
          text += "'";
          this.i += 2;
        } else if (next === '{' || next === '}' || (inPlural && next === '#') || next === '|') {
          // Quoted literal: up to the next lone apostrophe ('' inside stays one ').
          this.i++;
          while (this.i < s.length) {
            if (s[this.i] === "'") {
              if (s[this.i + 1] === "'") {
                text += "'";
                this.i += 2;
                continue;
              }
              this.i++;
              break;
            }
            text += s[this.i++];
          }
        } else {
          text += "'";
          this.i++;
        }
      } else if (c === '{') {
        flush();
        out.push(this.argument(inPlural));
      } else if (c === '}') {
        if (!nested) this.fail("Unmatched '}'");
        break;
      } else if (c === '#' && inPlural) {
        flush();
        out.push({ k: 'pound' });
        this.i++;
      } else {
        text += c;
        this.i++;
      }
    }
    flush();
    return out;
  }

  space(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  word(): string {
    this.space();
    const start = this.i;
    while (this.i < this.s.length && /[^\s{},]/.test(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }

  expect(c: string): void {
    this.space();
    if (this.s[this.i] !== c) this.fail(`Expected '${c}'`);
    this.i++;
  }

  argument(inPlural: boolean): Part {
    this.i++; // {
    const name = this.word();
    if (!name) this.fail('Missing argument name');
    this.space();
    if (this.s[this.i] === '}') {
      this.i++;
      return { k: 'arg', name };
    }
    this.expect(',');
    const type = this.word();
    this.space();
    if (type === 'number' || type === 'date' || type === 'time') {
      let style = '';
      if (this.s[this.i] === ',') {
        this.i++;
        const end = this.s.indexOf('}', this.i);
        if (end < 0) this.fail("Missing '}'");
        style = this.s.slice(this.i, end).trim();
        this.i = end;
      }
      this.expect('}');
      return { k: type, name, style };
    }
    if (type !== 'plural' && type !== 'selectordinal' && type !== 'select') this.fail(`Unknown argument type '${type}'`);
    this.expect(',');
    let offset = 0;
    const options: Record<string, Part[]> = {};
    for (;;) {
      this.space();
      if (this.s[this.i] === '}') {
        this.i++;
        break;
      }
      if (this.i >= this.s.length) this.fail("Missing '}'");
      const selector = this.word();
      if (!selector) this.fail('Missing selector');
      if (type !== 'select' && selector.startsWith('offset:')) {
        offset = Number(selector.slice(7));
        continue;
      }
      this.expect('{');
      options[selector] = this.message(type === 'select' ? inPlural : type === 'plural' || type === 'selectordinal', true);
      if (this.s[this.i] !== '}') this.fail("Missing '}'");
      this.i++;
    }
    if (!options.other) this.fail(`'${type}' needs an 'other' case`);
    return type === 'select' ? { k: 'select', name, options } : { k: type, name, offset, options };
  }
}

const parsed = new Map<string, Part[]>();

function parse(pattern: string): Part[] {
  let p = parsed.get(pattern);
  if (!p) {
    p = new Parser(pattern).message(false, false);
    parsed.set(pattern, p);
  }
  return p;
}

/** Throws MessageSyntaxError when `pattern` isn't valid ICU (the i18n check runs every message through this). */
export function validateMessage(pattern: string): void {
  new Parser(pattern).message(false, false);
}

/** The argument names a message uses (for checking that a translation keeps them). */
export function messageArguments(pattern: string): string[] {
  const names = new Set<string>();
  const walk = (parts: Part[]) => {
    for (const p of parts) {
      if (typeof p === 'string' || p.k === 'pound') continue;
      names.add(p.name);
      if (p.k === 'plural' || p.k === 'selectordinal' || p.k === 'select') for (const o of Object.values(p.options)) walk(o);
    }
  };
  walk(new Parser(pattern).message(false, false));
  return [...names].sort();
}

const intlCache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  let v = intlCache.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    intlCache.set(key, v);
  }
  return v;
}

export const numberFormat = (locale: string, opts: Intl.NumberFormatOptions = {}): Intl.NumberFormat =>
  cached(`n|${locale}|${JSON.stringify(opts)}`, () => new Intl.NumberFormat(locale, opts));
export const dateFormat = (locale: string, opts: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat =>
  cached(`d|${locale}|${JSON.stringify(opts)}`, () => new Intl.DateTimeFormat(locale, opts));
const pluralRules = (locale: string, type: Intl.PluralRuleType): Intl.PluralRules =>
  cached(`p|${locale}|${type}`, () => new Intl.PluralRules(locale, { type }));

const NUMBER_STYLES: Record<string, Intl.NumberFormatOptions> = {
  integer: { maximumFractionDigits: 0 },
  percent: { style: 'percent' },
  compact: { notation: 'compact' },
};
const DATE_STYLES = new Set(['short', 'medium', 'long', 'full']);

function toDate(v: MessageValue): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function render(locale: string, parts: Part[], vars: MessageVars, plural: number | null): string {
  let out = '';
  for (const p of parts) {
    if (typeof p === 'string') {
      out += p;
      continue;
    }
    if (p.k === 'pound') {
      out += plural === null ? '#' : numberFormat(locale).format(plural);
      continue;
    }
    const v = vars[p.name];
    switch (p.k) {
      case 'arg':
        out += v === undefined || v === null ? '' : typeof v === 'number' ? numberFormat(locale).format(v) : v instanceof Date ? dateFormat(locale, { dateStyle: 'medium' }).format(v) : String(v);
        break;
      case 'number':
        out += typeof v === 'number' ? numberFormat(locale, NUMBER_STYLES[p.style] ?? {}).format(v) : String(v ?? '');
        break;
      case 'date':
      case 'time': {
        const d = toDate(v);
        const style = (DATE_STYLES.has(p.style) ? p.style : p.k === 'date' ? 'medium' : 'short') as 'short';
        out += d ? dateFormat(locale, p.k === 'date' ? { dateStyle: style } : { timeStyle: style }).format(d) : '';
        break;
      }
      case 'select':
        out += render(locale, p.options[String(v)] ?? p.options.other, vars, plural);
        break;
      case 'plural':
      case 'selectordinal': {
        const n = Number(v);
        const value = Number.isFinite(n) ? n : 0;
        const exact = p.options[`=${value}`];
        const category = pluralRules(locale, p.k === 'plural' ? 'cardinal' : 'ordinal').select(value - p.offset);
        out += render(locale, exact ?? p.options[category] ?? p.options.other, vars, value - p.offset);
        break;
      }
    }
  }
  return out;
}

/**
 * Formats an ICU message in `locale`. A message that doesn't parse is returned as it is (the i18n
 * check keeps those out of the catalogues; a broken translation must not break the page).
 */
export function formatMessage(locale: string, pattern: string, vars: MessageVars = {}): string {
  let parts: Part[];
  try {
    parts = parse(pattern);
  } catch {
    return pattern;
  }
  return render(locale, parts, vars, null);
}
