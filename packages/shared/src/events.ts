// ---- The event stream (KAI-150) and workspace webhooks (KAI-105) ----
// Things that happen to boards are recorded ONCE as events (server `modules/events`), in order, and
// fanned out from there: webhooks today, other consumers later. Event types and their `data` are a
// versioned contract — they leave Freero through webhooks — documented in docs/events.md; within
// EVENTS_VERSION changes are additive only (new types, new optional fields). `events.test.ts`
// fails when a documented field disappears.
import type { Role } from './api';

export const EVENTS_VERSION = 1 as const;

export const EVENT_TYPES = {
  'board.created': 'A board was created (or made as a copy of another)',
  'board.renamed': 'A board was renamed',
  'board.moved': 'A board was moved into or out of a project',
  'board.trashed': 'A board was moved to the trash',
  'board.restored': 'A board was restored from the trash',
  'member.added': 'Someone was given access to a board',
  'member.role_changed': 'Someone’s access to a board changed',
  'member.removed': 'Someone’s access to a board was removed (or they left)',
  'item.created': 'An item was added to a board',
  'item.updated': 'An item changed (several changes in a row arrive as one)',
  'item.deleted': 'An item was deleted',
  'comment.created': 'A comment was written',
} as const;
export type FreeroEventType = keyof typeof EVENT_TYPES;
export const isEventType = (s: unknown): s is FreeroEventType => typeof s === 'string' && Object.hasOwn(EVENT_TYPES, s);

/**
 * Who caused an event: a person (`user`), an app or token acting for a person (`agent`: the
 * public API, MCP; KAI-168), or Freero itself (`system`). Null when the board's saved content does
 * not say who made a change (item updates and deletions are derived from what was saved).
 */
export type EventActor =
  | { kind: 'user'; id: string; name?: string }
  | { kind: 'agent'; id: string; name?: string; app: string }
  | { kind: 'system' };

export interface BoardEventData {
  title: string;
  /** board.renamed: the old title. board.moved: the project it left (name, or null). */
  from?: string | null;
  /** board.renamed: the new title. board.moved: the project it is in now (name, or null). */
  to?: string | null;
  /** board.created as a copy: the id of the board it was copied from. */
  copyOf?: string;
}
export interface MemberEventData {
  userId: string;
  /** member.added / member.role_changed: the role now. */
  role?: Exclude<Role, 'owner'>;
  /** member.role_changed: the role before. */
  previousRole?: Exclude<Role, 'owner'> | null;
}
export interface ItemEventData {
  /** The item: its element id, type, and up to EVENT_TEXT_MAX characters of its text (untrusted). */
  item: { id: string; type: string; text?: string };
}
export interface CommentEventData {
  threadId: string;
  messageId: string;
  /** The item the thread is pinned to, or null (on the board). */
  itemId: string | null;
  /** Up to EVENT_TEXT_MAX characters of the message (untrusted; mentions read as @Name). */
  text: string;
}
export type EventData = BoardEventData | MemberEventData | ItemEventData | CommentEventData;

/** Longest text an event carries (a sticky's text, a comment). */
export const EVENT_TEXT_MAX = 280;

/** One event as webhooks deliver it (format `json`). */
export interface FreeroEvent {
  /** `evt_<number>`: unique, increasing in the order Freero recorded them. */
  id: string;
  type: FreeroEventType;
  version: typeof EVENTS_VERSION;
  /** ISO 8601. */
  createdAt: string;
  workspaceId: string;
  board: { id: string; title: string; url: string };
  actor: EventActor | null;
  data: EventData;
}

// ---- Webhooks: a team workspace's admins register endpoints (admin console, "Webhooks") ----

/** `json`: the FreeroEvent; `slack` / `teams`: a ready-made message for an incoming-webhook URL. */
export const WEBHOOK_FORMATS = ['json', 'slack', 'teams'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

/**
 * Request headers of every delivery. The signature is HMAC-SHA256 with the endpoint's secret over
 * `${timestamp}.${body}` (hex), sent as `t=<unix seconds>,v1=<hex>`; receivers recompute it and
 * refuse old timestamps (replays). `webhookSignedPayload` builds the signed string.
 */
export const WEBHOOK_HEADERS = {
  signature: 'freero-signature',
  event: 'freero-event',
  eventId: 'freero-event-id',
  delivery: 'freero-delivery',
} as const;
export const webhookSignedPayload = (timestampSeconds: number, body: string): string => `${timestampSeconds}.${body}`;
/** Secrets start with this (shown once when an endpoint is created or its secret rotated). */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';
export const WEBHOOK_MAX_ENDPOINTS = 20;

export interface WebhookEndpointInfo {
  id: string;
  url: string;
  description: string;
  /** Event types it receives. */
  events: FreeroEventType[];
  format: WebhookFormat;
  enabled: boolean;
  /** Why Freero turned it off ("Turned off after 15 failed deliveries in a row"), or null. */
  disabledReason: string | null;
  consecutiveFailures: number;
  createdAt: number;
  createdBy: { id: string; name: string } | null;
  lastDeliveryAt: number | null;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';
export interface WebhookDeliveryInfo {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: FreeroEventType | 'ping';
  status: WebhookDeliveryStatus;
  attempts: number;
  /** When the next attempt is due (pending ones). */
  nextAttemptAt: number | null;
  /** The receiver's HTTP status of the last attempt, or null (no answer). */
  responseStatus: number | null;
  /** What went wrong on the last attempt, in Freero's words. */
  error: string | null;
  durationMs: number | null;
  createdAt: number;
  deliveredAt: number | null;
}

export interface WebhooksAdminResponse {
  endpoints: WebhookEndpointInfo[];
}
export interface WebhookCreateRequest {
  url: string;
  description?: string;
  events: FreeroEventType[];
  format?: WebhookFormat;
}
/** Create and rotate answer with the secret — the only time it is shown. */
export interface WebhookSecretResponse {
  endpoint: WebhookEndpointInfo;
  secret: string;
}
export interface WebhookUpdateRequest {
  url?: string;
  description?: string;
  events?: FreeroEventType[];
  format?: WebhookFormat;
  enabled?: boolean;
}
export interface WebhookDeliveriesResponse {
  deliveries: WebhookDeliveryInfo[];
}
