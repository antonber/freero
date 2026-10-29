// Snapshot retention: bounded growth, named versions and the newest one always kept, and safe when
// every replica runs the job at once.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { createTeamWorkspace, updateWorkspaceSettings } from '../workspaces/index';
import { pruneSnapshotsByPolicy } from './init';
import * as repo from './repo';
import { DEFAULT_RETENTION, pruneSnapshots, snapshotsToPrune, type SnapshotStamp } from './retention';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.UTC(2026, 9, 28, 12, 0);

/** A board edited around the clock for `days`: an automatic snapshot every 30 min. */
function busyBoard(days: number): SnapshotStamp[] {
  const out: SnapshotStamp[] = [];
  for (let t = NOW - days * DAY, id = 1; t <= NOW; t += 30 * MIN, id++) out.push({ id, kind: 'auto', createdAt: t });
  return out;
}

it('a board edited for months keeps a bounded number of snapshots, every named one and the newest, and a second run removes nothing more', () => {
  const snaps = busyBoard(120);
  snaps[10] = { ...snaps[10], kind: 'named' }; // ~4 months old
  snaps[snaps.length - 3] = { ...snaps[snaps.length - 3], kind: 'named' };
  const drop = new Set(snapshotsToPrune(snaps, NOW, DEFAULT_RETENTION));
  const kept = snaps.filter((s) => !drop.has(s.id));

  // ~24 hourly + ~29 daily + ~13 weekly (+ the named ones), not 5760.
  expect(kept.length).toBeLessThan(75);
  expect(kept.filter((s) => s.kind === 'named')).toHaveLength(2);
  expect(kept.some((s) => s.createdAt === NOW)).toBe(true);
  // Coverage stays useful: something kept from every day of the last month.
  for (let d = 1; d < 30; d++) expect(kept.some((s) => s.createdAt <= NOW - d * DAY && s.createdAt > NOW - (d + 1) * DAY)).toBe(true);
  // Idempotent: what survives a run survives the next run at the same time.
  expect(snapshotsToPrune(kept, NOW, DEFAULT_RETENTION)).toEqual([]);
});

let userId: string;
beforeAll(async () => {
  await openTestDb();
  userId = (await createUser({ name: 'Keeper', email: 'keeper@test.freero.app', password: 'password-123' })).id;
});
afterAll(closeTestDb);

it('several replicas pruning at once delete exactly what one would, and never a named version', async () => {
  const boardId = (await createBoard(userId, 'Busy', '')).id;
  const state = new Uint8Array([0, 0]);
  const stamps = busyBoard(10);
  for (const s of stamps) {
    const kind = s.id % 50 === 0 ? 'named' : 'auto';
    await repo.insertSnapshot(boardId, { state, kind, name: kind === 'named' ? `v${s.id}` : null, createdBy: null }, s.createdAt);
  }
  const expected = snapshotsToPrune(await repo.snapshotTimeline(boardId), NOW, DEFAULT_RETENTION).length;

  const rounds = await Promise.all([pruneSnapshots({ now: NOW }), pruneSnapshots({ now: NOW }), pruneSnapshots({ now: NOW })]);
  expect(rounds.reduce<number>((n, r) => n + (r ?? 0), 0)).toBe(expected);
  const left = await repo.snapshotTimeline(boardId);
  expect(left).toHaveLength(stamps.length - expected);
  expect(left.filter((s) => s.kind === 'named')).toHaveLength(stamps.filter((s) => s.id % 50 === 0).length);
  expect(await pruneSnapshots({ now: NOW })).toBe(0);
});

it('a workspace’s version retention removes its unnamed versions past the limit — even a board’s only one — and leaves named ones, decisions and other workspaces alone', async () => {
  const team = await createTeamWorkspace(userId, 'Short memory');
  await updateWorkspaceSettings(team.id, userId, { versionRetentionDays: 30 });
  const strict = (await createBoard(userId, 'Strict', '', 'none', { workspaceId: team.id })).id;
  const lone = (await createBoard(userId, 'Lone', '', 'none', { workspaceId: team.id })).id;
  const relaxed = (await createBoard(userId, 'Relaxed', '')).id; // personal workspace: default retention
  const state = new Uint8Array([0, 0]);
  const now = Date.now();
  for (const b of [strict, relaxed]) {
    await repo.insertSnapshot(b, { state, kind: 'auto', name: null, createdBy: null }, now - 90 * DAY);
    await repo.insertSnapshot(b, { state, kind: 'named', name: 'Kickoff', createdBy: null }, now - 80 * DAY);
    await repo.insertSnapshot(b, { state, kind: 'auto', name: null, createdBy: null }, now - 2 * DAY);
  }
  await repo.insertSnapshot(lone, { state, kind: 'before-restore', name: null, createdBy: null }, now - 40 * DAY);
  // A decision (KAI-161) is cited from elsewhere: its content must outlive any retention.
  await repo.insertSnapshot(strict, { state, kind: 'decision', name: 'Pricing', createdBy: null }, now - 85 * DAY);

  await pruneSnapshotsByPolicy(now);
  const ages = async (b: string) => (await repo.snapshotTimeline(b)).map((s) => `${s.kind}:${Math.round((now - s.createdAt) / DAY)}`).sort();
  expect(await ages(strict)).toEqual(['auto:2', 'decision:85', 'named:80']);
  expect(await ages(lone)).toEqual([]);
  expect(await ages(relaxed)).toEqual(['auto:2', 'auto:90', 'named:80']);
});
