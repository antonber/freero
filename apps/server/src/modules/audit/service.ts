// The audit service every module calls (KAI-48): `recordAudit` appends an event to the log of the
// workspace it happened in and/or, for an account's own events, to the account's log and the logs
// of the team workspaces the person belongs to. Who / from where is taken from the request being
// handled (platform/requestContext) unless the caller says otherwise.
//
// There is no update or delete path besides retention (repo.pruneChain); the database refuses
// anything else (trigger). Each chain is hash-linked (chain.ts), so tampering below the app shows.
import type { AuditAction, AuditIntegrity, AuditMetadata, AuditValue } from '@freero/shared';
import type { AuditEvent as PlatformAuditEvent } from '../../platform/audit';
import { currentRequestContext } from '../../platform/requestContext';
import { logError } from '../../platform/log';
import { ChainVerifier } from './chain';
import * as repo from './repo';
import type { EventFilter, StoredEvent } from './repo';

export type { StoredEvent, EventFilter };

export interface AuditInput {
  action: AuditAction;
  /** The workspace whose log gets the event (a board's, a project's…). */
  workspaceId?: string | null;
  /**
   * An event about this account itself (sign-ins, two-step verification, sessions, deletion): it
   * goes to the account's own log and to every team workspace the person is a member of.
   */
  accountId?: string | null;
  /** With `accountId`: false keeps the event out of the person's team workspaces (default true). */
  fanOut?: boolean;
  /** Who did it. Default: the signed-in user of the request being handled; null: Freero itself / nobody signed in. */
  actorId?: string | null;
  target?: { type: string; id: string; label?: string | null } | null;
  metadata?: Record<string, AuditValue | undefined>;
  /** For tests and jobs replaying a known time. */
  at?: number;
}

export const workspaceChain = (workspaceId: string) => `w:${workspaceId}`;
export const accountChain = (userId: string) => `u:${userId}`;

type AccountScope = (userId: string) => Promise<string[]> | string[];
let accountScope: AccountScope = () => [];

/**
 * Which team workspaces see an account's own events (set once by audit/init.ts from
 * modules/workspaces: the workspaces the person is a member — not a guest — of).
 */
export function setAccountScope(fn: AccountScope): void {
  accountScope = fn;
}

const MAX_LABEL = 300;
const clip = (s: string | null | undefined, n = MAX_LABEL) => (s == null ? null : s.slice(0, n));

function cleanMetadata(m: AuditInput['metadata']): AuditMetadata {
  const out: AuditMetadata = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (v === undefined) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 1000) : Array.isArray(v) ? v.slice(0, 50).map((s) => String(s).slice(0, 200)) : v;
  }
  return out;
}

/**
 * Records an event. Inside a transaction it joins it, so the action and its record commit
 * together (a failed write fails the action). Throws when it can't write.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  const ctx = currentRequestContext();
  const workspaceIds = new Set<string>();
  if (input.workspaceId) workspaceIds.add(input.workspaceId);
  const chains: Array<{ chain: string; workspaceId: string | null }> = [];
  if (input.accountId) {
    chains.push({ chain: accountChain(input.accountId), workspaceId: null });
    if (input.fanOut !== false) for (const id of await accountScope(input.accountId)) workspaceIds.add(id);
  }
  for (const id of workspaceIds) chains.push({ chain: workspaceChain(id), workspaceId: id });
  if (!chains.length) throw new Error(`audit: ${input.action} names neither a workspace nor an account`);
  const base = {
    actorId: input.actorId !== undefined ? input.actorId : (ctx?.userId ?? null),
    action: input.action,
    targetType: clip(input.target?.type, 40),
    targetId: clip(input.target?.id, 200),
    targetLabel: clip(input.target?.label),
    ip: clip(ctx?.ip, 64),
    userAgent: clip(ctx?.userAgent, 400),
    metadata: cleanMetadata(input.metadata),
    createdAt: input.at ?? Date.now(),
  };
  await repo.appendEvents(chains.map((c) => ({ ...base, ...c })));
}

/**
 * The sink behind platform/audit.ts (`audit(…)`): account events raised where modules/audit can't
 * be imported, or from the operator CLI. Each becomes an account event of `userId`; who did it is
 * kept in the actor (a user) or the metadata (an operator's name, the emailed link used).
 */
export function recordPlatformAudit(e: PlatformAuditEvent & { at: number }): Promise<void> {
  const by: Record<string, AuditValue> =
    e.actor.kind === 'operator' ? { operator: e.actor.name } : e.actor.kind === 'link' ? { via: e.actor.purpose } : e.actor.kind === 'system' ? { by: 'system' } : {};
  return recordAudit({
    action: e.action as AuditAction,
    accountId: e.userId,
    actorId: e.actor.kind === 'user' ? e.actor.userId : null,
    target: { type: 'user', id: e.userId },
    metadata: { ...e.detail, ...by },
    at: e.at,
  });
}

/**
 * For work that is already done and must not fail because its record could not be written (a
 * sign-out, a job): records it, and only logs when that fails.
 */
export function recordAuditQuietly(input: AuditInput): Promise<void> {
  return recordAudit(input).catch((e) => logError(`audit: could not record ${input.action}`, e));
}

export function listAuditEvents(filter: EventFilter, limit: number): Promise<StoredEvent[]> {
  return repo.listEvents(filter, limit);
}

const VERIFY_BATCH = 1000;

/** Re-checks every stored event of a workspace's log against the chain. */
export async function verifyWorkspaceAudit(workspaceId: string): Promise<AuditIntegrity> {
  return verifyChain(workspaceChain(workspaceId));
}

export async function verifyChain(chain: string): Promise<AuditIntegrity> {
  const head = await repo.getHead(chain);
  const verifier = new ChainVerifier(head);
  let events = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  // From the very first stored row: one before the pruned point is out of place too.
  read: for (let after = -1; ; ) {
    const batch = await repo.chainEvents(chain, after, VERIFY_BATCH);
    for (const e of batch) {
      events++;
      firstAt ??= e.createdAt;
      lastAt = e.createdAt;
      if (!verifier.push(e)) break read;
    }
    if (batch.length < VERIFY_BATCH) break;
    after = batch[batch.length - 1].seq;
  }
  const problem = verifier.finish();
  return { ok: problem === null, events, firstAt, lastAt, headHash: head && head.seq > 0 ? head.hash : null, problem };
}

/**
 * Retention: removes events older than each chain's retention. `daysFor(workspaceId | null)` gives
 * the days for a workspace's chain (null: an account's own chain). Idempotent; returns how many
 * events it removed.
 */
export async function pruneAudit(daysFor: (workspaceIds: string[]) => Promise<Map<string, number>>, accountDays: number, now = Date.now()): Promise<number> {
  const DAY = 86_400_000;
  // Nothing younger than the smallest allowed retention is ever removed: list only chains with older events.
  const chains = await repo.chainsOlderThan(now - 30 * DAY);
  const workspaceIds = chains.filter((c) => c.startsWith('w:')).map((c) => c.slice(2));
  const days = await daysFor(workspaceIds);
  let removed = 0;
  for (const chain of chains) {
    const d = chain.startsWith('w:') ? (days.get(chain.slice(2)) ?? accountDays) : accountDays;
    removed += await repo.pruneChain(chain, now - d * DAY);
  }
  return removed;
}
