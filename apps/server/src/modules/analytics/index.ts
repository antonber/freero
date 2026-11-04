// Google Analytics 4 (GA_MEASUREMENT_ID; ARCHITECTURE.md "Analytics"). This module decides
// whether a page loads the analytics runtime (/analytics.js, built from the web app's
// app/analytics/runtime.ts) at all: with no id set nothing here exists — no script tag, no frame,
// no loader, no CSP change — so a self-hosted server sends nobody to Google.
import type { Config } from '../../platform/config';

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

/** `html` with the runtime added at the end of its head (unchanged without GA_MEASUREMENT_ID). */
export function withAnalyticsRuntime(html: string, config: Config): string {
  const tag = analyticsScriptTag(config);
  return tag ? html.replace('</head>', `${tag}</head>`) : html;
}
