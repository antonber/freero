// Google Analytics 4 for the hosted service (GA_MEASUREMENT_ID; ARCHITECTURE.md "Analytics"): what
// the app may tell it. The rule: Google learns which KIND of page someone is on and a few product
// events, never what is on a board or who the person is. So an app address is reported only as
// its route with every id and token taken out (/board/<id> → /board), with a generic title, and
// without its query string (UTM campaign tags excepted). Pure: used by the web app's bridge and
// its tests.
import { isDiscoverySource, type DiscoverySource } from './api';
import { integrationById } from './integrations';

/** What `GET /api/analytics` answers: whether this server measures with Google Analytics. */
export interface AnalyticsSettings {
  enabled: boolean;
}

/** A GA4 web stream's measurement id (`G-` and letters / digits). Universal Analytics ids (`UA-…`) stopped working in 2023. */
export const isGaMeasurementId = (id: string): boolean => /^G-[A-Z0-9]{4,20}$/.test(id);

/** Product events, each with only the parameters listed here (never a title, name, email or id). */
export type AnalyticsEvent =
  /**
   * `method`: `password`, a sign-in provider's id (`google`, `microsoft`) or `sso`. `source`: the
   * answer to "How did you find Freero?" (only the sign-up form asks), sent as `discovery_source`.
   */
  | { name: 'sign_up'; method: string; source?: DiscoverySource }
  | { name: 'login'; method: string }
  | { name: 'board_created' }
  /** A built-in template by its public catalog id (the slug of its page on the site). */
  | { name: 'template_used'; template: string };

/** The GA4 parameters of an event, or null when a value isn't one the event may carry (it is then not sent). */
export function analyticsEventParams(e: AnalyticsEvent): Record<string, string> | null {
  switch (e.name) {
    case 'sign_up': {
      if (!/^[a-z][a-z0-9_-]{1,23}$/.test(e.method)) return null;
      if (e.source === undefined) return { method: e.method };
      return isDiscoverySource(e.source) ? { method: e.method, discovery_source: e.source } : null;
    }
    case 'login':
      return /^[a-z][a-z0-9_-]{1,23}$/.test(e.method) ? { method: e.method } : null;
    case 'board_created':
      return {};
    case 'template_used':
      return /^[a-z0-9][a-z0-9-]{0,79}$/.test(e.template) ? { template_id: e.template } : null;
    default:
      return null;
  }
}

export interface AnalyticsPage {
  /** The route with ids and tokens removed. */
  path: string;
  /** A generic title (never the document's own: a board's tab shows its title). */
  title: string;
}

/** Routes reported as they are (no ids in them), with their generic titles. */
const STATIC: Record<string, string> = {
  '/': 'Home',
  '/app': 'Dashboard',
  '/login': 'Log in',
  '/login/two-factor': 'Two-step verification',
  '/signup': 'Sign up',
  '/forgot-password': 'Forgot password',
  '/reset-password': 'Reset password',
  '/revert-email': 'Account email',
  '/undo-two-factor': 'Two-step verification',
  '/recover-two-factor': 'Two-step verification',
  '/cancel-recovery': 'Two-step verification',
  '/verify-email': 'Account email',
  '/confirm-email': 'Account email',
  '/unsubscribe': 'Unsubscribe',
  '/appeal': 'Appeal',
  '/settings': 'Account settings',
  // Its groups (web app/pages/account/sections.ts).
  '/settings/profile': 'Account settings',
  '/settings/preferences': 'Account settings',
  '/settings/notifications': 'Account settings',
  '/settings/security': 'Account settings',
  '/settings/integrations': 'Account settings',
  '/settings/developer': 'Account settings',
  '/settings/account': 'Account settings',
  '/settings/connect': 'Connect an agent',
  '/apps': 'Apps and agents',
  '/apps/submit': 'Submit an app',
  '/share': 'Share to Freero',
};

/** Routes whose second segment is an id or a token: reported as their first segment only. */
const WITH_ID: Record<string, string> = {
  board: 'Board',
  doc: 'Doc',
  decision: 'Decision',
  invite: 'Invitation',
  'workspace-invite': 'Invitation',
  admin: 'Admin console',
};

/**
 * Where analytics never runs: the live board view inside an AI assistant (MCP Apps), boards
 * embedded on other sites and in Microsoft Teams (and their sign-in pages), the operators' console
 * and the OAuth consent screen.
 */
const NEVER = /^\/(embed|teams|operator|oauth)(\/|$)/;

/**
 * How an app address is reported, or null where analytics never runs. Unknown routes are one
 * generic page, so a typo'd or future route can't carry an id to Google.
 */
export function analyticsPage(pathname: string): AnalyticsPage | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (NEVER.test(p)) return null;
  if (p in STATIC) return { path: p, title: STATIC[p] };
  const seg = p.split('/').filter(Boolean);
  if (seg.length === 2 && seg[0] in WITH_ID) return { path: `/${seg[0]}`, title: WITH_ID[seg[0]] };
  if (seg[0] === 'apps' && seg.length === 3 && seg[1] === 'community') return { path: '/apps/community', title: 'Community app' };
  // An integration's page: its id is the public catalog's (the site's /integrations/<id>).
  if (seg[0] === 'apps' && seg.length === 2) {
    const entry = integrationById(seg[1]);
    return entry ? { path: p, title: entry.name } : { path: '/apps', title: 'Apps and agents' };
  }
  return { path: '/not-found', title: 'Not found' };
}

/** A query string reduced to its UTM campaign tags (`?utm_source=…`), or ''. */
export function campaignQuery(search: string): string {
  const kept = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(search)) if (/^utm_(source|medium|campaign|term|content|id)$/.test(k)) kept.append(k, v.slice(0, 100));
  const q = kept.toString();
  return q ? `?${q}` : '';
}
