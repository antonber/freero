// The only writer of `webhook_endpoints` and `webhook_deliveries` [S4].
import type { FreeroEventType, WebhookDeliveryStatus, WebhookFormat } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export interface EndpointRow {
  id: string;
  workspaceId: string;
  urlSealed: string;
  urlDisplay: string;
  description: string;
  events: FreeroEventType[];
  format: WebhookFormat;
  secretSealed: string;
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  lastDeliveryAt: number | null;
  /** Only events of this board / item on it (KAI-249), or null: every board. */
  scope: WebhookScope | null;
}
export interface WebhookScope {
  boardId: string;
  itemId: string | null;
}

interface ERow {
  id: string;
  workspace_id: string;
  url_sealed: string;
  url_display: string;
  description: string;
  events: FreeroEventType[];
  format: WebhookFormat;
  secret_sealed: string;
  enabled: boolean;
  disabled_reason: string | null;
  consecutive_failures: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  last_delivery_at: Date | null;
  board_id: string | null;
  item_id: string | null;
}

const toEndpoint = (r: ERow): EndpointRow => ({
  id: r.id,
  workspaceId: r.workspace_id,
  urlSealed: r.url_sealed,
  urlDisplay: r.url_display,
  description: r.description,
  events: r.events,
  format: r.format,
  secretSealed: r.secret_sealed,
  enabled: r.enabled,
  disabledReason: r.disabled_reason,
  consecutiveFailures: Number(r.consecutive_failures),
  createdBy: r.created_by,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
  lastDeliveryAt: r.last_delivery_at ? r.last_delivery_at.getTime() : null,
  scope: r.board_id ? { boardId: r.board_id, itemId: r.item_id } : null,
});

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export async function countEndpoints(workspaceId: string): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM webhook_endpoints WHERE workspace_id = $1`, [workspaceId]))?.n ?? 0;
}

/** Inside the caller's transaction: holds the workspace's endpoint list (the per-workspace cap). */
export async function lockWorkspaceEndpoints(workspaceId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('webhooks.endpoints'), hashtext($1))`, [workspaceId]);
}

export async function insertEndpoint(e: EndpointRow): Promise<void> {
  await query(
    `INSERT INTO webhook_endpoints (id, workspace_id, url_sealed, url_display, description, events, format, secret_sealed, enabled, created_by, created_at, updated_at, board_id, item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $10, $11, $12)`,
    [e.id, e.workspaceId, e.urlSealed, e.urlDisplay, e.description, e.events, e.format, e.secretSealed, e.createdBy, new Date(e.createdAt), e.scope?.boardId ?? null, e.scope?.itemId ?? null],
  );
}

export async function getEndpoint(workspaceId: string, id: string): Promise<EndpointRow | null> {
  const r = await one<ERow>(`SELECT * FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2`, [id, workspaceId]);
  return r ? toEndpoint(r) : null;
}

export async function endpointsOf(workspaceId: string): Promise<EndpointRow[]> {
  return (await query<ERow>(`SELECT * FROM webhook_endpoints WHERE workspace_id = $1 ORDER BY created_at, id`, [workspaceId])).map(toEndpoint);
}

/** Enabled endpoints of these workspaces (the fan-out). */
export async function enabledEndpointsIn(workspaceIds: string[]): Promise<EndpointRow[]> {
  if (!workspaceIds.length) return [];
  return (await query<ERow>(`SELECT * FROM webhook_endpoints WHERE workspace_id = ANY($1::text[]) AND enabled`, [workspaceIds])).map(toEndpoint);
}

/**
 * Changes the given fields (`scope`: undefined keeps it, null clears it). Turning an endpoint on
 * clears why it was off and its failure count.
 */
