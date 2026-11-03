// Audit log streaming to a workspace's SIEM (#17). A team's owners/admins add sinks (Splunk HEC,
// Microsoft Sentinel via the Logs Ingestion API, a generic HTTPS collector signed like webhooks,
// syslog over TLS). The `siem:deliver` job sends each sink the workspace's audit events after its
// cursor (the chain seq), in order, at least once; a failed batch is retried with backoff and
// never skipped. Hourly, a sink also gets a signed `freero.audit.head` checkpoint, so the head of
// the log is anchored outside Freero's database.
//
// Secrets (HEC token, client secret, bearer token, the HTTPS URL — collector URLs often embed a
// token — and the signing secret) are sealed together at rest and never sent back; the signing
// secret is shown once, when it is made.
import { createHash, createHmac, randomBytes, X509Certificate } from 'node:crypto';
import {
  SIEM_KINDS,
  SIEM_MAX_SINKS,
  WEBHOOK_HEADERS,
  webhookSignedPayload,
  type SiemKind,
  type SiemSettings,
  type SiemSinkInfo,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log, logError } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { counter } from '../../platform/metrics';
import { seal, unseal } from '../../platform/secrets';
import { requireAdmin, toAuditEvents } from '../admin/index';
import { recordAudit, signedWorkspaceHead, workspaceEventsAfter, workspaceHeadSeq } from '../audit/index';
import { httpsBody, records, sentinelBody, splunkBody, syslogMessages, type HeadCheckpoint, type SiemRecord } from './format';
import * as repo from './repo';
import { checkHost, checkSinkUrl, post, sendSyslogTls, SinkTargetError, type Outcome } from './transport';

const SECRETS_PURPOSE = 'siem.secrets';
const SIGNING_PREFIX = 'siemsec_';
const BATCH = 200;
const BATCHES_PER_RUN = 10;
const ANCHOR_EVERY_MS = 60 * 60_000;
const MAX_RETRY_DELAY_MS = 6 * 3600_000;
const SENTINEL_API_VERSION = '2023-01-01';

const sends = counter('freero_siem_batches_total', 'Audit stream batches sent to SIEMs by outcome', ['outcome'] as const);

interface Secrets {
  /** splunk: HEC token; sentinel: client secret; https: optional bearer token. */
  token?: string;
  /** https: the full receiving URL. */
  url?: string;
  /** https: HMAC-SHA256 signing secret. */
  signingSecret?: string;
}

export function requireSiem(): void {
  if (!getConfig().siem.enabled) throw notFound();
}

// ---- validation ----

