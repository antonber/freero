// The only writer of `tracker_connections`, `tracker_links`, `tracker_link_sources`,
// `tracker_proposals`, `tracker_oauth_flows` and `tracker_webhooks` [S4].
import type { FieldMapEntry, SyncBase, TrackerProviderKind } from '@freero/shared';
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
  /** Jira: the custom field holding an issue's start date ("Start date"; discovered by the test). */
  startDateField?: string | null;
  /** Jira: the custom field holding an issue's sprints (discovered by the test, #119). */
  sprintField?: string | null;
  /** Jira Data Center: the "Epic Link" field (an issue's epic; Cloud uses `parent`). */
  epicLinkField?: string | null;
  /** The estimate / start date fields were picked by a manager (#43): a test no longer rediscovers them. */
  fieldsPicked?: boolean;
  /** Issue (work item) type by project key, before `issueType` (#43). */
  issueTypes?: Record<string, string>;
  /** Tracker fields paired with kanban fields (#43). */
  fieldMap?: FieldMapEntry[];
  /** The tracker's id for the account Freero acts as (monday.com: whose updates Freero may edit). */
  accountId?: string | null;
  /** Asana: the workspace searches, tags and custom fields come from (the account's first, from the test). */
  workspace?: string | null;
  /** monday.com: the account's address ("https://acme.monday.com"), for item links. */
  accountUrl?: string | null;
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

