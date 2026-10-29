// Retention of board snapshots (KAI-72): compaction keeps a full-state snapshot at most every
// 30 min of activity, so without thinning a busy board accumulates one full copy per half hour.
//
// Rules (per board): named versions are kept forever. The others ('auto', 'before-restore') are
// thinned by age — the newest one per hour for the first day, per day for the first month, per
// week after that. Buckets are aligned to the epoch (not to "now"), so a run is idempotent: the
// survivors of one run are exactly the survivors of the next run at the same time, and as time
// passes buckets only get coarser. The newest snapshot is never removed (newest in its bucket).
//
// The job runs on every instance (init.ts). One instance prunes at a time (advisory lock); a
// round that loses the lock, or misses a run, only delays the thinning. Deleting is safe even
// from a stale read: a snapshot is only deleted in favour of a NEWER one kept by the same plan.
import * as repo from './repo';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Age tiers: a snapshot at least `from` old (and younger than the next tier) keeps one per
 * `bucketMs`. Sorted by `from`, the first tier starting at 0.
 */
export interface RetentionPolicy {
  tiers: Array<{ from: number; bucketMs: number }>;
  /** Unnamed snapshots older than this are removed outright (a workspace's version-history retention). */
  maxAgeMs?: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  tiers: [
    { from: 0, bucketMs: HOUR },
    { from: DAY, bucketMs: DAY },
    { from: 30 * DAY, bucketMs: WEEK },
  ],
};

/**
 * Which board's policy applies: DEFAULT_RETENTION, plus the version-history retention of the
 * board's workspace (KAI-51, wired in init.ts).
 */
export type RetentionPolicyFor = (boardId: string) => Promise<RetentionPolicy> | RetentionPolicy;
export const defaultPolicyFor: RetentionPolicyFor = () => DEFAULT_RETENTION;

export interface SnapshotStamp {
  id: number;
  kind: repo.SnapshotKind;
  createdAt: number;
}

/** Ids of the snapshots `policy` drops at `now`. */
export function snapshotsToPrune(snapshots: SnapshotStamp[], now: number, policy: RetentionPolicy): number[] {
  const tiers = [...policy.tiers].sort((a, b) => a.from - b.from);
  const keeper = new Map<string, SnapshotStamp>();
  const drop: number[] = [];
  const newestFirst = [...snapshots].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  for (const s of newestFirst) {
    if (s.kind === 'named' || s.kind === 'decision') continue;
    const age = Math.max(0, now - s.createdAt);
    if (policy.maxAgeMs !== undefined && age > policy.maxAgeMs) {
      drop.push(s.id);
      continue;
    }
    let tier = 0;
    while (tier + 1 < tiers.length && age >= tiers[tier + 1].from) tier++;
    const key = `${tier}:${Math.floor(s.createdAt / tiers[tier].bucketMs)}`;
    if (keeper.has(key)) drop.push(s.id);
    else keeper.set(key, s);
  }
  return drop;
}

const BOARDS_PER_TRANSACTION = 50;

/**
 * One pruning round over every board. Returns how many snapshots it removed, or null when another
 * instance holds the lock (this round is skipped).
 */
export async function pruneSnapshots(
  opts: {
    now?: number;
    policyFor?: RetentionPolicyFor;
    /** The shortest maxAgeMs any board's policy has: boards with a single snapshot older than that are visited too. */
    shortestMaxAgeMs?: number | null;
  } = {},
): Promise<number | null> {
  const now = opts.now ?? Date.now();
  const policyFor = opts.policyFor ?? defaultPolicyFor;
  const loneBefore = opts.shortestMaxAgeMs == null ? null : now - opts.shortestMaxAgeMs;
  let removed = 0;
  let after = '';
  for (;;) {
    // Short transactions (a batch of boards each), so PGlite's single connection is never held long.
    const batch = await repo.transaction(async () => {
      if (!(await repo.tryLockSnapshotPrune())) return null;
      const boards = await repo.boardsWithPrunableSnapshots(after, BOARDS_PER_TRANSACTION, loneBefore);
      let n = 0;
      for (const boardId of boards) {
        const drop = snapshotsToPrune(await repo.snapshotTimeline(boardId), now, await policyFor(boardId));
        n += await repo.deleteSnapshots(boardId, drop);
      }
      return { boards, n };
    });
    if (batch === null) return removed > 0 ? removed : null; // another instance took over
    removed += batch.n;
    if (batch.boards.length < BOARDS_PER_TRANSACTION) return removed;
    after = batch.boards[batch.boards.length - 1];
  }
}
