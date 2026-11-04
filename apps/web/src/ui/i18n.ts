// The interface's message layer (#5; docs/design/i18n.md). Every owned unit (a feature, the
// engine, ui/, an app area) keeps its English messages in `<unit>/locales/en.json` and binds them
// once in its `messages.ts`:
//
//   export const t = defineMessages('features/voting', en);   // t('votesLeft', { count: 3 })
//
// The language is fixed for the life of a page: the app installs it (installLocale) before it
// imports anything that renders, so labels evaluated when a module loads are already translated.
// Changing the language reloads the page.
import { DEFAULT_LOCALE, dateFormat, formatMessage, isRtlLocale, numberFormat, type Locale, type MessageVars } from '@freero/shared';

export type Catalog = Record<string, string>;
/** A language's translations: namespace (unit path) → key → ICU message. */
export type Catalogs = Record<string, Catalog>;

let locale: Locale = DEFAULT_LOCALE;
let catalogs: Catalogs = {};

/** Installs the page's language and its translations. Called once by the app, before rendering. */
export function installLocale(next: Locale, translations: Catalogs = {}): void {
  locale = next;
  catalogs = translations;
}

/** The language the interface is shown in. */
export function getLocale(): Locale {
  return locale;
}

/** Is the interface right-to-left (Arabic, Hebrew)? */
export function isRtl(): boolean {
  return isRtlLocale(locale);
}

export type Translate<M extends Record<string, string>> = (key: keyof M & string, vars?: MessageVars) => string;

/**
 * Binds a unit's English messages. `ns` is the unit's path under src/ (`features/voting`,
 * `app/pages/dashboard`, `engine`, `ui`) — the i18n check holds it to that. Unknown keys fail the
 * typecheck; a translation missing for a key falls back to English.
 */
export function defineMessages<M extends Record<string, string>>(ns: string, en: M): Translate<M> {
  return (key, vars) => {
    const pattern = catalogs[ns]?.[key] ?? en[key] ?? key;
    return formatMessage(locale, pattern, vars);
  };
}

// ---- formatting in the page's language ----

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return numberFormat(locale, opts).format(n);
}

/** A date (and/or time) in the page's language; default: "Mar 4, 2026" in English. */
export function formatDate(d: Date | number, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return dateFormat(locale, opts).format(d);
}

export function formatTime(d: Date | number, opts: Intl.DateTimeFormatOptions = { timeStyle: 'short' }): string {
  return dateFormat(locale, opts).format(d);
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
/** "in 3 days", "5 minutes ago", "yesterday" (numeric: 'auto'). */
export function formatRelative(value: number, unit: Intl.RelativeTimeFormatUnit, opts: Intl.RelativeTimeFormatOptions = { numeric: 'auto' }): string {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = relativeFormats.get(key);
  if (!f) relativeFormats.set(key, (f = new Intl.RelativeTimeFormat(locale, opts)));
  return f.format(value, unit);
}

const listFormats = new Map<string, Intl.ListFormat>();
/** "Ann, Ben and Cleo" — or "Ann, Ben und Cleo". */
export function formatList(items: string[], type: Intl.ListFormatType = 'conjunction'): string {
  const key = `${locale}|${type}`;
  let f = listFormats.get(key);
  if (!f) listFormats.set(key, (f = new Intl.ListFormat(locale, { style: 'long', type })));
  return f.format(items);
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
/** "1.2 MB" in the page's language. */
export function formatBytes(bytes: number): string {
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return numberFormat(locale, { style: 'unit', unit: BYTE_UNITS[i], unitDisplay: 'short', maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v);
}