export async function updateEndpoint(
  id: string,
  patch: { urlSealed?: string; urlDisplay?: string; description?: string; events?: FreeroEventType[]; format?: WebhookFormat; enabled?: boolean; secretSealed?: string; scope?: WebhookScope | null },
  now: number,
): Promise<EndpointRow | null> {
  const r = await one<ERow>(
    `UPDATE webhook_endpoints SET
       url_sealed = COALESCE($2, url_sealed), url_display = COALESCE($3, url_display), description = COALESCE($4, description),
       events = COALESCE($5, events), format = COALESCE($6, format), secret_sealed = COALESCE($8, secret_sealed),
       enabled = COALESCE($7, enabled),
       disabled_reason = CASE WHEN $7::boolean IS NOT NULL THEN NULL ELSE disabled_reason END,
       consecutive_failures = CASE WHEN $7::boolean THEN 0 ELSE consecutive_failures END,
       board_id = CASE WHEN $10::boolean THEN $11::text ELSE board_id END,
       item_id = CASE WHEN $10::boolean THEN $12::text ELSE item_id END,
       updated_at = $9
     WHERE id = $1 RETURNING *`,
    [
      id,
      patch.urlSealed ?? null,
      patch.urlDisplay ?? null,
      patch.description ?? null,
      patch.events ?? null,
      patch.format ?? null,
      patch.enabled ?? null,
      patch.secretSealed ?? null,
      new Date(now),
      patch.scope !== undefined,
      patch.scope?.boardId ?? null,
      patch.scope?.itemId ?? null,
    ],
  );
  return r ? toEndpoint(r) : null;
}

/** Stores a secret sealed again with the current SESSION_SECRET (after a rotation). */
export async function resealSecret(id: string, sealed: string): Promise<void> {
  await query(`UPDATE webhook_endpoints SET secret_sealed = $2 WHERE id = $1`, [id, sealed]);
}
export async function resealUrl(id: string, sealed: string): Promise<void> {
  await query(`UPDATE webhook_endpoints SET url_sealed = $2 WHERE id = $1`, [id, sealed]);
}

export async function deleteEndpoint(workspaceId: string, id: string): Promise<boolean> {
  return (await query(`DELETE FROM webhook_endpoints WHERE id = $1 AND workspace_id = $2 RETURNING 1`, [id, workspaceId])).length > 0;
}

// ---- deliveries ----

export interface DeliveryRow {
  id: string;
  endpointId: string;
  eventId: number | null;
  eventType: FreeroEventType | 'ping';
  body: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: number | null;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: number;
  deliveredAt: number | null;
}
interface DRow {
  id: string;
  endpoint_id: string;
  event_id: number | null;
  event_type: FreeroEventType | 'ping';
  body: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  next_attempt_at: Date | null;
  response_status: number | null;
  error: string | null;
  duration_ms: number | null;
  created_at: Date;
  delivered_at: Date | null;
}
const toDelivery = (r: DRow): DeliveryRow => ({
  id: r.id,
  endpointId: r.endpoint_id,
  eventId: r.event_id === null ? null : Number(r.event_id),
  eventType: r.event_type,
  body: r.body,
  status: r.status,
  attempts: Number(r.attempts),
  nextAttemptAt: r.next_attempt_at ? r.next_attempt_at.getTime() : null,
  responseStatus: r.response_status,
  error: r.error,
  durationMs: r.duration_ms,
  createdAt: r.created_at.getTime(),
  deliveredAt: r.delivered_at ? r.delivered_at.getTime() : null,
});

/** Queues deliveries due now; one per (endpoint, event) however often this runs. */
export async function enqueueDeliveries(rows: Array<{ id: string; endpointId: string; eventId: number | null; eventType: string; body: string }>, now: number): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const done = await query(
      `INSERT INTO webhook_deliveries (id, endpoint_id, event_id, event_type, body, status, next_attempt_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6) ON CONFLICT (endpoint_id, event_id) DO NOTHING RETURNING 1`,
      [r.id, r.endpointId, r.eventId, r.eventType, r.body, new Date(now)],
    );
    n += done.length;
  }
  return n;
}

