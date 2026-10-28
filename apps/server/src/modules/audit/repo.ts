// The only writer of `audit_events` and `audit_chains` [S4]. Events are only ever inserted, and
// deleted only by pruneChain (the oldest ones of a chain, under the database's append-only trigger).
import type { AuditMetadata } from '@freero/shared';
import { one, query, tx } from '../../platform/db';
import { type ChainHead, eventHash, GENESIS_HASH, type StoredLink } from './chain';

export interface NewEvent {
  chain: string;
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: AuditMetadata;
  createdAt: number;
}

export interface StoredEvent extends StoredLink {
  id: string;
}

interface Row {
  id: string | number;
  chain: string;
  seq: string | number;
  workspace_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: AuditMetadata | string;
  created_at: Date;
  prev_hash: string;
  hash: string;
}

const toEvent = (r: Row): StoredEvent => ({
  id: String(r.id),
  chain: r.chain,
  seq: Number(r.seq),
  workspaceId: r.workspace_id,
  actorId: r.actor_id,
  action: r.action,
  targetType: r.target_type,
  targetId: r.target_id,
  targetLabel: r.target_label,
  ip: r.ip,
  userAgent: r.user_agent,
  metadata: typeof r.metadata === 'string' ? (JSON.parse(r.metadata) as AuditMetadata) : r.metadata,
  createdAt: new Date(r.created_at).getTime(),
  prevHash: r.prev_hash,
  hash: r.hash,
});

/**
 * Appends events, each to the end of its chain, in one transaction (the caller's, if any: an
 * action and its audit events then commit or fail together). Chain heads are locked in a fixed
 * order so two writers never wait on each other crosswise.
 */
export async function appendEvents(events: NewEvent[]): Promise<void> {
  if (!events.length) return;
  const ordered = [...events].sort((a, b) => (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0));
  await tx(async () => {
    for (const e of ordered) {
      await query(`INSERT INTO audit_chains (chain, seq, hash, pruned_hash) VALUES ($1, 0, $2, $2) ON CONFLICT (chain) DO NOTHING`, [
        e.chain,
        GENESIS_HASH,
      ]);
      const head = await one<{ seq: string | number; hash: string }>(`SELECT seq, hash FROM audit_chains WHERE chain = $1 FOR UPDATE`, [e.chain]);
      const seq = Number(head!.seq) + 1;
      const hash = eventHash({ ...e, seq, prevHash: head!.hash });
      await query(
        `INSERT INTO audit_events (chain, seq, workspace_id, actor_id, action, target_type, target_id, target_label, ip, user_agent,
           metadata, created_at, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)`,
        [
          e.chain,
          seq,
          e.workspaceId,
          e.actorId,
          e.action,
          e.targetType,
          e.targetId,
          e.targetLabel,
          e.ip,
          e.userAgent,
          JSON.stringify(e.metadata),
          new Date(e.createdAt),
          head!.hash,
          hash,
        ],
      );
      await query(`UPDATE audit_chains SET seq = $2, hash = $3 WHERE chain = $1`, [e.chain, seq, hash]);
    }
  });
}

export interface EventFilter {
  workspaceId: string;
  /** Exact actions, or prefixes ending in '.'. */
  actions?: string[];
  actorId?: string;
  targetId?: string;
  from?: number;
  to?: number;
  /** Only events with a smaller id (paging, newest first). */
  beforeId?: string;
}

/** A workspace's events, newest first. */
export async function listEvents(f: EventFilter, limit: number): Promise<StoredEvent[]> {
  const where = ['workspace_id = $1'];
  const params: unknown[] = [f.workspaceId];
  const add = (sql: (p: string) => string, v: unknown) => {
    params.push(v);
    where.push(sql(`$${params.length}`));
  };
  if (f.actions?.length) {
    const exact = f.actions.filter((a) => !a.endsWith('.'));
    const prefixes = f.actions.filter((a) => a.endsWith('.')).map((a) => `${a.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    params.push(exact, prefixes);
    where.push(`(action = ANY($${params.length - 1}::text[]) OR action LIKE ANY($${params.length}::text[]))`);
  }
  if (f.actorId) add((p) => `actor_id = ${p}`, f.actorId);
  if (f.targetId) add((p) => `target_id = ${p}`, f.targetId);
  if (f.from !== undefined) add((p) => `created_at >= ${p}`, new Date(f.from));
  if (f.to !== undefined) add((p) => `created_at < ${p}`, new Date(f.to));
  if (f.beforeId) add((p) => `id < ${p}::bigint`, f.beforeId);
  params.push(limit);
  const rows = await query<Row>(`SELECT * FROM audit_events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT $${params.length}`, params);
  return rows.map(toEvent);
}

export async function getHead(chain: string): Promise<ChainHead | null> {
  const r = await one<{ seq: string | number; hash: string; pruned_seq: string | number; pruned_hash: string }>(
    `SELECT seq, hash, pruned_seq, pruned_hash FROM audit_chains WHERE chain = $1`,
    [chain],
  );
  return r ? { seq: Number(r.seq), hash: r.hash, prunedSeq: Number(r.pruned_seq), prunedHash: r.pruned_hash } : null;
}

/** A chain's events in seq order, `limit` at a time after `afterSeq`. */
export async function chainEvents(chain: string, afterSeq: number, limit: number): Promise<StoredEvent[]> {
  return (await query<Row>(`SELECT * FROM audit_events WHERE chain = $1 AND seq > $2 ORDER BY seq LIMIT $3`, [chain, afterSeq, limit])).map(toEvent);
}

/** Every chain whose oldest stored event is older than `before`, with the workspace it belongs to. */
export async function chainsOlderThan(before: number): Promise<string[]> {
  const rows = await query<{ chain: string }>(
    `SELECT c.chain FROM audit_chains c
     WHERE (SELECT e.created_at FROM audit_events e WHERE e.chain = c.chain ORDER BY e.seq LIMIT 1) < $1
     ORDER BY c.chain`,
    [new Date(before)],
  );
  return rows.map((r) => r.chain);
}

/**
 * Retention: deletes the chain's events older than `before` — only ever a prefix (everything up
 * to the last event before the first one that is still young enough), so the rest of the chain
 * stays verifiable — and records where the stored chain now starts. Returns how many it deleted.
 */
export async function pruneChain(chain: string, before: number): Promise<number> {
  return tx(async () => {
    const head = await one<{ seq: string | number }>(`SELECT seq FROM audit_chains WHERE chain = $1 FOR UPDATE`, [chain]);
    if (!head) return 0;
    const keepFrom = await one<{ seq: string | number }>(
      `SELECT seq FROM audit_events WHERE chain = $1 AND created_at >= $2 ORDER BY seq LIMIT 1`,
      [chain, new Date(before)],
    );
    const through = keepFrom ? Number(keepFrom.seq) - 1 : Number(head.seq);
    const last = await one<{ hash: string }>(`SELECT hash FROM audit_events WHERE chain = $1 AND seq = $2`, [chain, through]);
    if (!last) return 0; // nothing stored up to there (already pruned)
    await query(`SELECT set_config('freero.audit_prune', 'on', true)`);
    const gone = await query(`DELETE FROM audit_events WHERE chain = $1 AND seq <= $2 RETURNING 1`, [chain, through]);
    await query(`SELECT set_config('freero.audit_prune', 'off', true)`);
    await query(`UPDATE audit_chains SET pruned_seq = $2, pruned_hash = $3 WHERE chain = $1`, [chain, through, last.hash]);
    return gone.length;
  });
}
