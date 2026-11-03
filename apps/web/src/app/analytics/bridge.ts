// The app's side of Google Analytics (GA_MEASUREMENT_ID; ARCHITECTURE.md "Analytics"). Google's
// tag never runs in the app's own document — that document holds board titles, content, names and
// links Google's automatic measurements would read (outbound clicks, file downloads, the tab
// title). It runs in a hidden same-origin frame (/analytics-frame) that this bridge creates once
// the visitor accepts, and feeds with the redacted page (@freero/shared `analyticsPage`) and the
// allowed events (`analyticsEventParams`) only.
import { useSyncExternalStore } from 'react';
import { analyticsEventParams, analyticsPage, campaignQuery, type AnalyticsEvent, type AnalyticsSettings } from '@freero/shared';
import { analyticsAllowed, closeConsentBanner, consentBannerMode, onConsentChange, openConsentBanner, originReferrer, privacySignal, storedChoice, type FrameMessage, type PageFields } from './runtime';

const FRAME_PATH = '/analytics-frame';
/** A sign-in through a provider's pages: what was started, settled when the app is back (sessionStorage). */
const PENDING_SIGN_IN = 'freero:analytics-sign-in';

let settings: AnalyticsSettings | null = null;
const listeners = new Set<() => void>();
/** Messages from before the settings arrived (a sign-up on the first page). */
let early: FrameMessage[] = [];
/** The page being reported; null on routes analytics never covers (and before the first). */
let current: PageFields | null = null;
let currentPath: string | null = null;
let previous = '';
let frame: HTMLIFrameElement | null = null;
let ready = false;
let queue: FrameMessage[] = [];
let started = false;
let unlisten: (() => void) | null = null;

/** Starts the bridge once: asks the server whether this instance measures, and follows the visitor's choice. */
export function startAppAnalytics(): void {
  if (started) return;
  started = true;
  fetch('/api/analytics', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<AnalyticsSettings>) : null))
    .catch(() => null)
    .then((s) => {
      settings = s ?? { enabled: false, privacyUrl: null };
      for (const l of listeners) l();
      const waiting = early;
      early = [];
      if (!settings.enabled) return;
      for (const m of waiting) send(m);
      ask();
    });
  unlisten = onConsentChange(() => {
    if (analyticsAllowed()) {
      // Accepted: the page they accepted on is the first one measured.
      if (current) send({ freeroAnalytics: 1, kind: 'page', fields: current });
    } else dropFrame();
  });
}

/** Test seam: forget everything (settings, frame, pages). */
export function resetAppAnalytics(): void {
  unlisten?.();
  unlisten = null;
  dropFrame();
  closeConsentBanner(false);
  settings = null;
  early = [];
  current = null;
  currentPath = null;
  previous = '';
  started = false;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
/** This server measures with Google Analytics (for "Cookie settings" entries). */
export const useAnalyticsEnabled = (): boolean => useSyncExternalStore(subscribe, () => !!settings?.enabled);

/** The router's location: reports the page (redacted), or nothing on routes analytics never covers. */
export function reportPage(pathname: string, search: string): void {
  if (pathname === currentPath) return; // the same page with another query (?dock=…, a board's own state)
  currentPath = pathname;
  const page = analyticsPage(pathname);
  if (!page) {
    current = null;
    if (consentBannerMode() === 'ask') closeConsentBanner(false);
    return;
  }
  const location = `${window.location.origin}${page.path}${campaignQuery(search)}`;
  current = { page_location: location, page_title: page.title, page_referrer: previous || originReferrer(document.referrer) };
  previous = location;
  send({ freeroAnalytics: 1, kind: 'page', fields: current });
  ask();
}

/** A product event (Host.track, the auth flows, board creation). Values an event may not carry are dropped. */
export function track(event: AnalyticsEvent): void {
  const params = analyticsEventParams(event);
  if (!params || !current) return;
  send({ freeroAnalytics: 1, kind: 'event', fields: current, name: event.name, params });
}

/** "Cookie settings": the banner, to change the choice. */
export function openCookieSettings(opener?: HTMLElement | null): void {
  openConsentBanner({ mode: 'settings', privacyUrl: settings?.privacyUrl ?? null, opener });
}

/** A sign-in that leaves for a provider's pages (Google, Microsoft, SSO): counted when the app is back signed in. */
export function noteProviderSignIn(method: string): void {
  try {
    sessionStorage.setItem(PENDING_SIGN_IN, method);
  } catch {
    // not counted
  }
}

/** The provider sign-in noted in this tab, forgotten as it is read (a password sign-in clears it too). */
export function takeProviderSignIn(): string | null {
  try {
    const method = sessionStorage.getItem(PENDING_SIGN_IN);
    sessionStorage.removeItem(PENDING_SIGN_IN);
    return method;
  } catch {
    return null;
  }
}

/**
 * The session is known: a provider sign-in noted before counts once the app is back signed in — a
 * sign-up when the account is minutes old, else a login. Still signed out (two-step verification
 * next, or it failed): kept for completeTwoFactor, or cleared by the next password sign-in.
 */
export function settleProviderSignIn(user: { createdAt: number } | null, now = Date.now()): void {
  if (!user) return;
  const method = takeProviderSignIn();
  if (method) track({ name: now - user.createdAt < 15 * 60_000 ? 'sign_up' : 'login', method });
}

function ask(): void {
  if (settings?.enabled && current && !privacySignal() && storedChoice() === null && !consentBannerMode())
    openConsentBanner({ mode: 'ask', privacyUrl: settings.privacyUrl });
}

function send(m: FrameMessage): void {
  if (settings === null) return void early.push(m);
  if (!settings.enabled || !analyticsAllowed()) return;
  if (!frame) {
    const f = document.createElement('iframe');
    f.src = FRAME_PATH;
    f.title = 'Analytics';
    f.hidden = true;
    f.tabIndex = -1;
    f.setAttribute('aria-hidden', 'true');
    // The frame (and so Google's tag) learns only this origin, never the page that created it.
    f.referrerPolicy = 'origin';
    f.addEventListener('load', () => {
      if (frame !== f) return;
      ready = true;
      for (const q of queue) f.contentWindow?.postMessage(q, window.location.origin);
      queue = [];
    });
    frame = f;
    document.body.append(f);
  }
  if (ready) frame.contentWindow?.postMessage(m, window.location.origin);
  else queue.push(m);
}

function dropFrame(): void {
  frame?.remove();
  frame = null;
  ready = false;
  queue = [];
}
