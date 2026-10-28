// Tracker connections: who may manage and use them, their credentials (sealed at rest, opened only
// to make a call), and the authenticated call every provider makes through.
//
// - A TEAM connection belongs to a team workspace: its owners/admins manage it (admin console),
//   its full members (not guests) use it on the workspace's boards. Freero acts in the tracker as
//   the account behind its credentials (a service account, typically).
// - A PERSONAL connection is one person's own credentials: only they manage it, and only they
//   use it, on any board they can edit. Signing out everywhere (password reset, "this wasn't me",
//   suspension…) erases its credentials: an account taken back must not leave a way into the
//   person's tracker.
// Credentials and webhook secrets never leave the server: no route returns them (the webhook
// secret is shown once, when made), logs never include them, errors are Freero's own words.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { TRACKER_PROVIDERS, type TrackerConnectionInfo, type TrackerConnectionInput, type TrackerProviderKind } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { appUrl } from '../../platform/mail';
import { seal, unseal } from '../../platform/secrets';
import { requireAdmin } from '../admin/index';
import { recordAudit } from '../audit/index';
import { workspaceRole } from '../workspaces/index';
import { checkTrackerUrl, trackerRequest, TrackerError } from './http';
import { oauthProviderOf, providerOf, type Credentials, type ProviderConnection } from './providers/index';
import * as repo from './repo';
import type { StoredConnection } from './repo';

export const CREDENTIALS_PURPOSE = 'tracker-credentials-v1';
export const WEBHOOK_PURPOSE = 'tracker-webhook-secret-v1';
const PROVIDERS = Object.keys(TRACKER_PROVIDERS) as TrackerProviderKind[];

export const rules = () => ({
  allowPrivate: getConfig().trackers.privateEndpoints,
});

// ---- who may manage / use ----

/** 404 unless `userId` manages the connection (its owner; a team's owners/admins). */
export async function requireManaged(id: string, userId: string): Promise<StoredConnection> {
  const c = await repo.getConnection(id);
  if (!c) throw notFound('No such tracker connection');
  if (c.ownerId) {
    if (c.ownerId !== userId) throw notFound('No such tracker connection');
  } else {
    try {
      await requireAdmin(c.workspaceId!, userId);
    } catch {
      throw notFound('No such tracker connection');
    }
  }
  return c;
}

/** Connections `userId` may use on a board of `workspaceId`: the team's (full members) and their own. */
export async function usableConnections(workspaceId: string, userId: string): Promise<StoredConnection[]> {
  const role = await workspaceRole(workspaceId, userId);
  const team = role && role !== 'guest' ? await repo.listConnections({ workspaceId }) : [];
  return [...team, ...(await repo.listConnections({ ownerId: userId }))];
}

/** One connection `userId` may use on a board of `workspaceId`, else 404. */
export async function requireUsable(id: unknown, workspaceId: string, userId: string): Promise<StoredConnection> {
  if (typeof id !== 'string' || !id) throw badRequest('connectionId is required');
  const hit = (await usableConnections(workspaceId, userId)).find((c) => c.id === id);
  if (!hit) throw notFound('No such tracker connection here');
  if (hit.status === 'needs_auth' || !hit.credentialsSealed) throw new HttpError(409, `${hit.name} needs to be connected again before it can be used`, 'tracker_needs_auth');
  return hit;
}

// ---- credentials and calls ----

function openCredentials(c: StoredConnection): Credentials {
  if (!c.credentialsSealed) throw new TrackerError(`${c.name} needs to be connected again.`, 'auth');
  const opened = unseal(CREDENTIALS_PURPOSE, c.credentialsSealed);
  if (!opened) throw new TrackerError(`${c.name}’s credentials can’t be read any more (the server’s secret changed): connect it again.`, 'auth');
  if (opened.stale) void repo.resealCredentials(c.id, c.credentialsSealed, seal(CREDENTIALS_PURPOSE, opened.value));
  return JSON.parse(opened.value) as Credentials;
}

const sealCredentials = (creds: Credentials) => seal(CREDENTIALS_PURPOSE, JSON.stringify(creds));

/**
 * OAuth access tokens are refreshed shortly before they expire (and once after a 401). Refresh
 * tokens ROTATE (each works once), so the new pair is kept at once — on the connection object in
 * hand too, which may not be stored yet (a connection is tested before it is saved) — and a pair
 * someone else stored meanwhile (another instance's refresh) is used instead of refreshing again.
 */
