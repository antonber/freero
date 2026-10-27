// Optional error reporting to any Sentry-compatible endpoint (Sentry, GlitchTip, self-hosted…),
// configured with ERROR_REPORTING_DSN. No SDK: one envelope POST per event, fire-and-forget,
// with a per-message throttle so an error loop cannot flood the endpoint.
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { Config } from './config';
import { currentRequestContext } from './requestContext';

interface Target {
  url: string;
  auth: string;
  dsn: string;
}

let target: Target | null = null;
let meta: { environment: string; release: string | null } = { environment: 'development', release: null };
const recent = new Map<string, number>();
const THROTTLE_MS = 60_000;

/** https://<publicKey>@<host>/<projectId> -> envelope endpoint. Null if malformed. */
export function parseDsn(dsn: string): Target | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split('/').filter(Boolean).pop();
    if (!u.username || !projectId) return null;
    const prefix = u.pathname.slice(0, u.pathname.lastIndexOf(projectId));
    return {
      url: `${u.protocol}//${u.host}${prefix}api/${projectId}/envelope/`,
      auth: `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=freero/1.0`,
      dsn,
    };
  } catch {
    return null;
  }
}

export function initErrorReporting(config: Config): void {
  meta = { environment: config.environment, release: config.release };
  target = config.errorReportingDsn ? parseDsn(config.errorReportingDsn) : null;
  if (config.errorReportingDsn && !target) console.error('ERROR_REPORTING_DSN is not a valid DSN; error reporting disabled');
}

function frames(stack: string | undefined) {
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1)
    .map((line) => /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ function: m[1] ?? '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: !m[2].includes('node_modules') && !m[2].startsWith('node:') }))
    .reverse(); // Sentry wants the innermost frame last
}

/** Reports an error (no-op without a DSN). Never throws. */
export function reportError(err: unknown, extra: { message?: string; request?: { method?: string; url?: string } } = {}): void {
  if (!target) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const fingerprint = `${e.name}:${e.message}`;
  const now = Date.now();
  if ((recent.get(fingerprint) ?? 0) > now - THROTTLE_MS) return;
  recent.set(fingerprint, now);
  if (recent.size > 500) recent.clear();

  const ctx = currentRequestContext();
  const eventId = randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: now / 1000,
    platform: 'node',
    level: 'error',
    logger: 'freero',
    server_name: os.hostname(),
    environment: meta.environment,
    ...(meta.release ? { release: meta.release } : {}),
    ...(extra.message ? { message: { formatted: extra.message } } : {}),
    exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: frames(e.stack) } }] },
    tags: ctx ? { request_id: ctx.reqId } : {},
    ...(ctx?.userId ? { user: { id: ctx.userId } } : {}),
    ...(extra.request ? { request: { method: extra.request.method, url: extra.request.url } } : {}),
  };
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date(now).toISOString(), dsn: target.dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  fetch(target.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': target.auth },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    /* reporting must never take the app down */
  });
}