const text = (v: unknown, what: string, re: RegExp, max = 200): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > max || !re.test(v.trim())) throw badRequest(`${what} is not valid`);
  return v.trim();
};
const need = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw badRequest(`${what} is required`);
  return v;
};
const url = (v: unknown, what: string): URL => {
  try {
    return checkSinkUrl(v, getConfig().siem.privateEndpoints, what);
  } catch (e) {
    if (e instanceof SinkTargetError) throw badRequest(e.message);
    throw e;
  }
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The non-secret settings of a kind, checked; for https the URL goes to the secrets instead. */
function readSettings(kind: SiemKind, raw: unknown, prev: SiemSettings | null): { settings: SiemSettings; url?: string } {
  const s = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (kind === 'splunk') {
    const u = url(s.url ?? prev?.url, 'The HTTP Event Collector URL');
    return {
      settings: {
        url: u.href.replace(/\/+$/, ''),
        index: text(s.index ?? prev?.index, 'The index', /^[A-Za-z0-9_-]{1,80}$/),
        sourcetype: text(s.sourcetype ?? prev?.sourcetype, 'The source type', /^[\x21-\x7e]{1,100}$/),
      },
    };
  }
  if (kind === 'sentinel') {
    return {
      settings: {
        endpoint: url(s.endpoint ?? prev?.endpoint, 'The data collection endpoint').origin,
        dcrId: need(text(s.dcrId ?? prev?.dcrId, 'The data collection rule ID', /^dcr-[0-9a-f]{32}$/i), 'The data collection rule ID (dcr-…)'),
        stream: need(text(s.stream ?? prev?.stream, 'The stream', /^(Custom|Microsoft)-[A-Za-z0-9_]{1,100}$/), 'The stream name (Custom-…)'),
        tenantId: need(text(s.tenantId ?? prev?.tenantId, 'The tenant ID', /^([0-9a-f-]{36}|[a-z0-9.-]{3,253})$/i), 'The tenant ID'),
        clientId: need(text(s.clientId ?? prev?.clientId, 'The client ID', UUID), 'The client (application) ID'),
      },
    };
  }
  if (kind === 'https') {
    if (s.url === undefined && prev) return { settings: {} };
    return { settings: {}, url: url(s.url, 'The URL').href };
  }
  const host = s.host ?? prev?.host;
  if (typeof host !== 'string') throw badRequest('The syslog host is required');
  try {
    checkHost(host, getConfig().siem.privateEndpoints, 'The syslog host');
  } catch (e) {
    if (e instanceof SinkTargetError) throw badRequest(e.message);
    throw e;
  }
  const port = s.port ?? prev?.port ?? 6514;
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) throw badRequest('The port must be 1–65535');
  let caCert = s.caCert === undefined ? prev?.caCert : typeof s.caCert === 'string' && s.caCert.trim() ? s.caCert.trim() : undefined;
  if (caCert) {
    if (caCert.length > 64 * 1024) throw badRequest('The CA certificate is too large');
    try {
      new X509Certificate(caCert);
    } catch {
      throw badRequest('The CA certificate is not a PEM certificate');
    }
  } else caCert = undefined;
  return { settings: { host: host.trim().toLowerCase(), port: port as number, caCert } };
}

function readSecret(kind: SiemKind, v: unknown): string | undefined {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return undefined;
  if (typeof v !== 'string' || v.length > 4096 || /\s/.test(v.trim())) throw badRequest('The secret is not valid');
  if (kind === 'syslog') throw badRequest('A syslog stream has no secret');
  return v.trim();
}

function openSecrets(s: repo.SinkRow): Secrets | null {
  const opened = unseal(SECRETS_PURPOSE, s.secretsSealed);
  if (!opened) return null;
  const secrets = JSON.parse(opened.value) as Secrets;
  if (opened.stale) void repo.resealSecrets(s.id, s.secretsSealed, seal(SECRETS_PURPOSE, opened.value)).catch(() => {});
  return secrets;
}

const displayHttps = (u: string): string => {
  try {
    const url = new URL(u);
    const parts = url.pathname.split('/').filter(Boolean);
    return `${url.protocol}//${url.host}${parts[0] ? `/${parts[0]}` : ''}${parts.length > 1 || url.search ? '/…' : ''}`;
  } catch {
    return 'https://…';
  }
};

function target(s: repo.SinkRow, secrets: Secrets | null): string {
  if (s.kind === 'splunk') return s.settings.url ?? '';
  if (s.kind === 'sentinel') return `${s.settings.endpoint ?? ''} · ${s.settings.stream ?? ''}`;
  if (s.kind === 'https') return secrets?.url ? displayHttps(secrets.url) : 'https://…';
  return `tls://${s.settings.host}:${s.settings.port}`;
}

async function info(s: repo.SinkRow, headSeq: number): Promise<SiemSinkInfo> {
  const secrets = openSecrets(s);
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    settings: s.settings,
    target: target(s, secrets),
    hasSecret: !!secrets?.token,
    enabled: s.enabled,
    status: !s.enabled ? 'paused' : s.consecutiveFailures > 0 ? 'failing' : 'ok',
    deliveredSeq: s.cursorSeq,
    headSeq,
    lastDeliveredAt: s.lastDeliveredAt,
    lastError: s.lastError,
    consecutiveFailures: s.consecutiveFailures,
    nextAttemptAt: s.consecutiveFailures > 0 ? s.nextAttemptAt : null,
    createdAt: s.createdAt,
  };
}