async function refreshed(c: StoredConnection, creds: Extract<Credentials, { kind: 'oauth' }>, force: boolean): Promise<Credentials> {
  const app = getConfig().trackers.jiraOAuth;
  const oauth = oauthProviderOf(c.provider);
  if (!app || !oauth || !creds.refreshToken) throw new TrackerError(`${c.name}’s authorization expired: connect it again.`, 'auth', 401);
  const stored = await repo.getConnection(c.id);
  if (!force && stored?.credentialsSealed && stored.credentialsSealed !== c.credentialsSealed) {
    c.credentialsSealed = stored.credentialsSealed;
    const theirs = openCredentials(c);
    if (theirs.kind === 'oauth' && (theirs.expiresAt === null || theirs.expiresAt > Date.now() + 60_000)) return theirs;
    if (theirs.kind === 'oauth') creds = theirs;
  }
  const next = await oauth.refresh({ clientId: app.clientId, clientSecret: app.clientSecret, refreshToken: creds.refreshToken! });
  c.credentialsSealed = sealCredentials(next);
  if (stored) await repo.updateConnection(c.id, { credentialsSealed: c.credentialsSealed });
  return next;
}

/** The connection as its provider uses it: every call authenticated, rate limited and retried. */
export function openConnection(c: StoredConnection): ProviderConnection {
  const provider = providerOf(c.provider);
  let creds: Credentials | null = null;
  const base = c.apiBase.replace(/\/+$/, '');
  return {
    id: c.id,
    provider: c.provider,
    site: c.site,
    apiBase: base,
    deployment: c.deployment,
    settings: c.settings,
    async call(req) {
      if (c.cooldownUntil && c.cooldownUntil > Date.now())
        throw new TrackerError(`${TRACKER_PROVIDERS[c.provider]} asked Freero to slow down; the sync will try again shortly.`, 'rate', 429, c.cooldownUntil - Date.now());
      creds ??= openCredentials(c);
      if (creds.kind === 'oauth' && creds.expiresAt !== null && creds.expiresAt < Date.now() + 60_000) creds = await refreshed(c, creds, false);
      const url = req.path.startsWith('http') ? req.path : `${base}${req.path}`;
      if (!url.startsWith(base)) throw new TrackerError('Freero only calls the connection’s own address.', 'refused');
      const send = (cr: Credentials) =>
        trackerRequest(
          {
            ...req,
            url,
            headers: { ...provider.authHeaders(cr, c), ...req.headers },
          },
          rules(),
        );
      try {
        let res = await send(creds);
        if (res.status === 401 && creds.kind === 'oauth') {
          creds = await refreshed(c, creds, true);
          res = await send(creds);
        }
        return res;
      } catch (e) {
        if (e instanceof TrackerError && e.kind === 'rate' && e.retryAfterMs) {
          c.cooldownUntil = Date.now() + e.retryAfterMs;
          await repo.setCooldown(c.id, c.cooldownUntil);
        }
        throw e;
      }
    },
  };
}

/** Remembers how the last call to the tracker went (shown to whoever manages the connection). */
export async function noteOutcome(c: StoredConnection, error: unknown): Promise<void> {
  if (!error) return repo.noteConnectionStatus(c.id, 'active', null);
  if (error instanceof TrackerError && error.kind === 'auth') return repo.noteConnectionStatus(c.id, c.auth === 'oauth' ? 'needs_auth' : 'error', error.message);
}

// ---- managing ----

