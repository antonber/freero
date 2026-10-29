// The only writer of `tracker_connections`, `tracker_links`, `tracker_link_sources` and
// `tracker_oauth_flows` [S4].
import type { SyncBase, TrackerProviderKind } from '@freero/shared';
import { isUniqueViolation, one, query, tx } from '../../platform/db';

/** Runs fn in one transaction (a change, its audit record and its outbox event commit together). */
export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export interface ConnectionSettings {
  project?: string | null;
  issueType?: string | null;
  /** The tracker account Freero acts as (from the last test). */
  account?: string | null;
  /** Jira: the custom field holding story points (discovered by the test). */
  estimateField?: string | null;
}

export interface StoredConnection {
  id: string;
  workspaceId: string | null;
  ownerId: string | null;
  provider: TrackerProviderKind;
  name: string;
  site: string;
  apiBase: string;
  deployment: 'cloud' | 'datacenter' | null;
  auth: 'oauth' | 'token';
  credentialsSealed: string | null;
  webhookSecretSealed: string | null;
  inbound: 'webhook' | 'polling';
  settings: ConnectionSettings;
  status: 'active' | 'error' | 'needs_auth';
  lastError: string | null;
  cooldownUntil: number | null;
  polledAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ConnectionRow {
  id: string;
  workspace_id: string | null;
  owner_id: string | null;
  provider: TrackerProviderKind;
  name: string;
  site: string;
  api_base: string;
  deployment: 'cloud' | 'datacenter' | null;
  auth: 'oauth' | 'token';
  credentials_sealed: string | null;
  webhook_secret_sealed: string | null;
  inbound: 'webhook' | 'polling';
  settings: ConnectionSettings | string;
  status: 'active' | 'error' | 'needs_auth';
  last_error: string | null;
  cooldown_until: Date | null;
  polled_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);
const json = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);

const toConnection = (r: ConnectionRow): StoredConnection => ({
  id: r.id,
  workspaceId: r.workspace_id,
  ownerId: r.owner_id,
  provider: r.provider,
  name: r.name,
  site: r.site,
  apiBase: r.api_base,
  deployment: r.deployment,
  auth: r.auth,
  credentialsSealed: r.credentials_sealed,
  webhookSecretSealed: r.webhook_secret_sealed,
  inbound: r.inbound,
  settings: json(r.settings) ?? {},
  status: r.status,
  lastError: r.last_error,
  cooldownUntil: ms(r.cooldown_until),
  polledAt: ms(r.polled_at),
  createdBy: r.created_by,
  createdAt: ms(r.created_at)!,
  updatedAt: ms(r.updated_at)!,
});

export async function insertConnection(c: Omit<StoredConnection, 'cooldownUntil' | 'polledAt' | 'updatedAt'>): Promise<void> {
  await query(
    `INSERT INTO tracker_connections
       (id, workspace_id, owner_id, provider, name, site, api_base, deployment, auth, credentials_sealed, webhook_secret_sealed,
        inbound, settings, status, last_error, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)`,
    [
      c.id,
      c.workspaceId,
      c.ownerId,
      c.provider,
      c.name,
      c.site,
      c.apiBase,
      c.deployment,
      c.auth,
      c.credentialsSealed,
      c.webhookSecretSealed,
      c.inbound,
      JSON.stringify(c.settings),
      c.status,
      c.lastError,
      c.createdBy,
      new Date(c.createdAt),
    ],
  );
}

export async function getConnection(id: string): Promise<StoredConnection | null> {
  const r = await one<ConnectionRow>(`SELECT * FROM tracker_connections WHERE id = $1`, [id]);
  return r ? toConnection(r) : null;
}

/** A team's connections, or one person's own. */
export async function listConnections(owner: { workspaceId: string } | { ownerId: string }): Promise<StoredConnection[]> {
  const rows =
    'workspaceId' in owner
      ? await query<ConnectionRow>(`SELECT * FROM tracker_connections WHERE workspace_id = $1 ORDER BY created_at`, [owner.workspaceId])
      : await query<ConnectionRow>(`SELECT * FROM tracker_connections WHERE owner_id = $1 ORDER BY created_at`, [owner.ownerId]);
  return rows.map(toConnection);
}

/** Every connection that has linked issues (the poll job). */
export async function connectionsWithLinks(): Promise<StoredConnection[]> {
  return (await query<ConnectionRow>(`SELECT c.* FROM tracker_connections c WHERE EXISTS (SELECT 1 FROM tracker_links l WHERE l.connection_id = c.id) ORDER BY c.id`)).map(
    toConnection,
  );
}

