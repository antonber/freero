// Server-side interface text (#5; docs/design/i18n.md): emails and notifications are worded on the
// server, in the recipient's language. A module binds its English messages once, next to them:
//
//   // modules/auth/messages.ts
//   import { defineMessages } from '../../platform/i18n';
//   import en from './locales/en.json';
//   export const t = defineMessages(import.meta.url, en);
//
//   t(account.locale, 'verify.subject', { name })
//
// Translations are `locales/<lang>.json` beside en.json, read once on first use. A language
// nobody chose (null) or a key a language lacks is English.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOCALE, formatMessage, isLocale, type Locale, type MessageVars } from '@freero/shared';

export type ServerTranslate<M extends Record<string, string>> = (locale: string | null | undefined, key: keyof M & string, vars?: MessageVars) => string;

/** The shipped language for a stored or requested value (anything else: English). */
export function localeOrDefault(locale: string | null | undefined): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function defineMessages<M extends Record<string, string>>(moduleUrl: string, en: M): ServerTranslate<M> {
  const dir = path.join(path.dirname(fileURLToPath(moduleUrl)), 'locales');
  const loaded = new Map<string, Record<string, string>>();
  const catalog = (locale: Locale): Record<string, string> => {
    let c = loaded.get(locale);
    if (!c) {
      try {
        c = JSON.parse(fs.readFileSync(path.join(dir, `${locale}.json`), 'utf8')) as Record<string, string>;
      } catch {
        c = {};
      }
      loaded.set(locale, c);
    }
    return c;
  };
  return (locale, key, vars) => {
    const l = localeOrDefault(locale);
    const translated = l === DEFAULT_LOCALE ? undefined : catalog(l)[key];
    return formatMessage(l, typeof translated === 'string' ? translated : (en[key] ?? key), vars);
  };
}
