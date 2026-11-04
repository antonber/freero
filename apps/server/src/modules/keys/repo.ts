// The only writer of `workspace_keys` and `workspace_data_keys` [S4].
import type { WorkspaceKeyProvider, WorkspaceKeyState } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export interface KeyRow {
  workspaceId: string;
  provider: WorkspaceKeyProvider;
  kmsKeyId: string | null;
  state: WorkspaceKeyState;
  reason: string | null;
  currentVersion: number;
  createdAt: number;
  stateChangedAt: number;
  kekRotatedAt: number | null;
}

interface Row {
  workspace_id: string;
  provider: WorkspaceKeyProvider;
  kms_key_id: string | null;
  state: WorkspaceKeyState;
  state_reason: string | null;
  current_version: number;
  created_at: Date;
  state_changed_at: Date;
  kek_rotated_at: Date | null;
}
const toKey = (r: Row): KeyRow => ({
  workspaceId: r.workspace_id,
  provider: r.provider,
  kmsKeyId: r.kms_key_id,
  state: r.state,
  reason: r.state_reason,
  currentVersion: Number(r.current_version),
  createdAt: new Date(r.created_at).getTime(),
  stateChangedAt: new Date(r.state_changed_at).getTime(),
  kekRotatedAt: r.kek_rotated_at ? new Date(r.kek_rotated_at).getTime() : null,
});

export interface DataKeyRow {
  version: number;
  wrapped: string;
  kekRef: string;
}

export async function getKey(workspaceId: string): Promise<KeyRow | null> {
  const r = await one<Row>(`SELECT * FROM workspace_keys WHERE workspace_id = $1`, [workspaceId]);
  return r ? toKey(r) : null;
}

/** States of the keys among these workspaces (workspaces without a key are absent). */
export async function statesOf(workspaceIds: string[]): Promise<Map<string, WorkspaceKeyState>> {
  if (!workspaceIds.length) return new Map();
  const rows = await query<{ workspace_id: string; state: WorkspaceKeyState }>(
    `SELECT workspace_id, state FROM workspace_keys WHERE workspace_id = ANY($1::text[])`,
    [workspaceIds],
  );
  return new Map(rows.map((r) => [r.workspace_id, r.state]));
}

export async function keysIn(states: WorkspaceKeyState[]): Promise<KeyRow[]> {
  return (await query<Row>(`SELECT * FROM workspace_keys WHERE state = ANY($1::text[]) ORDER BY workspace_id`, [states])).map(toKey);
}

/** A new key with its first data key; false if the workspace already has one. */
export async function insertKey(
  k: { workspaceId: string; provider: WorkspaceKeyProvider; kmsKeyId: string | null; createdBy: string; wrapped: string; kekRef: string },
  now: number,
  inTx: () => Promise<void>,
): Promise<boolean> {
  return tx(async () => {
    const r = await one(
      `INSERT INTO workspace_keys (workspace_id, provider, kms_key_id, state, current_version, created_by, created_at, state_changed_at)
       VALUES ($1, $2, $3, 'active', 1, $4, $5, $5) ON CONFLICT (workspace_id) DO NOTHING RETURNING 1`,
      [k.workspaceId, k.provider, k.kmsKeyId, k.createdBy, new Date(now)],
    );
    if (!r) return false;
    await query(`INSERT INTO workspace_data_keys (workspace_id, version, wrapped, kek_ref, created_at) VALUES ($1, 1, $2, $3, $4)`, [
      k.workspaceId,
      k.wrapped,
      k.kekRef,
      new Date(now),
    ]);
    await inTx();
    return true;
  });
}

export async function dataKey(workspaceId: string, version: number): Promise<DataKeyRow | null> {
  const r = await one<{ version: number; wrapped: string; kek_ref: string }>(
    `SELECT version, wrapped, kek_ref FROM workspace_data_keys WHERE workspace_id = $1 AND version = $2`,
    [workspaceId, version],
  );
  return r ? { version: Number(r.version), wrapped: r.wrapped, kekRef: r.kek_ref } : null;
}

export async function dataKeys(workspaceId: string): Promise<DataKeyRow[]> {
  const rows = await query<{ version: number; wrapped: string; kek_ref: string }>(
    `SELECT version, wrapped, kek_ref FROM workspace_data_keys WHERE workspace_id = $1 ORDER BY version`,
    [workspaceId],
  );
  return rows.map((r) => ({ version: Number(r.version), wrapped: r.wrapped, kekRef: r.kek_ref }));
}

/** Replaces one wrapped data key, only if it is still the one read (a concurrent rewrap wins). */
export async function rewrap(workspaceId: string, version: number, from: string, to: string, kekRef: string): Promise<boolean> {
  const r = await one(
    `UPDATE workspace_data_keys SET wrapped = $4, kek_ref = $5 WHERE workspace_id = $1 AND version = $2 AND wrapped = $3 RETURNING 1`,
    [workspaceId, version, from, to, kekRef],
  );
  return r !== null;
}

/**
 * Rotation, in one transaction: every data key wrapped again (under a new KMS key, or the same),
 * and a new data key for new content. False when the key isn't active or the versions changed.
 */
export async function rotate(
  workspaceId: string,
  c: { provider: WorkspaceKeyProvider; kmsKeyId: string | null; rewrapped: Array<{ version: number; from: string; to: string }>; kekRef: string; next: { version: number; wrapped: string } },
  now: number,
  inTx: () => Promise<void>,
): Promise<boolean> {
  return tx(async () => {
    const row = await one<{ current_version: number }>(
      `SELECT current_version FROM workspace_keys WHERE workspace_id = $1 AND state = 'active' FOR UPDATE`,
      [workspaceId],
    );
    if (!row || Number(row.current_version) + 1 !== c.next.version) return false;
    for (const w of c.rewrapped) {
      const ok = await one(
        `UPDATE workspace_data_keys SET wrapped = $4, kek_ref = $5 WHERE workspace_id = $1 AND version = $2 AND wrapped = $3 RETURNING 1`,
        [workspaceId, w.version, w.from, w.to, c.kekRef],
      );
      if (!ok) throw new Error('data keys changed during rotation');
    }
    await query(`INSERT INTO workspace_data_keys (workspace_id, version, wrapped, kek_ref, created_at) VALUES ($1, $2, $3, $4, $5)`, [
      workspaceId,
      c.next.version,
      c.next.wrapped,
      c.kekRef,
      new Date(now),
    ]);
    await query(
      `UPDATE workspace_keys SET current_version = $2, kek_rotated_at = $3, provider = $4, kms_key_id = $5 WHERE workspace_id = $1`,
      [workspaceId, c.next.version, new Date(now), c.provider, c.kmsKeyId],
    );
    await inTx();
    return true;
  });
}

/**
 * Moves the key to `to` if it is in one of `from`, recording why; returns whether it moved.
 * Destroying also deletes every wrapped data key (crypto-shredding) in the same statement's transaction.
 */
export async function setState(
  workspaceId: string,
  from: WorkspaceKeyState[],
  to: WorkspaceKeyState,
  reason: string | null,
  now: number,
  inTx: () => Promise<void>,
): Promise<boolean> {
  return tx(async () => {
    const r = await one(
      `UPDATE workspace_keys SET state = $3, state_reason = $4, state_changed_at = $5 WHERE workspace_id = $1 AND state = ANY($2::text[]) RETURNING 1`,
      [workspaceId, from, to, reason, new Date(now)],
    );
    if (!r) return false;
    if (to === 'destroyed') await query(`DELETE FROM workspace_data_keys WHERE workspace_id = $1`, [workspaceId]);
    await inTx();
    return true;
  });
}
