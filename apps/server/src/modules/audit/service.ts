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
import { mac, macMatches } from '../../platform/secrets';
import { AnchorCheck, ChainVerifier, type Anchor } from './chain';
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
/** Events about no workspace or account (operators acting on unowned content). Read with audit:verify. */
export const SYSTEM_CHAIN = 'freero';

type AccountScope = (userId: string) => Promise<string[]> | string[];
let accountScope: AccountScope = () => [];

/**
 * Which team workspaces see an account's own events (set once by audit/init.ts from
 * modules/workspaces: the workspaces the person is a member — not a guest — of).
 */
export function setAccountScope(fn: AccountScope): void {
  accountScope = fn;
}

type OrganisationScope = (workspaceIds: string[]) => Promise<Map<string, string>>;
let organisationScope: OrganisationScope = async () => new Map();

/**
 * Which organisation each workspace belongs to (#108; set once by audit/wiring.ts from
 * modules/workspaces): an event in an attached workspace also goes to the organisation's log.
 * Asked inside the event's transaction, so attaching / detaching and its record agree.
 */
export function setOrganisationScope(fn: OrganisationScope): void {
  organisationScope = fn;
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
  // #108: the organisation of each of those workspaces gets the event too — once, however many of
  // its workspaces saw it — keeping the workspace it happened in (null: an account's own event).
  if (workspaceIds.size) {
    const orgs = await organisationScope([...workspaceIds]);
    const added = new Set(workspaceIds);
    for (const org of new Set(orgs.values())) {
      if (added.has(org)) continue;
      added.add(org);
      const source = input.workspaceId && orgs.get(input.workspaceId) === org ? input.workspaceId : null;
      chains.push({ chain: workspaceChain(org), workspaceId: source });
    }
  }
  // Neither a workspace nor an account (an operator acting on a file nobody owns): Freero's own log.
  if (!chains.length) chains.push({ chain: SYSTEM_CHAIN, workspaceId: null });
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
export function recordPlatformAudit(e: PlatformAuditEvent & { at: number }, workspaceId: string | null = null): Promise<void> {
  const by: Record<string, AuditValue> =
    e.actor.kind === 'operator' ? { operator: e.actor.name } : e.actor.kind === 'link' ? { via: e.actor.purpose } : e.actor.kind === 'system' ? { by: 'system' } : {};
  return recordAudit({
    action: e.action as AuditAction,
    accountId: e.userId || null,
    workspaceId,
    actorId: e.actor.kind === 'user' ? e.actor.userId : null,
    target: e.userId ? { type: 'user', id: e.userId } : null,
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

/** Events of one action in a workspace's log in [from, to), counted by a metadata key (#65: API calls by app). */
export function auditCountsBy(workspaceId: string, action: string, from: number, to: number, key: string): Promise<Map<string, number>> {
  return repo.countByMetadata(workspaceId, action, from, to, key);
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
  const [head, anchors] = await Promise.all([repo.getHead(chain), repo.anchorsOf(chain)]);
  const verifier = new ChainVerifier(head);
  const signed = new AnchorCheck(anchors, head, anchorSigned);
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
      signed.push(e);
      if (!verifier.push(e)) break read;
    }
    if (batch.length < VERIFY_BATCH) break;
    after = batch[batch.length - 1].seq;
  }
  const problem = verifier.finish() ?? signed.finish();
  const live = anchors.filter((a) => a.seq > (head?.prunedSeq ?? 0));
  return {
    ok: problem === null,
    events,
    firstAt,
    lastAt,
    headHash: head && head.seq > 0 ? head.hash : null,
    problem,
    anchors: { checked: signed.checked, lastAt: live.at(-1)?.anchoredAt ?? null },
  };
}

// ---- anchors: signed checkpoints of chain heads (#17) ----

const anchorMessage = (a: Anchor) => `audit.anchor:v1:${a.chain}:${a.seq}:${a.hash}:${a.anchoredAt}`;

/** The server's signature of a checkpoint (HMAC under SESSION_SECRET, hex). */
export const signAnchor = (a: Anchor): string => mac(anchorMessage(a)).toString('hex');
/** Whether `a.mac` is this server's signature of the checkpoint (any configured secret: rotation). */
export const anchorSigned = (a: Anchor & { mac: string }): boolean => /^[0-9a-f]{64}$/.test(a.mac) && macMatches(anchorMessage(a), Buffer.from(a.mac, 'hex'));

/** Signs the head of every chain that moved since its last checkpoint (the audit:anchor job). Idempotent. */
export async function anchorChains(now = Date.now()): Promise<number> {
  let n = 0;
  for (;;) {
    const heads = await repo.headsToAnchor(500);
    for (const h of heads) {
      const a = { ...h, anchoredAt: now };
      await repo.insertAnchor({ ...a, mac: signAnchor(a) });
    }
    n += heads.length;
    if (heads.length < 500) return n;
  }
}

/** A workspace log's head as of now, signed by this server (what SIEM streams receive as a checkpoint). */
export async function signedWorkspaceHead(workspaceId: string, now = Date.now()): Promise<{ chain: string; seq: number; hash: string; at: number; signature: string } | null> {
  const chain = workspaceChain(workspaceId);
  const head = await repo.getHead(chain);
  if (!head || head.seq === 0) return null;
  const a = { chain, seq: head.seq, hash: head.hash, anchoredAt: now };
  return { chain, seq: head.seq, hash: head.hash, at: now, signature: signAnchor(a) };
}

/** A workspace log's events after `afterSeq`, in order (SIEM streams: their cursor is the seq). */
export function workspaceEventsAfter(workspaceId: string, afterSeq: number, limit: number): Promise<StoredEvent[]> {
  return repo.chainEvents(workspaceChain(workspaceId), afterSeq, limit);
}

/** The newest seq of a workspace's log (0: empty). */
export async function workspaceHeadSeq(workspaceId: string): Promise<number> {
  return (await repo.getHead(workspaceChain(workspaceId)))?.seq ?? 0;
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
