// Analytics (ARCHITECTURE.md "Analytics"), both off unless the operator sets them:
// - Google Analytics 4 (GA_MEASUREMENT_ID). This module decides whether a page loads the analytics
//   runtime (/analytics.js, built from the web app's app/analytics/runtime.ts) at all: with no id
//   set nothing here exists — no script tag, no frame, no loader, no CSP change — so a
//   self-hosted server sends nobody to Google.
// - PostHog product events (POSTHOG_KEY), sent by the server only (productEvents.ts). The module
//   that is the single writer of a fact counts it with trackProductEvent.
import type { Config } from '../../platform/config';

export { trackProductEvent, productAnalyticsOn, trackAgentFetch, type AgentFetchVia } from './productEvents';
export { mcpAnalyticsFor, MCP_FAILURE_META, type McpFailure } from './mcpAnalytics';
// For tests of the modules that count (a stand-in PostHog: start the client, flush, read pseudonyms).
export { startProductAnalytics, stopProductAnalytics, flushProductEvents, pseudonym, setAccountOptedOut } from './productEvents';

/** Where the runtime is served from (the web build writes it there). */
export const RUNTIME_PATH = '/analytics.js';
/** The app's analytics frame: the only document of the app in which Google's script runs. */
export const FRAME_PATH = '/analytics-frame';

/**
 * The runtime's script tag for a marketing page (Google's script unless this browser opted out),
 * or '' without GA_MEASUREMENT_ID. Same-origin and `defer`: the page's `script-src 'self'` lets it
 * run.
 */
export function analyticsScriptTag(config: Config, mode: 'site' | 'frame' = 'site'): string {
  const id = config.googleAnalyticsId;
  if (!id) return '';
  // The id is checked against /^G-[A-Z0-9]+$/ when the config loads: nothing to escape.
  return `<script src="${RUNTIME_PATH}" data-freero-ga="${id}"${mode === 'frame' ? ' data-mode="frame"' : ' defer'}></script>`;
}

/** Where the marketing pages' PostHog runtime is served from (the web build writes it there; POSTHOG_BROWSER). */
export const POSTHOG_RUNTIME_PATH = '/posthog.js';

/** The PostHog runtime's script tag for a marketing page, or '' unless POSTHOG_BROWSER is on. */
export function posthogScriptTag(config: Config): string {
  const ph = config.posthog;
  if (!ph?.browser) return '';
  // The key is checked against /^phc_[A-Za-z0-9]+$/ and the hosts are https URLs: nothing to escape but quotes, which they can't hold.
  return `<script src="${POSTHOG_RUNTIME_PATH}" data-freero-ph-key="${ph.key}" data-freero-ph-host="${ph.browserHost}" data-freero-ph-ui="${ph.uiHost}" defer></script>`;
}

/** `html` with the runtimes added at the end of its head (unchanged without GA_MEASUREMENT_ID or POSTHOG_BROWSER). */
export function withAnalyticsRuntime(html: string, config: Config): string {
  const tag = analyticsScriptTag(config) + posthogScriptTag(config);
  return tag ? html.replace('</head>', `${tag}</head>`) : html;
}