const auditTarget = (s: { id: string; kind: SiemKind; name: string }) => ({ type: 'siem', id: s.id, label: s.name || s.kind });
const readName = (v: unknown, kind: SiemKind) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : kind === 'splunk' ? 'Splunk' : kind === 'sentinel' ? 'Microsoft Sentinel' : kind === 'https' ? 'HTTPS collector' : 'Syslog');

// ---- admin console ----

export async function listSinks(workspaceId: string, userId: string): Promise<SiemSinkInfo[]> {
  requireSiem();
  await requireAdmin(workspaceId, userId, { organisation: true, scope: 'security' });
  const head = await workspaceHeadSeq(workspaceId);
  return Promise.all((await repo.sinksOf(workspaceId)).map((s) => info(s, head)));
}

export async function createSink(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<{ sink: SiemSinkInfo; signingSecret?: string }> {
  requireSiem();
  await requireAdmin(workspaceId, userId, { organisation: true, scope: 'security' });
  const kind = body.kind as SiemKind;
  if (!SIEM_KINDS.includes(kind)) throw badRequest(`kind must be ${SIEM_KINDS.join(', ')}`);
  const { settings, url: httpsUrl } = readSettings(kind, body.settings, null);
  const token = readSecret(kind, body.secret);
  if ((kind === 'splunk' || kind === 'sentinel') && !token) throw badRequest(kind === 'splunk' ? 'The HEC token is required' : 'The client secret is required');
  const signingSecret = kind === 'https' ? `${SIGNING_PREFIX}${randomBytes(32).toString('base64url')}` : undefined;
  const secrets: Secrets = { token, url: httpsUrl, signingSecret };
  const now = Date.now();
  const row: repo.SinkRow = {
    id: newId(16),
    workspaceId,
    kind,
    name: readName(body.name, kind),
    settings,
    secretsSealed: seal(SECRETS_PURPOSE, JSON.stringify(secrets)),
    enabled: body.enabled !== false,
    // From now on: the history is in the console's export (CSV / JSON).
    cursorSeq: await workspaceHeadSeq(workspaceId),
    anchoredSeq: 0,
    anchoredAt: null,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    lastError: null,
    lastAttemptAt: null,
    lastDeliveredAt: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  await repo.transaction(async () => {
    await repo.lockWorkspaceSinks(workspaceId);
    if ((await repo.countSinks(workspaceId)) >= SIEM_MAX_SINKS) throw new HttpError(409, `A workspace can stream to at most ${SIEM_MAX_SINKS} places`);
    await repo.insertSink(row);
    await recordAudit({ action: 'siem.sink_created', workspaceId, actorId: userId, target: auditTarget(row), metadata: { kind, target: target(row, secrets) } });
  });
  return { sink: await info(row, row.cursorSeq), ...(signingSecret ? { signingSecret } : {}) };
}

async function sinkOf(workspaceId: string, userId: string, id: string): Promise<repo.SinkRow> {
  requireSiem();
  await requireAdmin(workspaceId, userId, { organisation: true, scope: 'security' });
  const s = await repo.getSink(workspaceId, id);
  if (!s) throw notFound('No such audit stream');
  return s;
}

export async function updateSink(workspaceId: string, userId: string, id: string, body: Record<string, unknown>): Promise<{ sink: SiemSinkInfo; signingSecret?: string }> {
  const s = await sinkOf(workspaceId, userId, id);
  const patch: Parameters<typeof repo.updateSink>[1] = {};
  const changed: string[] = [];
  if (body.name !== undefined) {
    patch.name = readName(body.name, s.kind);
    changed.push('name');
  }
  let secrets = openSecrets(s) ?? {};
  let secretsChanged = false;
  if (body.settings !== undefined) {
    const next = readSettings(s.kind, body.settings, s.settings);
    patch.settings = next.settings;
    if (next.url) {
      secrets = { ...secrets, url: next.url };
      secretsChanged = true;
    }
    changed.push('settings');
  }
  const token = readSecret(s.kind, body.secret);
  if (token) {
    secrets = { ...secrets, token };
    secretsChanged = true;
    changed.push('secret');
  }
  let signingSecret: string | undefined;
  if (body.rotateSigningSecret === true && s.kind === 'https') {
    signingSecret = `${SIGNING_PREFIX}${randomBytes(32).toString('base64url')}`;
    secrets = { ...secrets, signingSecret };
    secretsChanged = true;
    changed.push('signingSecret');
  }
  if (secretsChanged) patch.secretsSealed = seal(SECRETS_PURPOSE, JSON.stringify(secrets));
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw badRequest('enabled must be true or false');
    patch.enabled = body.enabled;
    changed.push('enabled');
  }
  const after = await repo.transaction(async () => {
    const updated = await repo.updateSink(id, patch, Date.now());
    if (!updated) throw notFound('No such audit stream');
    await recordAudit({
      action: 'siem.sink_updated',
      workspaceId,
      actorId: userId,
      target: auditTarget(updated),
      metadata: { changed, ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), target: target(updated, secrets) },
    });
    return updated;
  });
  return { sink: await info(after, await workspaceHeadSeq(workspaceId)), ...(signingSecret ? { signingSecret } : {}) };
}

