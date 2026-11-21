// PostHog in pages (POSTHOG_BROWSER; ARCHITECTURE.md "Analytics"): page views with their full
// address and title, page leaves, clicks (autocapture) and the page's errors (error tracking), on
// the marketing site (built alone into dist/posthog.js, vite.config `freero-posthog`) and in the
// app (this module, loaded lazily by AppAnalytics). Session replay stays off: it would record
// boards.
//
// Under the same rules as Google's tag (runtime.ts): nothing starts while this browser opted out or
// sends GPC / Do Not Track, turning analytics off stops it at once (opt_out_capturing), and the
// pages analytics never covers (the embeds, the Teams pages, the operator console, OAuth consent)
// send nothing. A signed-in person is identified by their account's pseudonym, which the server's
// product events use too — never their id, email or name.
import posthog from 'posthog-js';
import { analyticsAllowed, onAnalyticsChange } from './runtime';

/** Where analytics never runs (keep in step with @freero/shared analyticsPage's NEVER; this file is also built alone). */
const NEVER = /^\/(embed|teams|operator|oauth)(\/|$)/;

/** PostHog Cloud's app for an ingestion host (`us.i.posthog.com` → `us.posthog.com`), for a server that doesn't say (`uiHost`). */
const uiHostOf = (host: string): string => host.replace(/^https:\/\/(us|eu)\.i\.posthog\.com$/, 'https://$1.posthog.com');

let started = false;

/** Starts PostHog in this document unless this browser opted out (and starts it later if it turns analytics on). */
export function startPagePostHog(key: string, host: string, uiHost?: string): void {
  const begin = () => {
    if (!analyticsAllowed()) return;
    if (started) return void posthog.opt_in_capturing();
    started = true;
    posthog.init(key, {
      api_host: host,
      ui_host: uiHost ?? uiHostOf(host),
      capture_pageview: 'history_change',
      capture_pageleave: true,
      autocapture: true,
      capture_exceptions: true,
      disable_session_recording: true,
      person_profiles: 'identified_only',
      respect_dnt: true,
      before_send: (event) => (NEVER.test(location.pathname) ? null : event),
    });
  };
  begin();
  onAnalyticsChange(() => {
    if (analyticsAllowed()) begin();
    else if (started) posthog.opt_out_capturing();
  });
}

/** The signed-in account turned analytics off (GET /api/analytics offers no PostHog for it): capture stops here too. */
export function stopPagePostHog(): void {
  if (started) posthog.opt_out_capturing();
}

/** The signed-in account's pseudonym (GET /api/analytics), or null after signing out. */
export function identifyPagePostHog(distinctId: string | null): void {
  if (!started) return;
  if (distinctId) {
    if (posthog.get_distinct_id() !== distinctId) posthog.identify(distinctId);
  } else if (posthog.get_distinct_id() && posthog._isIdentified?.()) posthog.reset();
}

// Run when loaded as /posthog.js on a marketing page (`<script data-freero-ph-key=… data-freero-ph-host=… data-freero-ph-ui=…>`);
// imported by the app, it does nothing.
const script = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
if (script?.dataset.freeroPhKey && script.dataset.freeroPhHost) startPagePostHog(script.dataset.freeroPhKey, script.dataset.freeroPhHost, script.dataset.freeroPhUi);
