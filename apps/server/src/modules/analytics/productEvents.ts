// PostHog product analytics (POSTHOG_KEY; ARCHITECTURE.md "Analytics"): what happens after sign-up
// (activation, retention, feature use), sent by THIS server — never a script in a page, so there
// is no autocapture, no session replay and no CSP change. Without POSTHOG_KEY no client exists and
// trackProductEvent returns at once: a self-hosted server sends nothing.
//
// What PostHog receives is only what `productEventProperties` (@freero/shared) lets through for an
// event of the closed list `ProductEvent`, plus:
//   distinct_id  HMAC-SHA256 of the account id under SESSION_SECRET (platform/secrets `mac`),
//                never the id itself; rotating SESSION_SECRET starts new pseudonyms
//   workspace    the same HMAC of a workspace id, when the event has one
//   $lib, $lib_version, $is_server, $geoip_disable: true  (added by posthog-node)
// Never an email, a name, a title, content, a link, a user agent or an IP address: the events
// leave from the server, so the only address PostHog sees is the server's own, and GeoIP is off.
//
// Nothing is sent for an account that turned analytics off (analytics_opt_outs, any browser or
// app acting for it), nor while handling a request whose browser opted out or sends GPC / Do Not
// Track (platform/requestContext `privacySignal`).
import { PostHog } from 'posthog-node';
import { productEventProperties, type ProductEvent } from '@freero/shared';
import type { Config } from '../../platform/config';
import { logError, logger } from '../../platform/log';
import { currentRequestContext } from '../../platform/requestContext';
import { mac } from '../../platform/secrets';
import * as repo from './repo';

let client: PostHog | null = null;
/** Events between their trackProductEvent and their capture (the opt-out lookup), awaited by a flush. */
const pending = new Set<Promise<void>>();

/** Starts the client (once) when POSTHOG_KEY is set; without it nothing of PostHog exists. */
export function startProductAnalytics(config: Config): void {
  if (client || !config.posthog) return;
  client = new PostHog(config.posthog.key, {
    host: config.posthog.host,
    // Batches of up to 20, or every 10 s; a graceful shutdown sends what is left (stopProductAnalytics).
    flushAt: 20,
    flushInterval: 10_000,
    disableGeoip: true,
    requestTimeout: 10_000,
  });
  client.on('error', (e: unknown) => logError('analytics: PostHog did not take a batch of product events', e));
}

/** Whether product events go anywhere on this server. */
export const productAnalyticsOn = (): boolean => client !== null;

/** The pseudonym PostHog knows an account or a workspace by. */
export const pseudonym = (kind: 'account' | 'workspace', id: string): string => mac(`analytics.${kind}:${id}`).toString('hex');

/**
 * Counts `event` for `accountId` once the caller's transaction commits (never after a rollback).
 * `workspaceId`: sent hashed. `alsoRespect`: other accounts whose opt-out also stops it (a
 * collaborator joining is counted for the board's owner). Never throws, never waits.
 */
export function trackProductEvent(accountId: string, event: ProductEvent, opts: { workspaceId?: string | null; alsoRespect?: string[] } = {}): void {
  if (!client) return;
  if (currentRequestContext()?.privacySignal) return;
  const properties = productEventProperties(event);
  if (!properties) {
    logger.warn({ analytics: { refused: event.name } }, 'analytics: a product event carried a value outside its list; not sent');
    return;
  }
  repo.afterCommit(() => {
    const p: Promise<void> = capture(accountId, event.name, properties, opts).catch((e: unknown) => logError('analytics: could not send a product event', e));
    pending.add(p);
    void p.finally(() => pending.delete(p));
  });
}

async function capture(accountId: string, name: string, properties: Record<string, string | boolean>, opts: { workspaceId?: string | null; alsoRespect?: string[] }): Promise<void> {
  if (await repo.anyOptedOut([accountId, ...(opts.alsoRespect ?? [])])) return;
  client?.capture({
    distinctId: pseudonym('account', accountId),
    event: name,
    properties: opts.workspaceId ? { ...properties, workspace: pseudonym('workspace', opts.workspaceId) } : properties,
  });
}

/** Sends every event counted so far (tests; the shutdown below). */
export async function flushProductEvents(): Promise<void> {
  await Promise.allSettled([...pending]);
  await client?.flush();
}

/**
 * The shutdown hook (init.ts): sends what is queued, waiting at most `timeoutMs` in all, then stops
 * the client. Within the shutdown watchdog (platform/runtime.ts).
 */
export async function stopProductAnalytics(timeoutMs = 5_000): Promise<void> {
  const c = client;
  if (!c) return;
  const deadline = Date.now() + timeoutMs;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.allSettled([...pending]), new Promise((r) => (timer = setTimeout(r, timeoutMs)))]);
  clearTimeout(timer);
  client = null;
  await c.shutdown(Math.max(100, deadline - Date.now()));
}

/** The account turned analytics off (or back on): PUT /api/analytics/opt-out. */
export function setAccountOptedOut(userId: string, optedOut: boolean): Promise<void> {
  return repo.setOptedOut(userId, optedOut);
}