/** Pending deliveries that are due, of endpoints that are on, oldest first. */
export async function dueDeliveries(now: number, limit: number): Promise<Array<DeliveryRow & { endpoint: EndpointRow }>> {
  const rows = await query<DRow & { e: ERow }>(
    `SELECT d.*, row_to_json(e.*) AS e FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= $1 AND e.enabled
     ORDER BY d.next_attempt_at, d.id LIMIT $2`,
    [new Date(now), limit],
  );
  return rows.map((r) => {
    const e = (typeof r.e === 'string' ? JSON.parse(r.e) : r.e) as Record<string, unknown>;
    const date = (v: unknown) => (v ? new Date(v as string) : null);
    return {
      ...toDelivery(r),
      endpoint: toEndpoint({ ...(e as unknown as ERow), created_at: date(e.created_at)!, updated_at: date(e.updated_at)!, last_delivery_at: date(e.last_delivery_at) }),
    };
  });
}

/** A successful attempt: the delivery is done and the endpoint's failure streak ends. */
export async function markDelivered(id: string, endpointId: string, status: number, durationMs: number, now: number): Promise<void> {
  await tx(async () => {
    await query(
      `UPDATE webhook_deliveries SET status = 'delivered', attempts = attempts + 1, next_attempt_at = NULL, response_status = $2, error = NULL, duration_ms = $3, delivered_at = $4
       WHERE id = $1`,
      [id, status, durationMs, new Date(now)],
    );
    await query(`UPDATE webhook_endpoints SET consecutive_failures = 0, last_delivery_at = $2 WHERE id = $1`, [endpointId, new Date(now)]);
  });
}

/**
 * A failed attempt: retried at `retryAt`, or failed for good (null). Returns the endpoint's failure
 * streak now, and whether this attempt turned the endpoint off (`disableAt` failures in a row).
 */
export async function markFailed(
  id: string,
  endpointId: string,
  outcome: { status: number | null; error: string; durationMs: number | null },
  retryAt: number | null,
  disableAt: number,
  disabledReason: string,
  now: number,
): Promise<{ failures: number; disabled: boolean }> {
  return tx(async () => {
    await query(
      `UPDATE webhook_deliveries SET status = $2, attempts = attempts + 1, next_attempt_at = $3, response_status = $4, error = $5, duration_ms = $6
       WHERE id = $1`,
      [id, retryAt === null ? 'failed' : 'pending', retryAt === null ? null : new Date(retryAt), outcome.status, outcome.error.slice(0, 300), outcome.durationMs],
    );
    const before = await one<{ consecutive_failures: number; enabled: boolean }>(`SELECT consecutive_failures, enabled FROM webhook_endpoints WHERE id = $1 FOR UPDATE`, [endpointId]);
    if (!before) return { failures: 0, disabled: false };
    const failures = Number(before.consecutive_failures) + 1;
    const disabled = before.enabled && failures >= disableAt;
    await query(
      `UPDATE webhook_endpoints SET consecutive_failures = $2,
         enabled = CASE WHEN $3::boolean THEN false ELSE enabled END,
         disabled_reason = CASE WHEN $3::boolean THEN $4 ELSE disabled_reason END,
         updated_at = CASE WHEN $3::boolean THEN $5 ELSE updated_at END
       WHERE id = $1`,
      [endpointId, failures, disabled, disabledReason, new Date(now)],
    );
    return { failures, disabled };
  });
}

export async function deliveriesOf(endpointId: string, limit: number): Promise<DeliveryRow[]> {
  return (await query<DRow>(`SELECT * FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [endpointId, limit])).map(toDelivery);
}

export async function getDelivery(endpointId: string, id: string): Promise<DeliveryRow | null> {
  const r = await one<DRow>(`SELECT * FROM webhook_deliveries WHERE id = $1 AND endpoint_id = $2`, [id, endpointId]);
  return r ? toDelivery(r) : null;
}

/** Sends a delivery again from now (a failed one, or one still waiting for its next attempt). */
export async function redeliver(id: string, now: number): Promise<boolean> {
  return (await query(`UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = $2 WHERE id = $1 AND status <> 'delivered' RETURNING 1`, [id, new Date(now)])).length > 0;
}

/** Retention of the delivery log. */
export async function pruneDeliveriesBefore(before: number): Promise<number> {
  return (await query(`DELETE FROM webhook_deliveries WHERE created_at < $1 AND status <> 'pending' RETURNING 1`, [new Date(before)])).length;
}