export type ConnectionPatch = Partial<
  Pick<StoredConnection, 'name' | 'site' | 'apiBase' | 'deployment' | 'credentialsSealed' | 'webhookSecretSealed' | 'inbound' | 'settings' | 'status' | 'lastError' | 'auth'>
>;

const CONNECTION_COLUMNS: Record<keyof ConnectionPatch, string> = {
  name: 'name',
  site: 'site',
  apiBase: 'api_base',
  deployment: 'deployment',
  credentialsSealed: 'credentials_sealed',
  webhookSecretSealed: 'webhook_secret_sealed',
  inbound: 'inbound',
  settings: 'settings',
  status: 'status',
  lastError: 'last_error',
  auth: 'auth',
};

export async function updateConnection(id: string, patch: ConnectionPatch, at = Date.now()): Promise<StoredConnection | null> {
  const sets: string[] = [];
  const params: unknown[] = [id, new Date(at)];
  for (const [k, v] of Object.entries(patch) as Array<[keyof ConnectionPatch, unknown]>) {
    if (v === undefined) continue;
    params.push(k === 'settings' ? JSON.stringify(v) : v);
    sets.push(`${CONNECTION_COLUMNS[k]} = $${params.length}`);
  }
  const r = await one<ConnectionRow>(`UPDATE tracker_connections SET ${[...sets, 'updated_at = $2'].join(', ')} WHERE id = $1 RETURNING *`, params);
  return r ? toConnection(r) : null;
}

/** Status after a call: only written when it changes (every sync would otherwise write the row). */
export async function noteConnectionStatus(id: string, status: StoredConnection['status'], lastError: string | null): Promise<void> {
  await query(
    `UPDATE tracker_connections SET status = $2, last_error = $3, updated_at = now()
      WHERE id = $1 AND (status IS DISTINCT FROM $2 OR last_error IS DISTINCT FROM $3)`,
    [id, status, lastError],
  );
}

export async function setCooldown(id: string, until: number): Promise<void> {
  await query(`UPDATE tracker_connections SET cooldown_until = GREATEST(COALESCE(cooldown_until, $2), $2) WHERE id = $1`, [id, new Date(until)]);
}

export async function setPolled(id: string, at: number): Promise<void> {
  await query(`UPDATE tracker_connections SET polled_at = $2 WHERE id = $1`, [id, new Date(at)]);
}

