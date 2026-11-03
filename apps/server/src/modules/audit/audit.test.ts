import { afterAll, beforeAll, expect, it } from 'vitest';
import { audit } from '../../platform/audit';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createTeamWorkspace } from '../workspaces/index';
import { connectAudit } from './wiring';
import { AnchorCheck, chainProblem, eventHash, GENESIS_HASH, type ChainHead, type StoredLink } from './chain';
import { anchorChains, anchorSigned, listAuditEvents, pruneAudit, recordAudit, setAccountScope, signAnchor, verifyWorkspaceAudit } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

const DAY = 86_400_000;

/** A well-formed chain of n events and its head. */
function chainOf(n: number): { events: StoredLink[]; head: ChainHead } {
  const events: StoredLink[] = [];
  let prev = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const e = {
      chain: 'w:x',
      seq,
      createdAt: 1_000 * seq,
      workspaceId: 'x',
      actorId: 'u1',
      action: 'member.role_changed',
      targetType: 'user',
      targetId: `t${seq}`,
      targetLabel: null,
      ip: '10.0.0.1',
      userAgent: null,
      metadata: { from: 'member', to: 'admin' },
      prevHash: prev,
    };
    const hash = eventHash(e);
    events.push({ ...e, hash });
    prev = hash;
  }
  return { events, head: { seq: n, hash: prev, prunedSeq: 0, prunedHash: GENESIS_HASH } };
}

