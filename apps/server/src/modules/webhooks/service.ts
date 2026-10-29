// Workspace webhooks (KAI-105): a team's admins register endpoints with the event types they want;
// every event of the stream (modules/events) about a board of that workspace becomes one delivery
// per matching endpoint, signed with the endpoint's secret and retried with backoff.
//
// What a payload may carry: only boards every full member of the workspace can open through team
// access (no personal boards, nothing in a private project — those events are not delivered at
// all), and only content every reader of such a board sees (the stream derives item and comment
// events from the shared doc as viewers see it: no private drafts, nothing in a hidden frame).
import { createHmac, randomBytes } from 'node:crypto';
import {
  EVENT_TYPES,
  EVENTS_VERSION,
  guestDisplayName,
  isEventType,
  isGuestId,
  WEBHOOK_FORMATS,
  WEBHOOK_HEADERS,
  WEBHOOK_MAX_ENDPOINTS,
  WEBHOOK_SECRET_PREFIX,
  webhookSignedPayload,
  type EventActor,
  type FreeroEvent,
  type FreeroEventType,
  type MemberEventData,
  type WebhookDeliveryInfo,
  type WebhookEndpointInfo,
  type WebhookFormat,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log, logError } from '../../platform/log';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';
import { counter } from '../../platform/metrics';
import type { OutboxConsumer } from '../../platform/outbox';
import { seal, unseal } from '../../platform/secrets';
import { requireAdmin } from '../admin/index';
import { recordAudit, recordAuditQuietly } from '../audit/index';
import { getAccount, getGuests, getUsers } from '../auth/index';
import { boardsOpenToTheirTeam } from '../boards/index';
import { EVENT_RECORDED_TOPIC, eventsByIds, type StoredEvent } from '../events/index';
import { checkEndpointUrl, displayUrl, EndpointError, postOnce } from './deliver';
import { describe, renderBody, renderPing } from './format';
import * as repo from './repo';

const SECRET_PURPOSE = 'webhooks.secret';
const URL_PURPOSE = 'webhooks.url';
const MAX_DESCRIPTION = 200;
const MAX_RETRY_DELAY_MS = 6 * 3600_000;
const DELIVERY_LOG_DAYS = 30;

const attempts = counter('freero_webhooks_attempts_total', 'Webhook delivery attempts by outcome', ['outcome'] as const);

/** Webhooks are an instance feature the operator may turn off (WEBHOOKS=false): then nothing here exists. */
export function requireWebhooks(): void {
  if (!getConfig().webhooks.enabled) throw notFound();
}

const toInfo = (e: repo.EndpointRow, names: Map<string, { name: string }>): WebhookEndpointInfo => ({
  id: e.id,
  url: e.urlDisplay,
  description: e.description,
  events: e.events,
  format: e.format,
  enabled: e.enabled,
  disabledReason: e.disabledReason,
  consecutiveFailures: e.consecutiveFailures,
  createdAt: e.createdAt,
  createdBy: e.createdBy ? { id: e.createdBy, name: names.get(e.createdBy)?.name ?? 'Deleted user' } : null,
  lastDeliveryAt: e.lastDeliveryAt,
});
async function infos(rows: repo.EndpointRow[]): Promise<WebhookEndpointInfo[]> {
  const names = await getUsers(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])));
  return rows.map((r) => toInfo(r, names));
}
const deliveryInfo = (d: repo.DeliveryRow): WebhookDeliveryInfo => ({
  id: d.id,
  endpointId: d.endpointId,
  eventId: d.eventId === null ? 'ping' : `evt_${d.eventId}`,
  eventType: d.eventType,
  status: d.status,
  attempts: d.attempts,
  nextAttemptAt: d.status === 'pending' ? d.nextAttemptAt : null,
  responseStatus: d.responseStatus,
  error: d.error,
  durationMs: d.durationMs,
  createdAt: d.createdAt,
  deliveredAt: d.deliveredAt,
});

