// Google Analytics 4 for the hosted service (GA_MEASUREMENT_ID; ARCHITECTURE.md "Analytics"): what
// the app may tell it. The rule: Google learns which KIND of page someone is on and a few product
// events, never what is on a board or who the person is. So an app address is reported only as
// its route with every id and token taken out (/board/<id> → /board), with a generic title, and
// without its query string (UTM campaign tags excepted). Pure: used by the web app's bridge and
// its tests.
import { isDiscoverySource, type DiscoverySource, type LinkAccess, type ObjectKind, type Role } from './api';
import type { ElementType } from './elements';
import { integrationById } from './integrations';
import { TRACKER_PROVIDERS, type TrackerProviderKind } from './trackers';

/** What `GET /api/analytics` answers. */
export interface AnalyticsSettings {
  /** This server measures with Google Analytics (GA_MEASUREMENT_ID). */
  enabled: boolean;
  /**
   * This server sends product events to PostHog (POSTHOG_KEY): the app then offers the analytics
   * control even without Google Analytics, records a signed-in person's opt-out on their account
   * (PUT /api/analytics/opt-out) and reports `CLIENT_PRODUCT_EVENTS` (POST /api/analytics/events).
   * Absent (a server from before it): off.
   */
  productAnalytics?: boolean;
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

// ---- Product events (PostHog, POSTHOG_KEY; ARCHITECTURE.md "Analytics") ------------------------
//
// What happens after sign-up — activation, retention, which features are used — sent by the server
// (never a script in a page) under a pseudonym: an HMAC of the account id, never the id, an email,
// a name, a title, content, a link or an IP address. The closed list below is all PostHog can
// receive; each event has one writer on the server (ARCHITECTURE.md lists them), except
// CLIENT_PRODUCT_EVENTS, which the app reports through POST /api/analytics/events.

/** Which door an action came through (the request's surface; `import`: a .freero backup restored). */
export type ProductEventVia = 'app' | 'api' | 'mcp' | 'other' | 'import';

export type ProductEvent =
  /** A new account. `method`: `password`, a sign-in provider's id, `sso` (a workspace's identity provider) or `scim` (provisioned by one). */
  | { name: 'signed_up'; method: string; discoverySource?: DiscoverySource | null }
  /** A completed sign-in (not the one that created the account). `method`: as above, or `email_link`. */
  | { name: 'logged_in'; method: string }
  | { name: 'board_created'; via: ProductEventVia; copy: boolean }
  | { name: 'doc_created'; via: ProductEventVia }
  /** Someone other than its owner opened a board for the first time: counted for the board's OWNER. */
  | { name: 'collaborator_joined' }
  | { name: 'invite_sent'; scope: 'board' | 'workspace'; recipient: 'account' | 'address'; role: string }
  | { name: 'invite_accepted'; scope: 'board' | 'workspace'; via: 'link' | 'verified_email' }
  | { name: 'workspace_created' }
  /** An app or assistant authorised over OAuth: how it registered and what it reaches, never which app. */
  | { name: 'app_connected'; registration: 'manual' | 'dynamic' | 'metadata'; resource: 'mcp' | 'api' }
  | { name: 'tracker_connected'; provider: TrackerProviderKind; auth: 'token' | 'oauth'; scope: 'workspace' | 'personal' }
  | { name: 'integration_connected'; integration: 'slack' | 'figma' }
  | { name: 'board_exported'; format: string }
  /** A board's link opened to people who have it (it was off). */
  | { name: 'board_shared_publicly'; access: Exclude<LinkAccess, 'none'> }
  /** A built-in template by its public catalog id (reported by the app). */
  | { name: 'template_used'; template: string }
  /**
   * Someone opened a board or doc in the app: at most once per account, board and UTC day, for the
   * person who opened it. `role`: their access to it. Never which board.
   */
  | { name: 'board_opened'; kind: ObjectKind; role?: Role }
  /**
   * Items added to boards, `count` of one `type`, gathered per account, workspace and door over a
   * few minutes (never one event per item; added and removed again in the window: not counted).
   */
  | { name: 'items_added'; type: ProductItemType; count: number; via: ProductEventVia }
  /** Comment messages written (new ones, not edits), gathered like items_added. */
  | { name: 'comment_added'; count: number; via: ProductEventVia }
  /**
   * People decided on changes an app or assistant (`proposer: 'app'`) or Freero's AI (`'ai'`)
   * proposed: `count` of them accepted or rejected in one decision. Never what they changed.
   */
  | { name: 'agent_proposal_resolved'; outcome: 'accepted' | 'rejected'; proposer: 'app' | 'ai'; count: number }
  /** Someone changed a doc's text: at most once per account, doc and UTC day. Never which doc. */
  | { name: 'doc_edited'; via: ProductEventVia };

export type ProductEventName = ProductEvent['name'];

/** The events the app may report itself (POST /api/analytics/events): what only the browser sees. */
export const CLIENT_PRODUCT_EVENTS = ['template_used'] as const;
export type ClientProductEvent = Extract<ProductEvent, { name: (typeof CLIENT_PRODUCT_EVENTS)[number] }>;

/** How a sign-in method is reported: a workspace's identity provider (`sso:<workspace>`) as `sso`, never which workspace. */
export const productSignInMethod = (method: string): string => (method.startsWith('sso:') ? 'sso' : method);

/**
 * The item types items_added may name: every board element type and nothing else (a client
 * writes an element's type, so anything outside this list is not sent).
 */
export const PRODUCT_ITEM_TYPES = [
  'sticky', 'shape', 'text', 'connector', 'pen', 'frame', 'image', 'card', 'emoji', 'mindmap', 'table', 'embed', 'icon', 'kanban', 'pdf',
  'swimlane', 'media', 'file', 'objectlink', 'activity', 'code', 'timeline', 'timelinebar', 'doc', 'kanbanview', 'diagram', 'chart', 'stickypad', 'icebreaker',
] as const satisfies readonly ElementType[];
export type ProductItemType = (typeof PRODUCT_ITEM_TYPES)[number];
// A new element type must be added above (this fails to compile until it is).
const everyElementType: Record<Exclude<ElementType, ProductItemType>, never> = {};
void everyElementType;
export const isProductItemType = (v: unknown): v is ProductItemType => oneOf(v, PRODUCT_ITEM_TYPES);

const METHOD_RE = /^[a-z][a-z0-9_-]{1,23}$/;
const TEMPLATE_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const FORMAT_RE = /^[a-z][a-z0-9]{1,15}$/;
const VIAS: readonly ProductEventVia[] = ['app', 'api', 'mcp', 'other', 'import'];
const ROLES = ['owner', 'coowner', 'admin', 'member', 'guest', 'editor', 'commenter', 'viewer'] as const;
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v);
}
/** A count an event may carry: a whole number from 1 to a million. */
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 1_000_000;
const BOARD_ROLES = ['owner', 'editor', 'commenter', 'viewer'] as const;