const str = (v: unknown, what: string, max: number): string => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${what} is required`);
  if (v.length > max) throw badRequest(`${what} is too long`);
  return v.trim();
};

/** Where a provider's API lives for a site people typed. */
export function apiBaseOf(provider: TrackerProviderKind, site: string): string {
  const s = site.replace(/\/+$/, '');
  if (provider === 'github') return s === 'https://github.com' ? 'https://api.github.com' : `${s}/api/v3`;
  if (provider === 'linear') return s === 'https://linear.app' ? 'https://api.linear.app' : s;
  return s;
}

const defaultSite: Partial<Record<TrackerProviderKind, string>> = {
  github: 'https://github.com',
  linear: 'https://linear.app',
};

export function info(c: StoredConnection, links: number, req: Request | null, manager: boolean): TrackerConnectionInfo {
  return {
    id: c.id,
    provider: c.provider,
    name: c.name,
    scope: c.ownerId ? 'personal' : 'workspace',
    workspaceId: c.workspaceId,
    site: c.site,
    deployment: c.deployment,
    auth: c.auth,
    inbound: c.inbound,
    status: c.status,
    lastError: c.lastError,
    account: c.settings.account ?? null,
    defaults: {
      project: c.settings.project ?? null,
      issueType: c.settings.issueType ?? null,
    },
    ...(manager
      ? {
          webhookUrl: appUrl(req, `/api/trackers/webhooks/${encodeURIComponent(c.id)}`),
        }
      : {}),
    links,
    createdAt: c.createdAt,
  };
}

/** Asks the tracker who the credentials are; remembers the account and what it found. */
export async function testConnection(c: StoredConnection): Promise<StoredConnection> {
  try {
    const me = await providerOf(c.provider).whoAmI(openConnection(c));
    const updated = await repo.updateConnection(c.id, {
      settings: { ...c.settings, ...me.settings, account: me.account },
      status: 'active',
      lastError: null,
    });
    return updated ?? c;
  } catch (e) {
    await noteOutcome(c, e);
    throw e instanceof TrackerError ? new HttpError(e.kind === 'auth' ? 400 : 502, e.message, 'tracker_refused') : e;
  }
}

const newWebhookSecret = () => randomBytes(32).toString('base64url');

/** Audit target and log of a connection: the team's log, or the person's own. */
const auditOf = (c: Pick<StoredConnection, 'id' | 'name' | 'workspaceId' | 'ownerId'>) => ({
  ...(c.workspaceId ? { workspaceId: c.workspaceId } : { accountId: c.ownerId!, fanOut: false }),
  target: { type: 'tracker_connection', id: c.id, label: c.name },
});

function defaultsOf(v: unknown): {
  project?: string | null;
  issueType?: string | null;
} {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw badRequest('defaults must be an object');
  const d = v as Record<string, unknown>;
  const one = (x: unknown, what: string) => (x === undefined ? undefined : x === null || x === '' ? null : str(x, what, 200));
  return {
    project: one(d.project, 'defaults.project'),
    issueType: one(d.issueType, 'defaults.issueType'),
  };
}

export async function createConnection(userId: string, body: unknown, req: Request | null): Promise<{ connection: TrackerConnectionInfo; webhookSecret: string }> {
  const b = (body ?? {}) as Partial<TrackerConnectionInput> & Record<string, unknown>;
  if (!PROVIDERS.includes(b.provider as TrackerProviderKind)) throw badRequest(`provider must be ${PROVIDERS.join(', ')}`);
  const provider = b.provider as TrackerProviderKind;
  const workspaceId = typeof b.workspaceId === 'string' && b.workspaceId ? b.workspaceId : null;
  if (workspaceId) await requireAdmin(workspaceId, userId);
  const name = str(b.name, 'name', 80);
  const siteRaw = typeof b.site === 'string' && b.site.trim() ? b.site.trim() : (defaultSite[provider] ?? '');
  let site: string;
  try {
    const u = checkTrackerUrl(siteRaw, rules());
    site = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch (e) {
    throw badRequest(e instanceof TrackerError ? e.message : 'site must be the tracker’s address');
  }
  const deployment = provider === 'jira' ? (b.deployment === 'datacenter' ? 'datacenter' : 'cloud') : null;
  const token = str(b.token, 'token', 4000);
  const email = provider === 'jira' && deployment === 'cloud' ? str(b.email, 'email (the Jira account the API token belongs to)', 254) : undefined;
  const inbound = b.inbound === 'polling' ? 'polling' : 'webhook';
  const webhookSecret = newWebhookSecret();
  const stored: StoredConnection = {
    id: newId(16),
    workspaceId,
    ownerId: workspaceId ? null : userId,
    provider,
    name,
    site,
    apiBase: apiBaseOf(provider, site),
    deployment,
    auth: 'token',
    credentialsSealed: sealCredentials({
      kind: 'token',
      token,
      ...(email ? { email } : {}),
    }),
    webhookSecretSealed: seal(WEBHOOK_PURPOSE, webhookSecret),
    inbound,
    settings: defaultsOf(b.defaults),
    status: 'active',
    lastError: null,
    cooldownUntil: null,
    polledAt: null,
    createdBy: userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Test before keeping it: a typo'd token never becomes a connection people try to use.
  try {
    const me = await providerOf(provider).whoAmI(openConnection(stored));
    stored.settings = {
      ...stored.settings,
      ...me.settings,
      account: me.account,
    };
  } catch (e) {
    if (e instanceof TrackerError) throw new HttpError(400, e.message, 'tracker_refused');
    throw e;
  }
  await repo.transaction(async () => {
    await repo.insertConnection(stored);
    await recordAudit({
      action: 'tracker.connection_created',
      ...auditOf(stored),
      metadata: {
        provider,
        site,
        inbound,
        scope: workspaceId ? 'workspace' : 'personal',
      },
    });
  });
  return { connection: info(stored, 0, req, true), webhookSecret };
}

/** A connection made by an OAuth consent (oauth.ts). */
export async function createOAuthConnection(
  userId: string,
  p: {
    workspaceId: string | null;
    provider: TrackerProviderKind;
    name: string;
    site: string;
    apiBase: string;
    credentials: Credentials;
  },
): Promise<StoredConnection> {
  const stored: StoredConnection = {
    id: newId(16),
    workspaceId: p.workspaceId,
    ownerId: p.workspaceId ? null : userId,
    provider: p.provider,
    name: p.name,
    site: p.site,
    apiBase: p.apiBase,
    deployment: p.provider === 'jira' ? 'cloud' : null,
    auth: 'oauth',
    credentialsSealed: sealCredentials(p.credentials),
    webhookSecretSealed: seal(WEBHOOK_PURPOSE, newWebhookSecret()),
    // OAuth apps can't use a site admin's secret-signed webhooks: changes come by polling.
    inbound: 'polling',
    settings: {},
    status: 'active',
    lastError: null,
    cooldownUntil: null,
    polledAt: null,
    createdBy: userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const me = await providerOf(p.provider).whoAmI(openConnection(stored));
  stored.settings = { ...me.settings, account: me.account };
  await repo.transaction(async () => {
    await repo.insertConnection(stored);
    await recordAudit({
      action: 'tracker.connection_created',
      ...auditOf(stored),
      metadata: {
        provider: p.provider,
        site: p.site,
        auth: 'oauth',
        scope: p.workspaceId ? 'workspace' : 'personal',
      },
    });
  });
  return stored;
}

export async function updateConnection(id: string, userId: string, body: unknown, req: Request | null): Promise<TrackerConnectionInfo> {
  const c = await requireManaged(id, userId);
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: repo.ConnectionPatch = {};
  const changed: string[] = [];
  if (b.name !== undefined) {
    patch.name = str(b.name, 'name', 80);
    changed.push('name');
  }
  if (b.inbound !== undefined) {
    if (b.inbound !== 'webhook' && b.inbound !== 'polling') throw badRequest('inbound must be webhook or polling');
    patch.inbound = b.inbound;
    changed.push('inbound');
  }
  if (b.defaults !== undefined) {
    const d = defaultsOf(b.defaults);
    patch.settings = {
      ...c.settings,
      ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)),
    };
    changed.push('defaults');
  }
  if (b.token !== undefined) {
    if (c.auth !== 'token') throw badRequest('This connection signs in with OAuth: connect it again instead');
    const token = str(b.token, 'token', 4000);
    const prev = (() => {
      try {
        return openCredentials(c);
      } catch {
        return null;
      }
    })();
    const email = b.email !== undefined ? str(b.email, 'email', 254) : prev?.kind === 'token' ? prev.email : undefined;
    patch.credentialsSealed = sealCredentials({
      kind: 'token',
      token,
      ...(email ? { email } : {}),
    });
    patch.status = 'active';
    patch.lastError = null;
    changed.push('credentials');
  }
  if (!changed.length) throw badRequest('Nothing to change');
  let next = await repo.transaction(async () => {
    const u = await repo.updateConnection(c.id, patch);
    await recordAudit({
      action: 'tracker.connection_updated',
      ...auditOf(c),
      metadata: { changed },
    });
    return u;
  });
  if (!next) throw notFound('No such tracker connection');
  if (patch.credentialsSealed) next = await testConnection(next);
  return info(next, (await repo.countLinks([c.id])).get(c.id) ?? 0, req, true);
}

/** A new webhook secret (shown once); the previous one stops verifying at once. */
export async function rotateWebhookSecret(id: string, userId: string): Promise<string> {
  const c = await requireManaged(id, userId);
  const secret = newWebhookSecret();
  await repo.transaction(async () => {
    await repo.updateConnection(c.id, {
      webhookSecretSealed: seal(WEBHOOK_PURPOSE, secret),
    });
    await recordAudit({
      action: 'tracker.webhook_secret_rotated',
      ...auditOf(c),
    });
  });
  return secret;
}

export function webhookSecretOf(c: StoredConnection): string | null {
  if (!c.webhookSecretSealed) return null;
  return unseal(WEBHOOK_PURPOSE, c.webhookSecretSealed)?.value ?? null;
}

export async function listManaged(userId: string, workspaceId: string | null, req: Request | null): Promise<TrackerConnectionInfo[]> {
  if (workspaceId) await requireAdmin(workspaceId, userId);
  const list = await repo.listConnections(workspaceId ? { workspaceId } : { ownerId: userId });
  const counts = await repo.countLinks(list.map((c) => c.id));
  return list.map((c) => info(c, counts.get(c.id) ?? 0, req, true));
}

/** Records the deletion; the caller (service) leaves the boards' items as they are. */
export async function deleteConnectionRecord(
  id: string,
  userId: string,
): Promise<{
  connection: StoredConnection;
  links: Array<{ boardId: string; linkId: string; createdBy: string }>;
}> {
  const c = await requireManaged(id, userId);
  const links = await repo.transaction(async () => {
    const l = await repo.deleteConnection(c.id);
    await recordAudit({
      action: 'tracker.connection_removed',
      ...auditOf(c),
      metadata: { provider: c.provider, links: l.length },
    });
    return l;
  });
  return { connection: c, links };
}

/** sha256, hex: OAuth state and the browser binding are stored only as hashes. */
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
