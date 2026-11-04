// The page's interface language (docs/design/i18n.md): the ONLY writer of <html lang dir> and of
// the language this browser remembers. It is decided once, before the app's modules load
// (main.tsx), and fixed for the life of the page; choosing another language saves it and reloads.
//
// Order: ?lang= (this tab only) > the account's language > this browser's last > the browser's
// languages > English.
import { DEFAULT_LOCALE, isLocale, isRtlLocale, negotiateLocale, type Locale } from '@freero/shared';
import { getLocale, installLocale } from '@ui';
import { loadCatalogs } from './catalogs';

const STORED = 'freero:locale';
/** A ?lang= choice, kept for this tab while it navigates (sessionStorage), never saved to the account. */
const TAB = 'freero:locale-tab';
/** Set while a reload to the account's language is under way, so a mismatch can't loop. */
const ADOPTING = 'freero:locale-adopting';

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}
function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // no storage (private window, partitioned frame): the choice lasts for this page
  }
}
const local = () => localStorage;
const session = () => sessionStorage;

export interface LocaleInputs {
  /** The page's ?lang= value, if any. */
  query: string | null;
  /** A ?lang= choice made earlier in this tab. */
  tab: string | null;
  /** What this browser showed last. */
  stored: string | null;
  /** navigator.languages */
  browser: readonly string[];
}

/** Picks the language from what the page knows before the account loads (pure). */
export function chooseLocale(i: LocaleInputs): { locale: Locale; fromTab: boolean } {
  const asked = i.query ? negotiateLocale([i.query]) : null;
  if (asked) return { locale: asked, fromTab: true };
  if (isLocale(i.tab)) return { locale: i.tab, fromTab: true };
  if (isLocale(i.stored)) return { locale: i.stored, fromTab: false };
  return { locale: negotiateLocale(i.browser) ?? DEFAULT_LOCALE, fromTab: false };
}

let fromTab = false;

function applyDocument(locale: Locale): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = locale;
  root.dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
}

/** Decides the language, loads its translations and installs them. main.tsx awaits this before importing the app. */
export async function bootLocale(): Promise<Locale> {
  const params = new URLSearchParams(location.search);
  const choice = chooseLocale({
    query: params.get('lang'),
    tab: read(session, TAB),
    stored: read(local, STORED),
    browser: typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [],
  });
  fromTab = choice.fromTab;
  if (fromTab) write(session, TAB, choice.locale);
  write(session, ADOPTING, null);
  let catalogs = {};
  if (choice.locale !== DEFAULT_LOCALE) {
    try {
      catalogs = await loadCatalogs(choice.locale);
    } catch {
      // A chunk that didn't load (offline, a deploy replaced it): English, rather than no page.
    }
  }
  installLocale(choice.locale, catalogs);
  applyDocument(choice.locale);
  return choice.locale;
}

/**
 * Called when the account is known. An account without a language gets the one this page shows
 * (`save` stores it, once); one whose language differs from the page's (changed on another
 * device) is adopted with one reload — unless this tab asked for another with ?lang=.
 */
export function adoptAccountLocale(accountLocale: string | null | undefined, save: (locale: Locale) => void): void {
  const current = getLocale();
  if (!isLocale(accountLocale)) {
    save(current);
    return;
  }
  if (fromTab || accountLocale === current) {
    if (!fromTab) write(local, STORED, accountLocale);
    return;
  }
  if (read(session, ADOPTING)) return;
  write(local, STORED, accountLocale);
  write(session, ADOPTING, '1');
  location.reload();
}

/**
 * Switches the interface to `next`: remembers it in this browser, drops a ?lang= choice of this
 * tab, and reloads once `persist` (saving it to the account, when signed in) has finished.
 */
export async function switchLocale(next: Locale, persist?: (locale: Locale) => Promise<unknown>): Promise<void> {
  if (!isLocale(next)) return;
  if (persist) await persist(next);
  write(local, STORED, next);
  write(session, TAB, null);
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.delete('lang');
    history.replaceState(history.state, '', url);
  }
  location.reload();
}