/**
 * The PostHog properties of an event, or null when a value isn't one the event may carry (it is
 * then not sent). Only these keys ever leave the server, besides a hashed `workspace` and the
 * pseudonymous distinct id (modules/analytics).
 */
export function productEventProperties(e: ProductEvent): Record<string, string | boolean | number> | null {
  switch (e.name) {
    case 'signed_up': {
      if (!METHOD_RE.test(e.method)) return null;
      if (e.discoverySource === undefined || e.discoverySource === null) return { method: e.method };
      return isDiscoverySource(e.discoverySource) ? { method: e.method, discovery_source: e.discoverySource } : null;
    }
    case 'logged_in':
      return METHOD_RE.test(e.method) ? { method: e.method } : null;
    case 'board_created':
      return oneOf(e.via, VIAS) && typeof e.copy === 'boolean' ? { via: e.via, copy: e.copy } : null;
    case 'doc_created':
      return oneOf(e.via, VIAS) ? { via: e.via } : null;
    case 'collaborator_joined':
    case 'workspace_created':
      return {};
    case 'invite_sent':
      return oneOf(e.scope, ['board', 'workspace'] as const) && oneOf(e.recipient, ['account', 'address'] as const) && oneOf(e.role, ROLES)
        ? { scope: e.scope, recipient: e.recipient, role: e.role }
        : null;
    case 'invite_accepted':
      return oneOf(e.scope, ['board', 'workspace'] as const) && oneOf(e.via, ['link', 'verified_email'] as const) ? { scope: e.scope, via: e.via } : null;
    case 'app_connected':
      return oneOf(e.registration, ['manual', 'dynamic', 'metadata'] as const) && oneOf(e.resource, ['mcp', 'api'] as const)
        ? { registration: e.registration, resource: e.resource }
        : null;
    case 'tracker_connected':
      return Object.hasOwn(TRACKER_PROVIDERS, e.provider) && oneOf(e.auth, ['token', 'oauth'] as const) && oneOf(e.scope, ['workspace', 'personal'] as const)
        ? { provider: e.provider, auth: e.auth, scope: e.scope }
        : null;
    case 'integration_connected':
      return oneOf(e.integration, ['slack', 'figma'] as const) ? { integration: e.integration } : null;
    case 'board_exported':
      return FORMAT_RE.test(e.format) ? { format: e.format } : null;
    case 'board_shared_publicly':
      return oneOf(e.access, ['viewer', 'commenter', 'editor'] as const) ? { access: e.access } : null;
    case 'template_used':
      return TEMPLATE_RE.test(e.template) ? { template_id: e.template } : null;
    case 'board_opened':
      if (!oneOf(e.kind, ['board', 'doc'] as const)) return null;
      if (e.role === undefined) return { kind: e.kind };
      return oneOf(e.role, BOARD_ROLES) ? { kind: e.kind, role: e.role } : null;
    case 'items_added':
      return isProductItemType(e.type) && isCount(e.count) && oneOf(e.via, VIAS) ? { type: e.type, count: e.count, via: e.via } : null;
    case 'comment_added':
      return isCount(e.count) && oneOf(e.via, VIAS) ? { count: e.count, via: e.via } : null;
    case 'agent_proposal_resolved':
      return oneOf(e.outcome, ['accepted', 'rejected'] as const) && oneOf(e.proposer, ['app', 'ai'] as const) && isCount(e.count)
        ? { outcome: e.outcome, proposer: e.proposer, count: e.count }
        : null;
    case 'doc_edited':
      return oneOf(e.via, VIAS) ? { via: e.via } : null;
    default:
      return null;
  }
}

/**
 * A body POSTed to /api/analytics/events, or null unless it is exactly one of the events the app
 * may report with exactly its fields (an unknown event, an extra field or a bad value is refused).
 */
export function parseClientProductEvent(body: unknown): ClientProductEvent | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.name !== 'template_used' || Object.keys(b).length !== 2 || typeof b.template !== 'string') return null;
  const e: ClientProductEvent = { name: 'template_used', template: b.template };
  return productEventProperties(e) ? e : null;
}
