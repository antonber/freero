// The app's side of Google Analytics (GA_MEASUREMENT_ID; ARCHITECTURE.md "Analytics"). Google's
// tag never runs in the app's own document — that document holds board titles, content, names and
// links Google's automatic measurements would read (outbound clicks, file downloads, the tab
// title). It runs in a hidden same-origin frame (/analytics-frame) that this bridge creates on the
// first page reported (unless this browser opted out or sends GPC / Do Not Track), and feeds with
// the redacted page (@freero/shared `analyticsPage`) and the allowed events
// (`analyticsEventParams`) only.
//
// Product events (PostHog, POSTHOG_KEY) are the server's: the bridge only reports what the server
// can't see (CLIENT_PRODUCT_EVENTS, POST /api/analytics/events) and records a signed-in person's
// opt-out — including one their browser signals with GPC / Do Not Track — on their account.
import { useSyncExternalStore } from 'react';
import { analyticsEventParams, analyticsPage, campaignQuery, type AnalyticsEvent, type AnalyticsSettings, type ClientProductEvent } from '@freero/shared';
import {
  analyticsAllowed,
  analyticsState,
  onAnalyticsChange,
  optedOut,
  originReferrer,
  privacySignal,
  setOptedOut,
  syncOptOutCookie,
  type AnalyticsState,
  type FrameMessage,
  type PageFields,
} from './runtime';

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
/** The account whose opt-out was recorded in this page (once per account). */
let recordedFor: string | null = null;
let signedIn: string | null = null;

/** Starts the bridge once: asks the server whether this instance measures, and follows the visitor's opt-out. */
export function startAppAnalytics(): void {
  if (started) return;
  started = true;
  syncOptOutCookie(); // an opt-out from before the cookie existed
  fetch('/api/analytics', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<AnalyticsSettings>) : null))
    .catch(() => null)
    .then((s) => {
      settings = s ?? { enabled: false, productAnalytics: false };
      for (const l of listeners) l();
      recordAccountOptOut();
      const waiting = early;
      early = [];
      if (!settings.enabled) return;
      for (const m of waiting) send(m);
    });
  unlisten = onAnalyticsChange(() => {
    for (const l of listeners) l();
    if (analyticsAllowed()) {
      // Turned back on: the page they are on is measured again.
      if (current) send({ freeroAnalytics: 1, kind: 'page', fields: current });
    } else dropFrame();
  });
}

/** Test seam: forget everything (settings, frame, pages). */
export function resetAppAnalytics(): void {
  unlisten?.();
  unlisten = null;
  dropFrame();
  settings = null;
  early = [];
  current = null;
  currentPath = null;
  previous = '';
  started = false;
  recordedFor = null;
  signedIn = null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
/** Analytics in this browser ('on', 'off', 'signal'), or null where this server doesn't measure (no control then). */
export const useAnalyticsState = (): AnalyticsState | null =>
  useSyncExternalStore(subscribe, () => (settings?.enabled || settings?.productAnalytics ? analyticsState() : null));

/** "Turn off / on analytics" (the Help menu): flips this browser's opt-out; a GPC / Do Not Track signal can't be overridden here. */
export function toggleAnalytics(): void {
  if (!privacySignal()) setOptedOut(!optedOut());
}

/** The router's location: reports the page (redacted), or nothing on routes analytics never covers. */
export function reportPage(pathname: string, search: string): void {
  if (pathname === currentPath) return; // the same page with another query (?dock=…, a board's own state)
  currentPath = pathname;
  const page = analyticsPage(pathname);
  if (!page) {
    current = null;
    return;
  }
  const location = `${window.location.origin}${page.path}${campaignQuery(search)}`;
  current = { page_location: location, page_title: page.title, page_referrer: previous || originReferrer(document.referrer) };
  previous = location;
  send({ freeroAnalytics: 1, kind: 'page', fields: current });
}

/** A product event (Host.track, the auth flows, board creation). Values an event may not carry are dropped. */
export function track(event: AnalyticsEvent): void {
  if (event.name === 'template_used') reportProductEvent({ name: 'template_used', template: event.template });
  const params = analyticsEventParams(event);
  if (!params || !current) return;
  send({ freeroAnalytics: 1, kind: 'event', fields: current, name: event.name, params });
}

/** One of the events only the app sees, to the server's product analytics (it checks it against the closed list). */
function reportProductEvent(event: ClientProductEvent): void {
  if (!settings?.productAnalytics || !signedIn || !analyticsAllowed()) return;
  void fetch('/api/analytics/events', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => undefined);
}

/**
 * Who is signed in (AppAnalytics). A browser that opted out or sends GPC / Do Not Track records
 * that on the account, so the server stops counting it wherever it acts from; only turning
 * analytics back on (toggleAnalytics) clears it.
 */
export function noteSignedIn(userId: string | null): void {
  signedIn = userId;
  recordAccountOptOut();
}

function recordAccountOptOut(): void {
  if (!settings?.productAnalytics || !signedIn || recordedFor === signedIn || analyticsState() === 'on') return;
  recordedFor = signedIn;
  void fetch('/api/analytics/opt-out', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optedOut: true }),
  }).catch(() => undefined);
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