/** Erases the sealed credentials of every connection a person owns (they signed out everywhere). */
export async function revokePersonalCredentials(ownerId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE tracker_connections SET credentials_sealed = NULL, status = 'needs_auth',
            last_error = 'Paused because your account was signed out everywhere: connect it again', updated_at = now()
      WHERE owner_id = $1 AND credentials_sealed IS NOT NULL RETURNING id`,
    [ownerId],
  );
  return rows.length;
}

/** Replaces a stale-sealed value only if it is still the one read (another writer wins otherwise). */
export async function resealCredentials(id: string, before: string, after: string): Promise<void> {
  await query(`UPDATE tracker_connections SET credentials_sealed = $3 WHERE id = $1 AND credentials_sealed = $2`, [id, before, after]);
}

/** Deletes a connection (its links go with it); returns the boards that had links and their link ids. */
export async function deleteConnection(id: string): Promise<Array<{ boardId: string; linkId: string; createdBy: string }>> {
  return tx(async (t) => {
    const links = await t.query<{
      id: string;
      board_id: string;
      created_by: string;
    }>(`SELECT id, board_id, created_by FROM tracker_links WHERE connection_id = $1`, [id]);
    await t.query(`DELETE FROM tracker_connections WHERE id = $1`, [id]);
    return links.map((l) => ({
      boardId: l.board_id,
      linkId: l.id,
      createdBy: l.created_by,
    }));
  });
}

export async function countLinks(connectionIds: string[]): Promise<Map<string, number>> {
  if (!connectionIds.length) return new Map();
  const rows = await query<{ connection_id: string; n: number }>(
    `SELECT connection_id, count(*)::int AS n FROM tracker_links WHERE connection_id = ANY($1::text[]) GROUP BY connection_id`,
    [connectionIds],
  );
  return new Map(rows.map((r) => [r.connection_id, Number(r.n)]));
}

// ---- links ----

export interface StoredLink {
  id: string;
  connectionId: string;
  boardId: string;
  externalId: string;
  externalKey: string;
  externalUrl: string;
  createdBy: string;
  appOrigin: string;
  base: SyncBase;
  backlinks: string[];
  state: 'ok' | 'error' | 'paused';
  lastError: string | null;
  attempts: number;
  retryAt: number | null;
  syncedAt: number | null;
  createdAt: number;
  /** Its board items, in order. */
  sources: string[];
}

interface LinkRow {
  id: string;
  connection_id: string;
  board_id: string;
  external_id: string;
  external_key: string;
  external_url: string;
  created_by: string;
  app_origin: string;
  base: SyncBase | string;
  backlinks: string[];
  state: StoredLink['state'];
  last_error: string | null;
  attempts: number;
  retry_at: Date | null;
  synced_at: Date | null;
  created_at: Date;
  sources: string[] | null;
}

const toLink = (r: LinkRow): StoredLink => ({
  id: r.id,
  connectionId: r.connection_id,
  boardId: r.board_id,
  externalId: r.external_id,
  externalKey: r.external_key,
  externalUrl: r.external_url,
  createdBy: r.created_by,
  appOrigin: r.app_origin,
  base: json(r.base) ?? { board: {}, tracker: {} },
  backlinks: r.backlinks ?? [],
  state: r.state,
  lastError: r.last_error,
  attempts: Number(r.attempts),
  retryAt: ms(r.retry_at),
  syncedAt: ms(r.synced_at),
  createdAt: ms(r.created_at)!,
  sources: r.sources ?? [],
});

const LINK_SELECT = `SELECT l.*, (SELECT array_agg(s.element_id ORDER BY s.position) FROM tracker_link_sources s WHERE s.link_id = l.id) AS sources FROM tracker_links l`;

export class ItemAlreadyLinkedError extends Error {}
export class IssueAlreadyLinkedError extends Error {}

/** A new link with its items, in one transaction. An item already in another link refuses it. */
export async function insertLink(l: Omit<StoredLink, 'state' | 'lastError' | 'attempts' | 'retryAt'>): Promise<void> {
  try {
    await tx(async (t) => {
      await t.query(
        `INSERT INTO tracker_links (id, connection_id, board_id, external_id, external_key, external_url, created_by, app_origin, base, backlinks, synced_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          l.id,
          l.connectionId,
          l.boardId,
          l.externalId,
          l.externalKey,
          l.externalUrl,
          l.createdBy,
          l.appOrigin,
          JSON.stringify(l.base),
          l.backlinks,
          l.syncedAt ? new Date(l.syncedAt) : null,
          new Date(l.createdAt),
        ],
      );
      if (l.sources.length)
        await t.query(
          `INSERT INTO tracker_link_sources (link_id, board_id, element_id, position)
           SELECT $1, $2, e, p::int - 1 FROM unnest($3::text[]) WITH ORDINALITY AS u(e, p)`,
          [l.id, l.boardId, l.sources],
        );
    });
  } catch (e) {
    if (isUniqueViolation(e, 'tracker_link_sources_board_id_element_id_key')) throw new ItemAlreadyLinkedError();
    if (isUniqueViolation(e, 'tracker_links_board_id_connection_id_external_id_key')) throw new IssueAlreadyLinkedError();
    throw e;
  }
}

export async function getLink(id: string): Promise<StoredLink | null> {
  const r = await one<LinkRow>(`${LINK_SELECT} WHERE l.id = $1`, [id]);
  return r ? toLink(r) : null;
}

/** Several links with their tracker (the object registry), in one query. */
export async function linksByIds(ids: string[]): Promise<Array<StoredLink & { provider: TrackerProviderKind }>> {
  if (!ids.length) return [];
  const rows = await query<LinkRow & { provider: TrackerProviderKind }>(
    `SELECT l.*, c.provider, (SELECT array_agg(s.element_id ORDER BY s.position) FROM tracker_link_sources s WHERE s.link_id = l.id) AS sources
       FROM tracker_links l JOIN tracker_connections c ON c.id = l.connection_id WHERE l.id = ANY($1::text[])`,
    [ids],
  );
  return rows.map((r) => ({ ...toLink(r), provider: r.provider }));
}

export async function linksOfBoard(boardId: string): Promise<StoredLink[]> {
  return (await query<LinkRow>(`${LINK_SELECT} WHERE l.board_id = $1 ORDER BY l.created_at`, [boardId])).map(toLink);
}

export async function linksOfConnection(connectionId: string): Promise<StoredLink[]> {
  return (await query<LinkRow>(`${LINK_SELECT} WHERE l.connection_id = $1 ORDER BY l.created_at`, [connectionId])).map(toLink);
}

/** Links of a connection to any of these issues (a webhook names issues by the tracker's ids or keys). */
export async function linksToIssues(connectionId: string, issueIds: string[]): Promise<StoredLink[]> {
  if (!issueIds.length) return [];
  return (
    await query<LinkRow>(`${LINK_SELECT} WHERE l.connection_id = $1 AND (l.external_id = ANY($2::text[]) OR l.external_key = ANY($2::text[]))`, [connectionId, issueIds])
  ).map(toLink);
}

