// Webhooks Freero registers in the tracker itself (`TrackerProvider.webhooks`: Asana, monday.com),
// one per connection and project, when someone sends to or imports from that project.
//
// The address the tracker posts to names the registration (`h`) and carries a key (`k`): an HMAC
// of `h` with the connection's webhook secret, so only an address Freero made verifies, and a new
// secret retires every old address (they are registered again). A handshake — Asana's
// X-Hook-Secret, monday.com's challenge — is answered only while that registration is pending
// (Freero is waiting on the tracker's answer to `register`), and Asana's secret is kept only once:
// a stranger who learns an address can neither register their own secret nor shake hands later.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { newId } from '../../platform/ids';
import { logError } from '../../platform/log';
import { seal, unseal } from '../../platform/secrets';
import { openConnection, webhookSecretOf } from './connections';
import { TrackerError } from './http';
import { providerOf } from './providers/index';
import * as repo from './repo';
import type { StoredConnection, StoredHook } from './repo';

export const HOOK_SECRET_PURPOSE = 'tracker-hook-secret-v1';
/** How long a registration waits for the tracker's handshake (and blocks another one). */
export const HOOK_PENDING_MS = 2 * 60_000;
/** A failed registration is tried again this much later (by the poll job). */
export const HOOK_RETRY_MS = 15 * 60_000;

/** The key in a registration's address: binds `h` to the connection's secret. */
export const hookKey = (secret: string, h: string) => createHmac('sha256', secret).update(`tracker-hook:${h}`).digest('base64url');

export const hookAddress = (origin: string, connectionId: string, h: string, secret: string) =>
  `${origin.replace(/\/+$/, '')}/api/trackers/webhooks/${encodeURIComponent(connectionId)}?h=${encodeURIComponent(h)}&k=${hookKey(secret, h)}`;

/**
 * The registration a delivery's address names, when its key verifies for this connection; with
 * whether it is waiting for its handshake and the secret that handshake issued.
 */
export async function hookOfAddress(conn: StoredConnection, secret: string, query: Record<string, unknown>, now = Date.now()): Promise<{ row: StoredHook; pending: boolean; secret: string | null } | null> {
  const h = typeof query.h === 'string' ? query.h : '';
  const k = typeof query.k === 'string' ? query.k : '';
  if (!h || !k || h.length > 64 || k.length > 128) return null;
  const want = Buffer.from(hookKey(secret, h));
  const got = Buffer.from(k);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const row = await repo.getHook(h);
  if (!row || row.connectionId !== conn.id) return null;
  return {
    row,
    pending: row.state === 'pending' && now - row.updatedAt < HOOK_PENDING_MS,
    secret: row.secretSealed ? (unseal(HOOK_SECRET_PURPOSE, row.secretSealed)?.value ?? null) : null,
  };
}

/** Keeps the secret a handshake issued (false: the registration isn't waiting for one any more). */
export const keepHandshakeSecret = (row: StoredHook, secret: string, now = Date.now()) => repo.keepHookSecret(row.id, seal(HOOK_SECRET_PURPOSE, secret), now - HOOK_PENDING_MS);

/**
 * Makes sure the tracker posts the changes of these projects to Freero: registers each that has no
 * webhook yet (or whose last try failed). Never throws: a project without one is still polled.
 */
export async function ensureWebhooks(conn: StoredConnection, projects: Array<string | null | undefined>, origin: string): Promise<void> {
  const provider = providerOf(conn.provider);
  if (!provider.webhooks || conn.inbound !== 'webhook' || conn.status !== 'active') return;
  const secret = webhookSecretOf(conn);
  if (!secret) return;
  for (const project of new Set(projects.filter((p): p is string => !!p))) {
    const h = newId(24);
    if (!(await repo.claimHook(conn.id, project, h, origin, Date.now() - HOOK_PENDING_MS))) continue;
    const pc = openConnection(conn);
    let externalId: string | null = null;
    try {
      externalId = (await provider.webhooks.register(pc, project, hookAddress(origin, conn.id, h, secret))).id;
      // Asana signs every delivery with what its handshake issued: none kept, none verifies.
      if (provider.webhooks.signed && !(await repo.getHook(h))?.secretSealed) throw new TrackerError('The tracker registered the webhook without the handshake.', 'invalid');
      await repo.activateHook(h, externalId);
    } catch (e) {
      if (externalId) await provider.webhooks.unregister(pc, externalId).catch(() => undefined);
      await repo.failHook(h, e instanceof TrackerError ? e.message : 'The webhook couldn’t be registered.');
      if (!(e instanceof TrackerError)) logError(`trackers: registering a webhook for ${conn.name} failed`, e);
    }
  }
}

/** Stops the tracker posting to Freero (a connection removed, switched to polling, or given a new secret). */
export async function dropWebhooks(conn: StoredConnection, hooks: StoredHook[], reason: string): Promise<void> {
  const provider = providerOf(conn.provider);
  if (!provider.webhooks) return;
  for (const h of hooks) {
    if (h.externalId) await provider.webhooks.unregister(openConnection(conn), h.externalId).catch(() => undefined);
    // Kept as failed (not deleted): the projects are registered again once the connection takes webhooks.
    await repo.failHook(h.id, reason, null, 0).catch(() => undefined);
  }
}

/** Registers again what failed a while ago (the poll job; connections that take webhooks). */
export async function retryWebhooks(now = Date.now()): Promise<void> {
  for (const h of await repo.hooksToRetry(now - HOOK_RETRY_MS)) {
    const conn = await repo.getConnection(h.connectionId);
    if (conn) await ensureWebhooks(conn, [h.project], h.appOrigin);
  }
}
