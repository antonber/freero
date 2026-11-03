// The app's colour theme: the ONLY writer of <html data-theme> (ui/tokens.css and the board's
// canvas treatment, engine/canvas/theme.ts, follow it). A person picks System, Light or Dark; the
// choice is kept with their account (`Account.theme`, PATCH /api/auth/me) so it follows them, and in
// this browser so the first paint is already right and people without an account keep theirs.
// A page that must follow its surroundings instead (the live board view inside an AI assistant)
// sets an override for as long as it is mounted.
import { useSyncExternalStore } from 'react';
import { COLOR_THEME_PREFERENCES, type ColorThemePreference } from '@freero/shared';

export type ColorTheme = 'light' | 'dark';

const KEY = 'freero:theme';
/** The browser-chrome colour (`<meta name="theme-color">`) per theme: the brand on light, the canvas on dark. */
const CHROME: Record<ColorTheme, string> = { light: '#5b3ff0', dark: '#15141f' };

const isPreference = (v: unknown): v is ColorThemePreference => COLOR_THEME_PREFERENCES.includes(v as ColorThemePreference);

function stored(): ColorThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return isPreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

let preference: ColorThemePreference = stored();
let override: ColorTheme | null = null;
const listeners = new Set<() => void>();
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** What `pref` shows right now (System: the device's setting). */
export function resolveTheme(pref: ColorThemePreference, deviceDark = !!media?.matches): ColorTheme {
  return pref === 'system' ? (deviceDark ? 'dark' : 'light') : pref;
}

function apply(): void {
  if (typeof document === 'undefined') return;
  const theme = override ?? resolveTheme(preference);
  const root = document.documentElement;
  if (root.getAttribute('data-theme') !== theme) root.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme]);
  for (const l of [...listeners]) l();
}

media?.addEventListener?.('change', () => {
  if (preference === 'system') apply();
});
// Another tab changed it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    preference = stored();
    apply();
  });
}
apply();

export function getThemePreference(): ColorThemePreference {
  return preference;
}

/** Changes the preference here (and in this browser's other tabs). The caller saves it to the account. */
export function setThemePreference(next: ColorThemePreference): void {
  if (!isPreference(next)) return;
  preference = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // private window: it still applies to this tab
  }
  apply();
}

/** While set, the page shows `theme` whatever the preference (null: back to the preference). */
export function setThemeOverride(theme: ColorTheme | null): void {
  override = theme;
  apply();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useThemePreference(): ColorThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, () => 'system');
}