/** The links a person made (their data export), with each one's connection and tracker. */
export async function linksMadeBy(userId: string): Promise<Array<StoredLink & { provider: TrackerProviderKind; connectionName: string }>> {
  const rows = await query<LinkRow & { provider: TrackerProviderKind; connection_name: string }>(
    `SELECT l.*, c.provider, c.name AS connection_name, (SELECT array_agg(s.element_id ORDER BY s.position) FROM tracker_link_sources s WHERE s.link_id = l.id) AS sources
       FROM tracker_links l JOIN tracker_connections c ON c.id = l.connection_id WHERE l.created_by = $1 ORDER BY l.created_at`,
    [userId],
  );
  return rows.map((r) => ({ ...toLink(r), provider: r.provider, connectionName: r.connection_name }));
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

// ---- proposed imports (#82) ----

export interface StoredProposal {
  boardId: string;
  itemId: string;
  groupId: string;
  connectionId: string;
  externalId: string;
  externalKey: string;
  externalUrl: string;
  proposedBy: string;
  appOrigin: string;
  decidedBy: string | null;
}

/** The issues a suggestion group's proposed cards stand for (a card proposed twice keeps its first). */
export async function insertProposals(rows: Array<Omit<StoredProposal, 'decidedBy'>>, at = Date.now()): Promise<void> {
  for (const p of rows)
    await query(
      `INSERT INTO tracker_proposals (board_id, item_id, group_id, connection_id, external_id, external_key, external_url, proposed_by, app_origin, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (board_id, item_id) DO NOTHING`,
      [p.boardId, p.itemId, p.groupId, p.connectionId, p.externalId, p.externalKey, p.externalUrl, p.proposedBy, p.appOrigin, new Date(at)],
    );
}

/**
 * Records a suggestion decision on proposed cards (`decision` null: undone, pending again — and
 * not linked any more: an undone accept takes the card off the board). Returns how many rows it
 * changed. Matched by board, group AND item, so only the proposal's own records decide it.
 */
export async function decideProposals(boardId: string, decided: Array<{ groupId: string; itemId: string }>, decision: 'accepted' | 'rejected' | null, by: string, at = Date.now()): Promise<number> {
  let n = 0;
  for (const d of decided) {
    const r = await query<{ item_id: string }>(
      `UPDATE tracker_proposals SET decision = $4, decided_by = $5, decided_at = $6, linked_at = NULL
        WHERE board_id = $1 AND group_id = $2 AND item_id = $3 RETURNING item_id`,
      [boardId, d.groupId, d.itemId, decision, decision ? by : null, decision ? new Date(at) : null],
    );
    n += r.length;
  }
  return n;
}

/** Accepted proposed cards of a board not linked yet. */
export async function proposalsToLink(boardId: string): Promise<StoredProposal[]> {
  const rows = await query<{
    board_id: string;
    item_id: string;
    group_id: string;
    connection_id: string;
    external_id: string;
    external_key: string;
    external_url: string;
    proposed_by: string;
    app_origin: string;
    decided_by: string | null;
  }>(`SELECT * FROM tracker_proposals WHERE board_id = $1 AND decision = 'accepted' AND linked_at IS NULL ORDER BY created_at, item_id`, [boardId]);
  return rows.map((r) => ({
    boardId: r.board_id,
    itemId: r.item_id,
    groupId: r.group_id,
    connectionId: r.connection_id,
    externalId: r.external_id,
    externalKey: r.external_key,
    externalUrl: r.external_url,
    proposedBy: r.proposed_by,
    appOrigin: r.app_origin,
    decidedBy: r.decided_by,
  }));
}

export async function boardHasProposalsToLink(boardId: string): Promise<boolean> {
  return !!(await one(`SELECT 1 FROM tracker_proposals WHERE board_id = $1 AND decision = 'accepted' AND linked_at IS NULL LIMIT 1`, [boardId]));
}

export async function markProposalLinked(boardId: string, itemId: string, at = Date.now()): Promise<void> {
  await query(`UPDATE tracker_proposals SET linked_at = $3 WHERE board_id = $1 AND item_id = $2`, [boardId, itemId, new Date(at)]);
}

/** A proposed card that can't be linked (its issue or item is linked otherwise, access is gone): it stays a plain card. */
export async function dropProposal(boardId: string, itemId: string): Promise<void> {
  await query(`DELETE FROM tracker_proposals WHERE board_id = $1 AND item_id = $2`, [boardId, itemId]);
}

/** Forgets proposals decided before `before` (their suggestions are pruned; nothing can undo them). */
export async function pruneProposals(before: number): Promise<number> {
  return (await query<{ item_id: string }>(`DELETE FROM tracker_proposals WHERE decided_at IS NOT NULL AND decided_at < $1 RETURNING item_id`, [new Date(before)])).length;
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

// ---- webhooks Freero registers itself (Asana, monday.com) ----

export interface StoredHook {
  id: string;
  connectionId: string;
  project: string;
  externalId: string | null;
  secretSealed: string | null;
  state: 'pending' | 'active' | 'failed';
  lastError: string | null;
  appOrigin: string;
  createdAt: number;
  updatedAt: number;
}

interface HookRow {
  id: string;
  connection_id: string;
  project: string;
  external_id: string | null;
  secret_sealed: string | null;
  state: StoredHook['state'];
  last_error: string | null;
  app_origin: string;
  created_at: Date;
  updated_at: Date;
}

const toHook = (r: HookRow): StoredHook => ({
  id: r.id,
  connectionId: r.connection_id,
  project: r.project,
  externalId: r.external_id,
  secretSealed: r.secret_sealed,
  state: r.state,
  lastError: r.last_error,
  appOrigin: r.app_origin,
  createdAt: ms(r.created_at)!,
  updatedAt: ms(r.updated_at)!,
});

export async function getHook(id: string): Promise<StoredHook | null> {
  const r = await one<HookRow>(`SELECT * FROM tracker_webhooks WHERE id = $1`, [id]);
  return r ? toHook(r) : null;
}

export async function hooksOfConnection(connectionId: string): Promise<StoredHook[]> {
  return (await query<HookRow>(`SELECT * FROM tracker_webhooks WHERE connection_id = $1 ORDER BY created_at`, [connectionId])).map(toHook);
}

/**
 * Starts registering a project's webhook under a new id, unless one is active or another
 * registration is under way (pending, younger than `staleBefore`): true when this call may register.
 */
export async function claimHook(connectionId: string, project: string, id: string, appOrigin: string, staleBefore: number, at = Date.now()): Promise<boolean> {
  const r = await query(
    `INSERT INTO tracker_webhooks (id, connection_id, project, state, app_origin, created_at, updated_at) VALUES ($1, $2, $3, 'pending', $4, $5, $5)
     ON CONFLICT (connection_id, project) DO UPDATE SET id = EXCLUDED.id, state = 'pending', external_id = NULL, secret_sealed = NULL, last_error = NULL,
       app_origin = EXCLUDED.app_origin, updated_at = EXCLUDED.updated_at
     WHERE tracker_webhooks.state = 'failed' OR (tracker_webhooks.state = 'pending' AND tracker_webhooks.updated_at < $6)
     RETURNING id`,
    [id, connectionId, project, appOrigin, new Date(at), new Date(staleBefore)],
  );
  return r.length > 0;
}

/** Keeps the secret a handshake issued: only for a pending registration that has none yet. */
export async function keepHookSecret(id: string, sealed: string, notBefore: number): Promise<boolean> {
  const r = await query(`UPDATE tracker_webhooks SET secret_sealed = $2 WHERE id = $1 AND state = 'pending' AND secret_sealed IS NULL AND updated_at >= $3 RETURNING id`, [id, sealed, new Date(notBefore)]);
  return r.length > 0;
}

export async function activateHook(id: string, externalId: string, at = Date.now()): Promise<void> {
  await query(`UPDATE tracker_webhooks SET state = 'active', external_id = $2, last_error = NULL, updated_at = $3 WHERE id = $1`, [id, externalId, new Date(at)]);
}

export async function failHook(id: string, error: string, externalId: string | null = null, at = Date.now()): Promise<void> {
  await query(`UPDATE tracker_webhooks SET state = 'failed', external_id = $3, secret_sealed = NULL, last_error = $2, updated_at = $4 WHERE id = $1`, [id, error.slice(0, 500), externalId, new Date(at)]);
}

/** Failed registrations of webhook connections last tried before `before` (the poll job retries them). */
export async function hooksToRetry(before: number, limit = 50): Promise<StoredHook[]> {
  return (
    await query<HookRow>(
      `SELECT h.* FROM tracker_webhooks h JOIN tracker_connections c ON c.id = h.connection_id
       WHERE h.state = 'failed' AND h.updated_at < $1 AND c.inbound = 'webhook' AND c.status = 'active' ORDER BY h.updated_at LIMIT $2`,
      [new Date(before), limit],
    )
  ).map(toHook);
}