export async function deleteSink(workspaceId: string, userId: string, id: string): Promise<void> {
  const s = await sinkOf(workspaceId, userId, id);
  await repo.transaction(async () => {
    if (!(await repo.deleteSink(workspaceId, id))) throw notFound('No such audit stream');
    await recordAudit({ action: 'siem.sink_deleted', workspaceId, actorId: userId, target: auditTarget(s), metadata: { kind: s.kind } });
  });
}

/** Sends one test record now (nothing moves the cursor); the outcome lands on the sink like a delivery's. */
export async function testSink(workspaceId: string, userId: string, id: string): Promise<SiemSinkInfo> {
  const s = await sinkOf(workspaceId, userId, id);
  const now = Date.now();
  const outcome = await send(s, [{ type: 'freero.audit.test', workspaceId, time: new Date(now).toISOString() }]);
  if (!outcome.ok) {
    await repo.markFailed(s.id, outcome.error ?? 'Failed', now, now);
    throw new HttpError(409, `The test didn’t arrive: ${outcome.error ?? 'failed'}`);
  }
  await repo.markDelivered(s.id, s.cursorSeq, s.cursorSeq, null, now);
  const fresh = (await repo.getSink(workspaceId, id)) ?? s;
  return info(fresh, await workspaceHeadSeq(workspaceId));
}

// ---- sending ----

const host = () => new URL(appUrl(null, '/')).host;

/** The HTTPS signature: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, like webhooks. */
export function httpsSignature(secret: string, body: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},v1=${createHmac('sha256', secret).update(webhookSignedPayload(timestampSeconds, body)).digest('hex')}`;
}

// Entra ID tokens for Sentinel sinks, per sink and secret, until shortly before they expire.
const tokens = new Map<string, { token: string; expiresAt: number }>();

async function sentinelToken(s: repo.SinkRow, clientSecret: string): Promise<{ token: string } | { error: string }> {
  const key = `${s.id}:${createHash('sha256').update(clientSecret).digest('hex')}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return { token: cached.token };
  const cfg = getConfig().siem;
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: s.settings.clientId ?? '',
    client_secret: clientSecret,
    scope: 'https://monitor.azure.com//.default',
  }).toString();
  const r = await post(`${cfg.azureAuthority}/${encodeURIComponent(s.settings.tenantId ?? '')}/oauth2/v2.0/token`, form, { 'content-type': 'application/x-www-form-urlencoded' }, {
    timeoutMs: cfg.timeoutMs,
    allowPrivate: cfg.privateEndpoints,
  });
  if (!r.ok) return { error: `Signing in to Microsoft Entra ID failed: ${r.error}` };
  try {
    const j = JSON.parse(r.body) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error();
    tokens.set(key, { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 });
    return { token: j.access_token };
  } catch {
    return { error: 'Microsoft Entra ID answered without an access token' };
  }
}

