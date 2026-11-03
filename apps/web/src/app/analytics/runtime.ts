// The Google Analytics runtime (GA_MEASUREMENT_ID; ARCHITECTURE.md "Analytics"): the consent
// choice, the consent banner and Google's tag. One self-contained file — NO imports — because it
// is built on its own into dist/analytics.js (vite.config `freero-analytics`), which the server
// adds to marketing pages and to the app's hidden analytics frame; the app imports the same
// functions for its bridge (./bridge.ts).
//
// The rules it enforces:
// - Nothing from Google loads before the visitor chooses "Accept" (Consent Mode v2, every type
//   denied by default; analytics_storage is granted only by that choice, the three ad types never).
// - Global Privacy Control or Do Not Track count as "Decline": no banner asking, no script.
// - "Decline", or withdrawing later, deletes Google's cookies; a choice is asked again after 6 months.
// - Pages pass the address and title to report (page_location / page_title / page_referrer); the
//   tag never falls back to the document's own (a board's tab shows its title).

export type Choice = 'granted' | 'denied';

/** Where the choice is kept (this origin's local storage, shared by the site and the app). */
export const CONSENT_KEY = 'freero:analytics-consent';
/** A choice older than this is asked again. */
export const CONSENT_MAX_AGE_MS = 180 * 86_400_000;
/** Google's cookies last at most this long (13 months). */
const COOKIE_SECONDS = 395 * 86_400;
const CHANGE_EVENT = 'freero:analytics-consent';
const GTAG_ORIGIN = 'https://www.googletagmanager.com';

// ---- The choice ------------------------------------------------------------------------------

/** The browser asks sites not to track (Global Privacy Control, Do Not Track): treated as "Decline". */
export function privacySignal(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const w = window as Window & { doNotTrack?: string };
  return n.globalPrivacyControl === true || n.doNotTrack === '1' || n.doNotTrack === 'yes' || n.msDoNotTrack === '1' || w.doNotTrack === '1';
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // storage blocked: no choice is remembered, so nothing is ever granted
  }
}

