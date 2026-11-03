// The Google Analytics runtime (GA_MEASUREMENT_ID; ARCHITECTURE.md "Analytics"): the visitor's
// opt-out and Google's tag. One self-contained file — NO imports — because it is built on its own
// into dist/analytics.js (vite.config `freero-analytics`), which the server adds to marketing
// pages and to the app's hidden analytics frame; the app imports the same functions for its
// bridge (./bridge.ts).
//
// The rules it enforces (the operator's decision: measured by default, no banner):
// - Analytics runs unless this browser opted out ("Turn off analytics": the site footer, the app's
//   Help menu, the privacy policy) or sends Global Privacy Control / Do Not Track.
// - Consent Mode v2: analytics_storage granted; ad_storage, ad_user_data and ad_personalization
//   always denied, Google signals and ad personalisation off.
// - Opting out deletes Google's cookies and is remembered in this browser until turned back on.
// - Pages pass the address and title to report (page_location / page_title / page_referrer); the
//   tag never falls back to the document's own (a board's tab shows its title).

/** Where the opt-out is kept (this origin's local storage, shared by the site and the app). */
export const OPT_OUT_KEY = 'freero:analytics-off';
/** Where the earlier consent banner kept its choice: a "denied" there still counts as opted out. */
const LEGACY_KEY = 'freero:analytics-consent';
/** Google's cookies last at most this long (13 months). */
const COOKIE_SECONDS = 395 * 86_400;
const CHANGE_EVENT = 'freero:analytics-change';
const GTAG_ORIGIN = 'https://www.googletagmanager.com';

// ---- On or off ---------------------------------------------------------------------------------

/** The browser asks sites not to track (Global Privacy Control, Do Not Track): analytics stays off. */
export function privacySignal(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const w = window as Window & { doNotTrack?: string };
  return n.globalPrivacyControl === true || n.doNotTrack === '1' || n.doNotTrack === 'yes' || n.msDoNotTrack === '1' || w.doNotTrack === '1';
}

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** This browser turned analytics off. */
export function optedOut(): boolean {
  try {
    const s = store();
    if (!s) return false;
    if (s.getItem(OPT_OUT_KEY) === '1') return true;
    const legacy = s.getItem(LEGACY_KEY);
    return !!legacy && (JSON.parse(legacy) as { choice?: unknown }).choice === 'denied';
  } catch {
    return false;
  }
}

/** 'on', 'off' (opted out here) or 'signal' (the browser's GPC / Do Not Track: off, and not ours to turn on). */
export type AnalyticsState = 'on' | 'off' | 'signal';
export const analyticsState = (): AnalyticsState => (privacySignal() ? 'signal' : optedOut() ? 'off' : 'on');

/** Measuring is allowed: no opt-out in this browser and no opt-out signal from it. */
export const analyticsAllowed = (): boolean => analyticsState() === 'on';

/** Turns analytics off (deleting Google's cookies) or back on for this browser; every page of this origin hears of it. */
export function setOptedOut(off: boolean): void {
  try {
    const s = store();
    if (off) s?.setItem(OPT_OUT_KEY, '1');
    else {
      s?.removeItem(OPT_OUT_KEY);
      s?.removeItem(LEGACY_KEY);
    }
  } catch {
    // not remembered
  }
  if (off) clearAnalyticsCookies();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Calls `cb` when the opt-out changes here or in another tab (or the analytics frame). */
export function onAnalyticsChange(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === OPT_OUT_KEY || e.key === LEGACY_KEY) cb();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

/** The words of an on/off control for the current state. */
export function toggleLabel(state: AnalyticsState = analyticsState()): string {
  return state === 'on' ? 'Turn off analytics' : state === 'off' ? 'Turn on analytics' : 'Analytics off (browser privacy signal)';
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

/** Starts Google's tag once in this document (unless opted out), reporting `fields` until told otherwise. */
export function startGtag(id: string, fields: PageFields): Gtag {
  const w = window as GtagWindow;
  if (w.gtag) {
    // Turned back on in this document after being turned off.
    w.gtag('consent', 'update', { analytics_storage: 'granted' });
    return w.gtag;
  }
  const dataLayer = (w.dataLayer = w.dataLayer ?? []);
  // gtag.js reads `arguments` objects from the data layer, as Google's snippet pushes them.
  const gtag: Gtag = function () {
    dataLayer.push(arguments);
  };
  w.gtag = gtag;
  const noSignals = { allow_google_signals: false, allow_ad_personalization_signals: false };
  gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
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

/** Stops measuring in this document (the visitor turned analytics off) and deletes the cookies. */
export function stopGtag(): void {
  (window as GtagWindow).gtag?.('consent', 'update', { analytics_storage: 'denied' });
  clearAnalyticsCookies();
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
 * A marketing page: Google's tag unless this browser opted out, and the on/off controls
 * (`[data-freero-analytics-toggle]`, hidden in the build: the site footer, the privacy policy)
 * shown, labelled with the current state and wired.
 */
export function startSite(id: string): void {
  let started = false;
  const begin = () => {
    if (!analyticsAllowed()) return;
    const fields = sitePage();
    const gtag = startGtag(id, fields);
    if (!started) gtag('event', 'page_view', fields);
    started = true;
  };
  const controls = () => document.querySelectorAll<HTMLElement>('[data-freero-analytics-toggle]');
  const label = () => {
    const state = analyticsState();
    for (const c of controls()) {
      c.textContent = toggleLabel(state);
      if (c instanceof HTMLButtonElement) c.disabled = state === 'signal';
    }
  };
  if (!analyticsAllowed()) clearAnalyticsCookies();
  for (const c of controls()) {
    c.closest('[hidden]')?.removeAttribute('hidden');
    c.addEventListener('click', (e) => {
      e.preventDefault();
      if (!privacySignal()) setOptedOut(!optedOut());
    });
  }
  label();
  onAnalyticsChange(() => {
    label();
    if (analyticsAllowed()) begin();
    else if (started) stopGtag();
  });
  begin();
}

/**
 * The app's analytics frame (/analytics-frame): Google's tag runs here, fed only the redacted
 * pages and events the app's bridge posts, so it never sees the app's own document.
 */
export function startFrame(id: string): void {
  window.addEventListener('message', (e: MessageEvent<FrameMessage>) => {
    if (e.origin !== location.origin || e.source !== window.parent || e.data?.freeroAnalytics !== 1) return;
    if (!analyticsAllowed()) return; // checked here too: the frame may outlive an opt-out made elsewhere
    const { kind, fields, name, params } = e.data;
    const gtag = startGtag(id, fields);
    gtag('set', fields);
    if (kind === 'page') gtag('event', 'page_view', fields);
    else if (kind === 'event' && typeof name === 'string') gtag('event', name, { ...params });
  });
  onAnalyticsChange(() => {
    if (!analyticsAllowed()) stopGtag();
  });
}

// Run when loaded as /analytics.js (`<script data-freero-ga="G-…">`); imported by the app, it does nothing.
const script = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
const gaId = script?.dataset.freeroGa;
if (gaId) (script?.dataset.mode === 'frame' ? startFrame : startSite)(gaId);
