// The hash chain of the audit log (pure). Each event's hash covers everything recorded about it
// plus the previous event's hash in the same chain, so changing, removing or reordering a stored
// event breaks every link after it. Retention only ever removes a chain's OLDEST events, so a
// verification starts at the first event still stored and trusts its prev_hash.
import { createHash } from 'node:crypto';
import type { AuditMetadata } from '@freero/shared';

export const GENESIS_HASH = '0'.repeat(64);

/** The fields a hash covers (as stored; `createdAt` in epoch ms). */
export interface ChainedFields {
  chain: string;
  seq: number;
  createdAt: number;
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: AuditMetadata;
  prevHash: string;
}

/** JSON with object keys sorted at every level: jsonb gives keys back in its own order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v ?? null);
}

export function eventHash(e: ChainedFields): string {
  const fields = [
    1, // format version
    e.chain,
    e.seq,
    e.createdAt,
    e.workspaceId,
    e.actorId,
    e.action,
    e.targetType,
    e.targetId,
    e.targetLabel,
    e.ip,
    e.userAgent,
    e.metadata,
    e.prevHash,
  ];
  return createHash('sha256').update(canonicalJson(fields)).digest('hex');
}

export interface StoredLink extends ChainedFields {
  hash: string;
}

/** What the log recorded about a chain: its newest event, and the newest one retention removed. */
export interface ChainHead {
  seq: number;
  hash: string;
  prunedSeq: number;
  prunedHash: string;
}

/**
 * Checks a chain's stored events (in seq order) against each other and against its head: they
 * must run without gaps from just after the last pruned event up to the head, each linking to the
 * one before. Returns null when intact, else what is wrong.
 */
export function chainProblem(events: StoredLink[], head: ChainHead | null): string | null {
  const v = new ChainVerifier(head);
  for (const e of events) if (!v.push(e)) break;
  return v.finish();
}

/** chainProblem, one event at a time (long chains are read in batches). */
export class ChainVerifier {
  private prev: { seq: number; hash: string };
  private problem: string | null = null;
  private count = 0;

  constructor(private head: ChainHead | null) {
    this.prev = head ? { seq: head.prunedSeq, hash: head.prunedHash } : { seq: 0, hash: GENESIS_HASH };
  }

  /** False once something is wrong (later events don't matter then). */
  push(e: StoredLink): boolean {
    if (this.problem) return false;
    this.count++;
    const prev = this.prev;
    if (!this.head) this.problem = 'the chain has events but no recorded head';
    else if (e.seq !== prev.seq + 1)
      this.problem = e.seq > prev.seq + 1 ? `events #${prev.seq + 1}–#${e.seq - 1} are missing` : `event #${e.seq} is out of place`;
    else if (e.prevHash !== prev.hash) this.problem = `event #${e.seq} does not follow #${prev.seq}`;
    else if (eventHash(e) !== e.hash) this.problem = `event #${e.seq} was changed after it was recorded`;
    this.prev = { seq: e.seq, hash: e.hash };
    return this.problem === null;
  }

  finish(): string | null {
    if (this.problem || !this.head) return this.problem;
    const { prev, head } = this;
    if (prev.seq !== head.seq || prev.hash !== head.hash)
      return prev.seq < head.seq ? `events #${prev.seq + 1}–#${head.seq} are missing` : 'the chain does not end where the log says it does';
    return null;
  }
}