/** The visitor's choice in this browser, or null when there is none (or it is older than 6 months). */
export function storedChoice(now = Date.now()): Choice | null {
  try {
    const raw = store()?.getItem(CONSENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { choice?: unknown; at?: unknown };
    if ((v.choice !== 'granted' && v.choice !== 'denied') || typeof v.at !== 'number') return null;
    return v.at <= now && now - v.at < CONSENT_MAX_AGE_MS ? v.choice : null;
  } catch {
    return null;
  }
}

/** Measuring is allowed: the visitor accepted (within 6 months) and the browser sends no opt-out signal. */
export const analyticsAllowed = (): boolean => !privacySignal() && storedChoice() === 'granted';

/** Records a choice; "denied" also deletes Google's cookies. Every page of this origin hears of it. */
export function saveChoice(choice: Choice, now = Date.now()): void {
  try {
    store()?.setItem(CONSENT_KEY, JSON.stringify({ choice, at: now }));
  } catch {
    // not remembered: the banner asks again next time
  }
  if (choice === 'denied') clearAnalyticsCookies();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Calls `cb` when the choice changes here or in another tab (or the analytics frame). */
export function onConsentChange(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === CONSENT_KEY) cb();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

/** Deletes Google Analytics' cookies (`_ga`, `_ga_<id>`, legacy `_gid` / `_gat`) on this host and its parent domains. */
export function clearAnalyticsCookies(): void {
  const names = document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter((n) => n === '_ga' || n.startsWith('_ga_') || n === '_gid' || n === '_gat' || n.startsWith('_gat_'));
  if (!names.length) return;
  const parts = location.hostname.split('.');
  const domains = [''];
  for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join('.')}`);
  for (const n of names) for (const d of domains) document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
}

// ---- What a page reports -----------------------------------------------------------------------

export interface PageFields {
  page_location: string;
  page_title: string;
  page_referrer: string;
}

/** A referrer reduced to its origin ('' when there is none): never another page's path or query. */
export function originReferrer(ref: string): string {
  try {
    return ref ? `${new URL(ref).origin}/` : '';
  } catch {
    return '';
  }
}

/** The query reduced to UTM campaign tags. Keep in step with @freero/shared `campaignQuery` (this file has no imports). */
function campaign(search: string): string {
  const kept = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(search)) if (/^utm_(source|medium|campaign|term|content|id)$/.test(k)) kept.append(k, v.slice(0, 100));
  const q = kept.toString();
  return q ? `?${q}` : '';
}

/** A marketing page as reported: its public address (no query but campaign tags) and its own title. */
export function sitePage(): PageFields {
  return { page_location: `${location.origin}${location.pathname}${campaign(location.search)}`, page_title: document.title, page_referrer: originReferrer(document.referrer) };
}

// ---- Google's tag ------------------------------------------------------------------------------

type Gtag = (...args: unknown[]) => void;
type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

/** Starts Google's tag once in this document (after consent only), reporting `fields` until told otherwise. */
export function startGtag(id: string, fields: PageFields): Gtag {
  const w = window as GtagWindow;
  if (w.gtag) return w.gtag;
  const dataLayer = (w.dataLayer = w.dataLayer ?? []);
  // gtag.js reads `arguments` objects from the data layer, as Google's snippet pushes them.
  const gtag: Gtag = function () {
    dataLayer.push(arguments);
  };
  w.gtag = gtag;
  const noSignals = { allow_google_signals: false, allow_ad_personalization_signals: false };
  gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('consent', 'update', { analytics_storage: 'granted' });
  gtag('set', 'ads_data_redaction', true);
  gtag('set', { ...fields, ...noSignals });
  gtag('js', new Date());
  gtag('config', id, {
    ...fields,
    ...noSignals,
    send_page_view: false,
    cookie_expires: COOKIE_SECONDS,
    cookie_flags: location.protocol === 'https:' ? 'SameSite=Lax;Secure' : 'SameSite=Lax',
  });
  const s = document.createElement('script');
  s.async = true;
  s.src = `${GTAG_ORIGIN}/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(s);
  return gtag;
}

/** Stops measuring in this document (the visitor declined after accepting) and deletes the cookies. */
export function stopGtag(): void {
  (window as GtagWindow).gtag?.('consent', 'update', { analytics_storage: 'denied' });
  clearAnalyticsCookies();
}

// ---- The consent banner ------------------------------------------------------------------------

const STYLE_ID = 'fr-consent-style';
// Freero's tokens (ui/tokens.css; the site inlines them too), with their light values as fallbacks.
const CSS = `
.fr-consent{position:fixed;z-index:70;left:16px;bottom:16px;box-sizing:border-box;width:min(400px,calc(100vw - 32px));padding:16px 16px 14px;background:var(--fr-surface,#fff);color:var(--fr-ink,#17162b);border:1px solid var(--fr-line,#e4e3ee);border-radius:var(--fr-radius-lg,14px);box-shadow:var(--fr-shadow-lg,0 12px 32px rgba(23,22,43,.16));font:14px/1.5 var(--fr-font,'Inter',system-ui,sans-serif);text-align:left}
.fr-consent__title{display:block;margin:0 28px 4px 0;font-size:15px;font-weight:600}
.fr-consent__text{margin:0 0 12px;color:var(--fr-ink-2,#4b4a63)}
.fr-consent__text a{color:var(--fr-primary,#5b3ff0)}
.fr-consent__actions{display:flex;gap:8px}
.fr-consent__btn{flex:1 1 0;min-height:38px;padding:0 14px;border:1px solid var(--fr-line-strong,#cfcde0);border-radius:var(--fr-radius,10px);background:var(--fr-surface,#fff);color:var(--fr-ink,#17162b);font:inherit;font-weight:600;cursor:pointer}
.fr-consent__btn:hover{background:var(--fr-surface-2,#f7f6fb)}
.fr-consent__btn:focus-visible,.fr-consent__close:focus-visible,.fr-consent__text a:focus-visible{outline:2px solid var(--fr-primary,#5b3ff0);outline-offset:2px}
.fr-consent__close{position:absolute;top:8px;right:8px;width:32px;height:32px;border:0;border-radius:var(--fr-radius-sm,6px);background:none;color:var(--fr-ink-3,#686783);font:20px/1 var(--fr-font,system-ui,sans-serif);cursor:pointer}
.fr-consent__close:hover{background:var(--fr-surface-2,#f7f6fb)}
@media (max-width:480px){.fr-consent{left:8px;bottom:8px;width:calc(100vw - 16px)}}
@media print{.fr-consent{display:none}}
`;

export interface BannerOptions {
  /** 'ask': no choice yet (it stays until one is made); 'settings': opened to change it (focused, closable). */
  mode: 'ask' | 'settings';
  /** The privacy policy (null: none on this server). */
  privacyUrl: string | null;
  /** Gets focus back when a settings banner closes. */
  opener?: HTMLElement | null;
}

let banner: { el: HTMLElement; mode: BannerOptions['mode']; opener: HTMLElement | null; onKey: (e: KeyboardEvent) => void } | null = null;

/** The banner on screen ('ask' / 'settings'), or null. */
export const consentBannerMode = (): BannerOptions['mode'] | null => banner?.mode ?? null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Shows the consent banner (replacing one already shown). Accept and Decline look and weigh the same. */
export function openConsentBanner(opts: BannerOptions): void {
  closeConsentBanner(false);
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  const signal = privacySignal();
  const current = storedChoice();
  const root = el('section', 'fr-consent');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-labelledby', 'fr-consent-title');
  const title = el('strong', 'fr-consent__title', 'Analytics cookies');
  title.id = 'fr-consent-title';
  const text = el('p', 'fr-consent__text');
  text.append(
    signal
      ? 'Your browser asks sites not to track you (Global Privacy Control or Do Not Track), so Freero keeps Google Analytics off. '
      : 'May Freero use Google Analytics cookies to count visits and see which pages help? It counts pages and a few actions, never what is on your boards, and stays off unless you accept. ',
  );
  if (!signal && opts.mode === 'settings' && current) text.append(current === 'granted' ? 'You have accepted. ' : 'You have declined. ');
  if (opts.privacyUrl) {
    const a = el('a', '', 'Privacy policy');
    a.href = `${opts.privacyUrl}#cookies`;
    text.append(a);
  }
  root.append(title, text);
  const choose = (choice: Choice) => {
    saveChoice(choice);
    closeConsentBanner();
  };
  const buttons: HTMLButtonElement[] = [];
  if (!signal) {
    const actions = el('div', 'fr-consent__actions');
    for (const [choice, label] of [
      ['denied', 'Decline'],
      ['granted', 'Accept'],
    ] as const) {
      const b = el('button', 'fr-consent__btn', label);
      b.type = 'button';
      b.dataset.choice = choice;
      b.addEventListener('click', () => choose(choice));
      buttons.push(b);
      actions.append(b);
    }
    root.append(actions);
  }
  if (opts.mode === 'settings' || signal) {
    const close = el('button', 'fr-consent__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => closeConsentBanner());
    root.append(close);
    buttons.push(close);
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && banner?.mode === 'settings' && root.contains(document.activeElement)) closeConsentBanner();
  };
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  banner = { el: root, mode: opts.mode, opener: opts.opener ?? null, onKey };
  // Asked on arrival, the banner waits without taking focus; opened on purpose, it gets it.
  if (opts.mode === 'settings') buttons[0]?.focus();
}

export function closeConsentBanner(restoreFocus = true): void {
  if (!banner) return;
  const { el: root, opener, onKey } = banner;
  banner = null;
  document.removeEventListener('keydown', onKey);
  root.remove();
  if (restoreFocus && opener?.isConnected) opener.focus();
}

// ---- The two ways the built file runs ----------------------------------------------------------

/** What the app's bridge posts to the analytics frame. */
export interface FrameMessage {
  freeroAnalytics: 1;
  kind: 'page' | 'event';
  fields: PageFields;
  name?: string;
  params?: Record<string, string>;
}

/**
 * A marketing page: the banner when there is no choice yet, Google's tag once accepted, "Cookie
 * settings" links (`[data-freero-cookie-settings]`, hidden in the build) shown and wired.
 */
export function startSite(id: string): void {
  let started = false;
  const begin = () => {
    if (started || !analyticsAllowed()) return;
    started = true;
    const fields = sitePage();
    startGtag(id, fields)('event', 'page_view', fields);
  };
  if (!analyticsAllowed()) clearAnalyticsCookies();
  for (const b of document.querySelectorAll<HTMLElement>('[data-freero-cookie-settings]')) b.closest('[hidden]')?.removeAttribute('hidden');
  document.addEventListener('click', (e) => {
    const link = (e.target as Element | null)?.closest?.<HTMLElement>('[data-freero-cookie-settings]');
    if (!link) return;
    e.preventDefault();
    openConsentBanner({ mode: 'settings', privacyUrl: '/privacy', opener: link });
  });
  onConsentChange(() => {
    if (analyticsAllowed()) begin();
    else if (started) stopGtag();
  });
  if (!privacySignal() && storedChoice() === null) openConsentBanner({ mode: 'ask', privacyUrl: '/privacy' });
  begin();
}

/**
 * The app's analytics frame (/analytics-frame): Google's tag runs here, fed only the redacted
 * pages and events the app's bridge posts, so it never sees the app's own document.
 */
export function startFrame(id: string): void {
  window.addEventListener('message', (e: MessageEvent<FrameMessage>) => {
    if (e.origin !== location.origin || e.source !== window.parent || e.data?.freeroAnalytics !== 1) return;
    if (!analyticsAllowed()) return; // checked here too: the frame may outlive a choice made elsewhere
    const { kind, fields, name, params } = e.data;
    const gtag = startGtag(id, fields);
    gtag('set', fields);
    if (kind === 'page') gtag('event', 'page_view', fields);
    else if (kind === 'event' && typeof name === 'string') gtag('event', name, { ...params });
  });
  onConsentChange(() => {
    if (!analyticsAllowed()) stopGtag();
  });
}

// Run when loaded as /analytics.js (`<script data-freero-ga="G-…">`); imported by the app, it does nothing.
const script = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
const gaId = script?.dataset.freeroGa;
if (gaId) (script?.dataset.mode === 'frame' ? startFrame : startSite)(gaId);