function readEvents(v: unknown): FreeroEventType[] {
  if (!Array.isArray(v) || !v.length || v.some((t) => !isEventType(t))) throw badRequest(`events must be a list of event types (${Object.keys(EVENT_TYPES).join(', ')})`);
  return [...new Set(v as FreeroEventType[])];
}
function readFormat(v: unknown): WebhookFormat {
  if (v === undefined) return 'json';
  if (!WEBHOOK_FORMATS.includes(v as WebhookFormat)) throw badRequest(`format must be ${WEBHOOK_FORMATS.join(', ')}`);
  return v as WebhookFormat;
}
function readDescription(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest('description must be text');
  return v.trim().slice(0, MAX_DESCRIPTION);
}
function readUrl(v: unknown): URL {
  try {
    return checkEndpointUrl(v, getConfig().webhooks.privateEndpoints);
  } catch (e) {
    if (e instanceof EndpointError) throw badRequest(e.message);
    throw e;
  }
}
const newSecret = () => `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
const auditTarget = (e: { id: string; urlDisplay: string }) => ({ type: 'webhook', id: e.id, label: e.urlDisplay });

// ---- admin console (owners/admins of a team workspace) ----

export async function listEndpoints(workspaceId: string, userId: string): Promise<WebhookEndpointInfo[]> {
  requireWebhooks();
  await requireAdmin(workspaceId, userId);
  return infos(await repo.endpointsOf(workspaceId));
}

export async function createEndpoint(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<{ endpoint: WebhookEndpointInfo; secret: string }> {
  requireWebhooks();
  await requireAdmin(workspaceId, userId);
  const url = readUrl(body.url);
  const events = readEvents(body.events);
  const format = readFormat(body.format);
  const description = readDescription(body.description);
  const secret = newSecret();
  const now = Date.now();
  const row: repo.EndpointRow = {
    id: newId(16),
    workspaceId,
    urlSealed: seal(URL_PURPOSE, url.href),
    urlDisplay: displayUrl(url),
    description,
    events,
    format,
    secretSealed: seal(SECRET_PURPOSE, secret),
    enabled: true,
    disabledReason: null,
    consecutiveFailures: 0,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    lastDeliveryAt: null,
  };
  await repo.transaction(async () => {
    await repo.lockWorkspaceEndpoints(workspaceId);
    if ((await repo.countEndpoints(workspaceId)) >= WEBHOOK_MAX_ENDPOINTS) throw new HttpError(409, `A workspace can have up to ${WEBHOOK_MAX_ENDPOINTS} webhooks`);
    await repo.insertEndpoint(row);
    await recordAudit({ action: 'webhook.created', workspaceId, actorId: userId, target: auditTarget(row), metadata: { events, format } });
  });
  return { endpoint: (await infos([row]))[0], secret };
}

async function endpointOf(workspaceId: string, userId: string, id: string): Promise<repo.EndpointRow> {
  requireWebhooks();
  await requireAdmin(workspaceId, userId);
  const e = await repo.getEndpoint(workspaceId, id);
  if (!e) throw notFound('No such webhook');
  return e;
}

export async function updateEndpoint(workspaceId: string, userId: string, id: string, body: Record<string, unknown>): Promise<WebhookEndpointInfo> {
  const before = await endpointOf(workspaceId, userId, id);
  const patch: Parameters<typeof repo.updateEndpoint>[1] = {};
  if (body.url !== undefined) {
    const url = readUrl(body.url);
    patch.urlSealed = seal(URL_PURPOSE, url.href);
    patch.urlDisplay = displayUrl(url);
  }
  if (body.events !== undefined) patch.events = readEvents(body.events);
  if (body.format !== undefined) patch.format = readFormat(body.format);
  if (body.description !== undefined) patch.description = readDescription(body.description);
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw badRequest('enabled must be true or false');
    patch.enabled = body.enabled;
  }
  const after = await repo.transaction(async () => {
    const updated = await repo.updateEndpoint(id, patch, Date.now());
    if (!updated) throw notFound('No such webhook');
    const changed = Object.keys(patch).filter((k) => k !== 'urlSealed');
    await recordAudit({
      action: 'webhook.updated',
      workspaceId,
      actorId: userId,
      target: auditTarget(updated),
      metadata: {
        changed: changed.map((k) => (k === 'urlDisplay' ? 'url' : k)),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.events ? { events: patch.events } : {}),
        ...(patch.format ? { format: patch.format } : {}),
        ...(patch.urlDisplay && patch.urlDisplay !== before.urlDisplay ? { from: before.urlDisplay, to: patch.urlDisplay } : {}),
      },
    });
    return updated;
  });
  return (await infos([after]))[0];
}

export async function rotateSecret(workspaceId: string, userId: string, id: string): Promise<{ endpoint: WebhookEndpointInfo; secret: string }> {
  await endpointOf(workspaceId, userId, id);
  const secret = newSecret();
  const after = await repo.transaction(async () => {
    const updated = await repo.updateEndpoint(id, { secretSealed: seal(SECRET_PURPOSE, secret) }, Date.now());
    if (!updated) throw notFound('No such webhook');
    await recordAudit({ action: 'webhook.secret_rotated', workspaceId, actorId: userId, target: auditTarget(updated) });
    return updated;
  });
  return { endpoint: (await infos([after]))[0], secret };
}

export async function deleteEndpoint(workspaceId: string, userId: string, id: string): Promise<void> {
  const e = await endpointOf(workspaceId, userId, id);
  await repo.transaction(async () => {
    if (!(await repo.deleteEndpoint(workspaceId, id))) throw notFound('No such webhook');
    await recordAudit({ action: 'webhook.deleted', workspaceId, actorId: userId, target: auditTarget(e) });
  });
}

/** Queues a test delivery, sent within a second like any other. */
export async function testEndpoint(workspaceId: string, userId: string, id: string): Promise<WebhookDeliveryInfo> {
  const e = await endpointOf(workspaceId, userId, id);
  if (!e.enabled) throw new HttpError(409, 'Turn the webhook on to send a test');
  const now = Date.now();
  const deliveryId = newId(16);
  await repo.enqueueDeliveries([{ id: deliveryId, endpointId: e.id, eventId: null, eventType: 'ping', body: renderPing(e.format, workspaceId, now) }], now);
  return deliveryInfo((await repo.getDelivery(e.id, deliveryId))!);
}

export async function listDeliveries(workspaceId: string, userId: string, id: string): Promise<WebhookDeliveryInfo[]> {
  await endpointOf(workspaceId, userId, id);
  return (await repo.deliveriesOf(id, 100)).map(deliveryInfo);
}

export async function redeliver(workspaceId: string, userId: string, id: string, deliveryId: string): Promise<WebhookDeliveryInfo> {
  await endpointOf(workspaceId, userId, id);
  const d = await repo.getDelivery(id, deliveryId);
  if (!d) throw notFound('No such delivery');
  if (!(await repo.redeliver(d.id, Date.now()))) throw new HttpError(409, 'That delivery already arrived');
  return deliveryInfo((await repo.getDelivery(id, deliveryId))!);
}

// ---- fan-out: the stream's events → deliveries ----

/** Names as the event shows them: accounts by their current name, guests as "Guest · …", apps as "<app> for <person>". */
async function namesFor(events: StoredEvent[]): Promise<(id: string | null | undefined) => string | undefined> {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.actor?.id) ids.add(e.actor.id);
    const member = (e.data as Partial<MemberEventData>).userId;
    if (e.type.startsWith('member.') && member) ids.add(member);
  }
  const [users, guests] = await Promise.all([getUsers([...ids].filter((id) => !isGuestId(id))), getGuests([...ids].filter(isGuestId))]);
  return (id) => (!id ? undefined : isGuestId(id) ? (guests.has(id) ? guestDisplayName(guests.get(id)!.name) : undefined) : users.get(id)?.name);
}

function actorOf(e: StoredEvent, name: (id: string | null | undefined) => string | undefined): { actor: EventActor | null; who: string } {
  if (!e.actor) return { actor: null, who: 'Someone' };
  if (e.actor.kind === 'system') return { actor: { kind: 'system' }, who: 'Freero' };
  const person = name(e.actor.id) ?? 'Someone';
  if (e.actor.kind === 'agent') return { actor: { kind: 'agent', id: e.actor.id ?? '', name: person, app: e.actor.app ?? 'An app' }, who: `${e.actor.app ?? 'An app'} for ${person}` };
  return { actor: { kind: 'user', id: e.actor.id ?? '', name: person }, who: person };
}

/** Queues the deliveries of these events (idempotent: one per event and endpoint). Returns how many were queued. */
export async function fanOut(eventIds: number[], now = Date.now()): Promise<number> {
  if (!getConfig().webhooks.enabled) return 0;
  const events = await eventsByIds(eventIds);
  const endpoints = await repo.enabledEndpointsIn([...new Set(events.map((e) => e.workspaceId))]);
  if (!endpoints.length) return 0;
  const wanted = events.filter((e) => endpoints.some((p) => p.workspaceId === e.workspaceId && p.events.includes(e.type)));
  if (!wanted.length) return 0;
  // Only boards every full member of the team can open: nothing about the rest leaves Freero.
  const open = await boardsOpenToTheirTeam([...new Set(wanted.map((e) => e.boardId))]);
  const name = await namesFor(wanted);
  const rows: Parameters<typeof repo.enqueueDeliveries>[0] = [];
  for (const e of wanted) {
    const board = open.get(e.boardId);
    if (!board || board.workspaceId !== e.workspaceId) continue;
    const { actor, who } = actorOf(e, name);
    const event: FreeroEvent = {
      id: `evt_${e.id}`,
      type: e.type,
      version: EVENTS_VERSION,
      createdAt: new Date(e.at).toISOString(),
      workspaceId: e.workspaceId,
      board: { id: e.boardId, title: board.title, url: appUrl(null, `/board/${encodeURIComponent(e.boardId)}`) },
      actor,
      data: e.data,
    };
    // An item or comment event links to the item itself.
    const item = e.objectUri.includes('#') ? e.objectUri.slice(e.objectUri.indexOf('#') + 1) : null;
    const thread = e.type === 'comment.created' ? (e.data as { threadId?: string }).threadId : null;
    const link = thread ? `${event.board.url}?thread=${encodeURIComponent(thread)}` : item && e.type !== 'item.deleted' ? `${event.board.url}?el=${encodeURIComponent(item)}` : event.board.url;
    const words = describe(event, who, name((e.data as Partial<MemberEventData>).userId) ?? 'someone');
    for (const p of endpoints) {
      if (p.workspaceId !== e.workspaceId || !p.events.includes(e.type)) continue;
      const body = p.format === 'json' ? renderBody('json', event, words) : renderBody(p.format, { ...event, board: { ...event.board, url: link } }, words);
      rows.push({ id: newId(16), endpointId: p.id, eventId: e.id, eventType: e.type, body });
    }
  }
  return repo.enqueueDeliveries(rows, now);
}

/** The outbox consumer: every recorded event becomes deliveries for the endpoints that want it. */
export const webhooksConsumer: OutboxConsumer = {
  name: 'webhooks',
  topics: [EVENT_RECORDED_TOPIC],
  lockKey: 7_202_611_121, // arbitrary, constant across releases
  batchSize: 200,
  async handle(events) {
    const ids = events.map((e) => Number((e.payload as { id?: unknown } | null)?.id)).filter((n) => Number.isInteger(n) && n > 0);
    await fanOut(ids);
  },
};

// ---- sending ----

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` with the endpoint's secret. */
export function signature(secret: string, body: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},v1=${createHmac('sha256', secret).update(webhookSignedPayload(timestampSeconds, body)).digest('hex')}`;
}

/** The endpoint's URL and secret in the clear (sealed again when made with a previous SESSION_SECRET). */
async function openEndpoint(e: repo.EndpointRow): Promise<{ url: string; secret: string } | null> {
  const url = unseal(URL_PURPOSE, e.urlSealed);
  const secret = unseal(SECRET_PURPOSE, e.secretSealed);
  if (!url || !secret) return null;
  if (url.stale) await repo.resealUrl(e.id, seal(URL_PURPOSE, url.value));
  if (secret.stale) await repo.resealSecret(e.id, seal(SECRET_PURPOSE, secret.value));
  return { url: url.value, secret: secret.value };
}

const retryDelay = (attempt: number, base: number) => Math.min(MAX_RETRY_DELAY_MS, base * 4 ** (attempt - 1));

async function tellEndpointTurnedOff(e: repo.EndpointRow, failures: number): Promise<void> {
  await recordAuditQuietly({ action: 'webhook.disabled', workspaceId: e.workspaceId, actorId: null, target: auditTarget(e), metadata: { failures } });
  const owner = e.createdBy ? await getAccount(e.createdBy).catch(() => null) : null;
  if (!owner?.emailVerified) return;
  sendMailLater({
    to: owner.email,
    ...renderMail({
      subject: 'A Freero webhook was turned off',
      title: 'We turned off a webhook',
      paragraphs: [
        `The webhook to ${e.urlDisplay} failed ${failures} times in a row, so Freero stopped sending to it.`,
        'Events that happened meanwhile are kept in its delivery log for 30 days. Fix the receiving end, then turn the webhook back on in the admin console — waiting deliveries are sent again.',
      ],
      action: { label: 'Open webhooks', url: appUrl(null, `/admin/${encodeURIComponent(e.workspaceId)}?tab=webhooks`) },
    }),
  });
}

/** Sends one due delivery and records the outcome (retry with backoff, or give up; maybe turn the endpoint off). */
async function attempt(d: repo.DeliveryRow & { endpoint: repo.EndpointRow }, now: number): Promise<boolean> {
  const cfg = getConfig().webhooks;
  const open = await openEndpoint(d.endpoint);
  const ts = Math.floor(Date.now() / 1000);
  const outcome = open
    ? await postOnce(
        open.url,
        d.body,
        {
          [WEBHOOK_HEADERS.signature]: signature(open.secret, d.body, ts),
          [WEBHOOK_HEADERS.event]: d.eventType,
          [WEBHOOK_HEADERS.eventId]: d.eventId === null ? 'ping' : `evt_${d.eventId}`,
          [WEBHOOK_HEADERS.delivery]: d.id,
        },
        { timeoutMs: cfg.timeoutMs, allowPrivate: cfg.privateEndpoints },
      )
    : { status: null, ok: false, error: 'This webhook’s URL or secret can’t be read (the server’s secret changed): set the URL again and rotate the secret', durationMs: 0 };
  attempts.inc({ outcome: outcome.ok ? 'delivered' : 'failed' });
  if (outcome.ok) {
    await repo.markDelivered(d.id, d.endpointId, outcome.status ?? 200, outcome.durationMs, Date.now());
    return true;
  }
  const n = d.attempts + 1;
  const retryAt = n >= cfg.maxAttempts ? null : now + retryDelay(n, cfg.retryBaseMs);
  const { failures, disabled } = await repo.markFailed(
    d.id,
    d.endpointId,
    { status: outcome.status, error: outcome.error ?? 'Failed', durationMs: outcome.durationMs },
    retryAt,
    cfg.disableAfterFailures,
    `Turned off after ${cfg.disableAfterFailures} failed deliveries in a row`,
    Date.now(),
  );
  if (disabled) {
    log(`webhooks: turned off endpoint ${d.endpointId} of workspace ${d.endpoint.workspaceId} after ${failures} failures`);
    await tellEndpointTurnedOff(d.endpoint, failures);
  }
  return !disabled;
}

/** Sends every due delivery (the delivery job; tests call it). Returns how many attempts were made. */
export async function deliverDue(now = Date.now(), limit = 25): Promise<number> {
  const due = await repo.dueDeliveries(now, limit);
  // A few at a time; deliveries to one endpoint keep their order within a run.
  const byEndpoint = new Map<string, typeof due>();
  for (const d of due) byEndpoint.set(d.endpointId, [...(byEndpoint.get(d.endpointId) ?? []), d]);
  const queues = [...byEndpoint.values()];
  const workers = Array.from({ length: Math.min(4, queues.length) }, async () => {
    for (let q = queues.shift(); q; q = queues.shift())
      for (const d of q) {
        try {
          // Turned off by this attempt: the rest of its queue waits until it is back on.
          if (!(await attempt(d, now))) break;
        } catch (e) {
          logError(`webhooks: delivery ${d.id} could not be recorded`, e);
        }
      }
  });
  await Promise.all(workers);
  return due.length;
}

/** The delivery log keeps 30 days. */
export async function pruneDeliveries(now = Date.now()): Promise<number> {
  return repo.pruneDeliveriesBefore(now - DELIVERY_LOG_DAYS * 86_400_000);
}