async function send(s: repo.SinkRow, rs: SiemRecord[]): Promise<Outcome> {
  const cfg = getConfig().siem;
  const opts = { timeoutMs: cfg.timeoutMs, allowPrivate: cfg.privateEndpoints };
  const secrets = openSecrets(s);
  if (!secrets) return { ok: false, status: null, body: '', error: 'This stream’s secrets can’t be read (the server’s secret changed): enter them again' };
  if (s.kind === 'splunk') {
    const base = s.settings.url ?? '';
    const endpoint = /\/services\/collector(\/event)?$/.test(base) ? base.replace(/\/services\/collector$/, '/services/collector/event') : `${base}/services/collector/event`;
    return post(endpoint, splunkBody(rs, s.settings, host()), { authorization: `Splunk ${secrets.token ?? ''}` }, opts);
  }
  if (s.kind === 'sentinel') {
    const t = await sentinelToken(s, secrets.token ?? '');
    if ('error' in t) return { ok: false, status: null, body: '', error: t.error };
    const u = `${s.settings.endpoint}/dataCollectionRules/${encodeURIComponent(s.settings.dcrId ?? '')}/streams/${encodeURIComponent(s.settings.stream ?? '')}?api-version=${SENTINEL_API_VERSION}`;
    return post(u, sentinelBody(rs), { authorization: `Bearer ${t.token}` }, opts);
  }
  if (s.kind === 'https') {
    const body = httpsBody(s.workspaceId, rs);
    const ts = Math.floor(Date.now() / 1000);
    return post(
      secrets.url ?? '',
      body,
      {
        [WEBHOOK_HEADERS.signature]: httpsSignature(secrets.signingSecret ?? '', body, ts),
        [WEBHOOK_HEADERS.event]: 'audit',
        ...(secrets.token ? { authorization: `Bearer ${secrets.token}` } : {}),
      },
      opts,
    );
  }
  return sendSyslogTls(s.settings.host ?? '', s.settings.port ?? 6514, syslogMessages(rs, host()), { ...opts, ca: s.settings.caCert });
}

const retryDelay = (failures: number) => Math.min(MAX_RETRY_DELAY_MS, getConfig().siem.retryBaseMs * 4 ** Math.max(0, failures - 1));

/** One sink: its next batches, in order, until it is caught up, fails, or the run's share is used. */
async function deliverSink(s: repo.SinkRow, now: number): Promise<number> {
  let sent = 0;
  let cursor = s.cursorSeq;
  let anchoredAt = s.anchoredAt;
  for (let b = 0; b < BATCHES_PER_RUN; b++) {
    const events = await workspaceEventsAfter(s.workspaceId, cursor, BATCH);
    const caughtUp = events.length < BATCH;
    let head: HeadCheckpoint | null = null;
    if (caughtUp && (anchoredAt === null || now - anchoredAt >= ANCHOR_EVERY_MS)) {
      const signed = await signedWorkspaceHead(s.workspaceId, now);
      if (signed && signed.seq > s.anchoredSeq) head = signed;
    }
    if (!events.length && !head) return sent;
    const outcome = await send({ ...s, cursorSeq: cursor }, records(s.workspaceId, await toAuditEvents(events), head));
    sends.inc({ outcome: outcome.ok ? 'delivered' : 'failed' });
    if (!outcome.ok) {
      const failures = s.consecutiveFailures + 1;
      await repo.markFailed(s.id, outcome.error ?? 'Failed', now + retryDelay(failures), Date.now());
      if (failures === 1 || failures % 10 === 0) log(`siem: stream ${s.id} of workspace ${s.workspaceId} failed (${failures} in a row): ${outcome.error}`);
      return sent;
    }
    const last = events.length ? events[events.length - 1].seq : cursor;
    await repo.markDelivered(s.id, cursor, last, head, Date.now());
    if (head) anchoredAt = now;
    sent += events.length;
    cursor = last;
    if (caughtUp) return sent;
  }
  return sent;
}

/** Sends what every due sink hasn't received yet (the delivery job; tests call it). Returns events sent. */
export async function deliverDueSinks(now = Date.now()): Promise<number> {
  if (!getConfig().siem.enabled) return 0;
  let n = 0;
  for (const s of await repo.dueSinks(now, 50)) {
    try {
      n += await deliverSink(s, now);
    } catch (e) {
      logError(`siem: stream ${s.id} could not be delivered`, e);
    }
  }
  return n;
}