it('tampering with stored audit events is detected: an edited field, a removed event, a dropped newest event', () => {
  const { events, head } = chainOf(5);
  expect(chainProblem(events, head)).toBeNull();

  const edited = events.map((e) => (e.seq === 3 ? { ...e, metadata: { from: 'member', to: 'owner' } } : e));
  expect(chainProblem(edited, head)).toMatch(/#3 was changed/);

  // Re-hashing the edited row alone doesn't help: the next one no longer links to it.
  const rehashed = edited.map((e) => (e.seq === 3 ? { ...e, hash: eventHash(e) } : e));
  expect(chainProblem(rehashed, head)).toMatch(/#4 does not follow #3/);

  expect(chainProblem(events.filter((e) => e.seq !== 2), head)).toMatch(/#2–#2 are missing/);
  expect(chainProblem(events.slice(0, 4), head)).toMatch(/#5–#5 are missing/);
  // Deleting the OLDEST events outside retention shows too (the head says nothing was pruned).
  expect(chainProblem(events.slice(2), head)).toMatch(/#1–#2 are missing/);
});

it('retention removes only events older than the workspace’s retention, and what remains still verifies', async () => {
  const now = Date.now();
  const ws = 'ws-retention';
  for (const ageDays of [400, 200, 100, 10, 1]) await recordAudit({ action: 'board.trashed', workspaceId: ws, actorId: 'u1', target: { type: 'board', id: `b${ageDays}` }, at: now - ageDays * DAY });
  const other = 'ws-keeps-longer';
  await recordAudit({ action: 'board.trashed', workspaceId: other, actorId: 'u1', at: now - 200 * DAY });

  const removed = await pruneAudit(async () => new Map([[ws, 90], [other, 365]]), 365, now);
  expect(removed).toBe(3);
  const left = await listAuditEvents({ workspaceId: ws }, 100);
  expect(left.map((e) => e.targetId).sort()).toEqual(['b1', 'b10']);
  expect((await listAuditEvents({ workspaceId: other }, 100)).length).toBe(1);
  expect((await verifyWorkspaceAudit(ws)).ok).toBe(true);

  // A second run at the same time changes nothing; later events still chain on.
  expect(await pruneAudit(async () => new Map([[ws, 90]]), 365, now)).toBe(0);
  await recordAudit({ action: 'board.restored', workspaceId: ws, actorId: 'u1' });
  expect(await verifyWorkspaceAudit(ws)).toMatchObject({ ok: true, events: 3 });
});

it('events recorded at the same moment by parallel requests get consecutive positions in their chain', async () => {
  const ws = 'ws-parallel';
  await Promise.all(Array.from({ length: 25 }, (_, i) => recordAudit({ action: 'board.created', workspaceId: ws, actorId: `u${i}` })));
  const integrity = await verifyWorkspaceAudit(ws);
  expect(integrity).toMatchObject({ ok: true, events: 25 });
});

it('an operator’s two-step reset (raised through the platform seam) lands in the log of the person’s team, naming the operator', async () => {
  const disconnect = connectAudit();
  try {
    const owner = await createUser({ name: 'Owner', email: 'owner@audit.test.freero.app', password: 'password-123' }, { emailVerified: true });
    const ws = await createTeamWorkspace(owner.id, 'Audited');
    await audit({ action: 'auth.two_factor.reset_by_operator', actor: { kind: 'operator', name: 'Sam (support)' }, userId: owner.id, detail: { reason: 'T-1' } });
    const [e] = await listAuditEvents({ workspaceId: ws.id, actions: ['auth.two_factor.reset_by_operator'] }, 10);
    expect(e).toMatchObject({ actorId: null, targetId: owner.id, metadata: { operator: 'Sam (support)', reason: 'T-1' } });
  } finally {
    disconnect();
    setAccountScope(() => []);
  }
});

it('an account’s sign-in reaches the logs of the team workspaces it belongs to, and only those', async () => {
  setAccountScope((userId) => (userId === 'alice' ? ['team-a', 'team-b'] : []));
  try {
    await recordAudit({ action: 'auth.login', accountId: 'alice', actorId: 'alice', metadata: { method: 'password' } });
    await recordAudit({ action: 'auth.login', accountId: 'bob', actorId: 'bob' });
    for (const ws of ['team-a', 'team-b']) {
      const events = await listAuditEvents({ workspaceId: ws, actions: ['auth.'] }, 10);
      expect(events.map((e) => e.actorId)).toEqual(['alice']);
    }
  } finally {
    setAccountScope(() => []);
  }
});

/** The same chain with one event's content changed and every hash after it recomputed (and a matching head). */
function rewritten(events: StoredLink[], seq: number): { events: StoredLink[]; head: ChainHead } {
  const out: StoredLink[] = [];
  let prev = GENESIS_HASH;
  for (const e of events) {
    const fields = { ...e, targetId: e.seq === seq ? 'someone-else' : e.targetId, prevHash: prev };
    const hash = eventHash(fields);
    out.push({ ...fields, hash });
    prev = hash;
  }
  return { events: out, head: { seq: out.length, hash: prev, prunedSeq: 0, prunedHash: GENESIS_HASH } };
}

it('a log rewritten wholesale (events and head consistent) after its head was signed fails the signed checkpoint; a checkpoint the server did not sign is refused', () => {
  const original = chainOf(5);
  const checkpoint = { chain: 'w:x', seq: 5, hash: original.head.hash, anchoredAt: 1_000 };
  const signed = [{ ...checkpoint, mac: signAnchor(checkpoint) }];
  const check = (c: { events: StoredLink[]; head: ChainHead }, anchors: typeof signed) => {
    const a = new AnchorCheck(anchors, c.head, anchorSigned);
    for (const e of c.events) a.push(e);
    return a.finish();
  };
  expect(check(original, signed)).toBeNull();

  const forged = rewritten(original.events, 3);
  expect(chainProblem(forged.events, forged.head)).toBeNull(); // the hash chain alone can't tell
  expect(check(forged, signed)).toMatch(/#5 is not the one signed .*rewritten/);
  // Re-signing the forged head without the server's secret doesn't pass.
  const fake = { chain: 'w:x', seq: 5, hash: forged.head.hash, anchoredAt: 1_000, mac: 'ab'.repeat(32) };
  expect(check(forged, [fake])).toMatch(/not signed by this server/);
  // Dropping the newest events, the signed one with them, shows too.
  expect(check({ events: original.events.slice(0, 4), head: { ...original.head, seq: 4, hash: original.events[3].hash } }, signed)).toMatch(/ends before event #5/);
});

it('the hourly checkpoints are stored for every chain that moved, and an untouched log verifies against them', async () => {
  const ws = 'ws-anchored';
  for (let i = 0; i < 3; i++) await recordAudit({ action: 'board.created', workspaceId: ws, actorId: 'u1' });
  await anchorChains();
  await recordAudit({ action: 'board.created', workspaceId: ws, actorId: 'u1' });
  await anchorChains();
  await anchorChains(); // nothing moved: no new checkpoint
  expect(await verifyWorkspaceAudit(ws)).toMatchObject({ ok: true, events: 4, anchors: { checked: 2 } });
});