/** External ids already linked on a board through a connection (imports skip them). */
export async function linkedIssuesOnBoard(boardId: string, connectionId: string): Promise<Set<string>> {
  const rows = await query<{ external_id: string }>(`SELECT external_id FROM tracker_links WHERE board_id = $1 AND connection_id = $2`, [boardId, connectionId]);
  return new Set(rows.map((r) => r.external_id));
}

/** Which of these items are already in a link (item id → link id). */
export async function linkedItems(boardId: string, elementIds: string[]): Promise<Map<string, string>> {
  if (!elementIds.length) return new Map();
  const rows = await query<{ element_id: string; link_id: string }>(`SELECT element_id, link_id FROM tracker_link_sources WHERE board_id = $1 AND element_id = ANY($2::text[])`, [
    boardId,
    elementIds,
  ]);
  return new Map(rows.map((r) => [r.element_id, r.link_id]));
}

export async function boardHasLinks(boardId: string): Promise<boolean> {
  return !!(await one(`SELECT 1 FROM tracker_links WHERE board_id = $1 LIMIT 1`, [boardId]));
}

/** After a sync: what both sides agree on now, the items whose backlink the tracker holds. */
export async function markSynced(id: string, base: SyncBase, backlinks: string[], at = Date.now()): Promise<void> {
  await query(`UPDATE tracker_links SET base = $2, backlinks = $3, state = 'ok', last_error = NULL, attempts = 0, retry_at = NULL, synced_at = $4 WHERE id = $1`, [
    id,
    JSON.stringify(base),
    backlinks,
    new Date(at),
  ]);
}

/** A failed sync: why, and when to try again (null: not until something changes). */
export async function markFailed(id: string, state: 'error' | 'paused', error: string, retryAt: number | null): Promise<number> {
  const r = await one<{ attempts: number }>(`UPDATE tracker_links SET state = $2, last_error = $3, attempts = attempts + 1, retry_at = $4 WHERE id = $1 RETURNING attempts`, [
    id,
    state,
    error,
    retryAt === null ? null : new Date(retryAt),
  ]);
  return r ? Number(r.attempts) : 0;
}

/** Items no longer on the board leave the link (the issue stays). */
export async function removeSources(linkId: string, elementIds: string[]): Promise<void> {
  if (elementIds.length) await query(`DELETE FROM tracker_link_sources WHERE link_id = $1 AND element_id = ANY($2::text[])`, [linkId, elementIds]);
}

export async function deleteLink(id: string): Promise<void> {
  await query(`DELETE FROM tracker_links WHERE id = $1`, [id]);
}

/** Links whose retry is due, taken (their retry cleared) so the job queues each once. */
export async function claimRetries(now = Date.now(), limit = 200): Promise<string[]> {
  return (
    await query<{ id: string }>(
      `UPDATE tracker_links SET retry_at = NULL
        WHERE id IN (SELECT id FROM tracker_links WHERE retry_at IS NOT NULL AND retry_at <= $1 ORDER BY retry_at LIMIT $2)
        RETURNING id`,
      [new Date(now), limit],
    )
  ).map((r) => r.id);
}

// ---- OAuth flows ----

export interface OAuthFlow {
  provider: TrackerProviderKind;
  userId: string;
  workspaceId: string | null;
  browserHash: string;
  name: string;
}

export async function insertFlow(stateHash: string, f: OAuthFlow, expiresAt: number): Promise<void> {
  await query(`DELETE FROM tracker_oauth_flows WHERE expires_at < now()`);
  await query(`INSERT INTO tracker_oauth_flows (state_hash, provider, user_id, workspace_id, browser_hash, name, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
    stateHash,
    f.provider,
    f.userId,
    f.workspaceId,
    f.browserHash,
    f.name,
    new Date(expiresAt),
  ]);
}

/** Takes a flow (single use: deleted in the same statement), unless expired. */
export async function takeFlow(stateHash: string): Promise<OAuthFlow | null> {
  const r = await one<{
    provider: TrackerProviderKind;
    user_id: string;
    workspace_id: string | null;
    browser_hash: string;
    name: string;
  }>(`DELETE FROM tracker_oauth_flows WHERE state_hash = $1 AND expires_at > now() RETURNING provider, user_id, workspace_id, browser_hash, name`, [stateHash]);
  return r
    ? {
        provider: r.provider,
        userId: r.user_id,
        workspaceId: r.workspace_id,
        browserHash: r.browser_hash,
        name: r.name,
      }
    : null;
}
