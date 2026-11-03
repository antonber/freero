// "Changes since your last visit" against real stored boards (in-memory Postgres, real live rooms):
// the marker realtime reports, the activity bursts changeBoard reports, the version kept before.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Account, BoardElement } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getAccount } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { changeBoard, freezeBoard, initBoardDoc, onBoardChange } from '../realtime/index';
import { catchUpChanges, catchUpSummary, onBoardLeft } from './catchUp';
import { boardActivity, flushBursts, recordChanges } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const person = async (name: string): Promise<Account> =>
  getAccount((await createUser({ name, email: `${name.toLowerCase()}-${++n}@catchup.test.freero.app`, password: 'password-123' }, { emailVerified: true })).id);

let z = 0;
const sticky = (id: string, text: string, x = 0): BoardElement =>
  ({ id, type: 'sticky', x, y: 0, w: 100, h: 100, rotation: 0, z: ++z, createdBy: 'x', createdAt: 1, updatedAt: 1, text: `<p>${text}</p>`, color: 'yellow' }) as BoardElement;

it('coming back lists what others added, changed and removed after you left — not your own edits, not what happened before, not what came and went', async () => {
  const [ann, bob] = [await person('Ann'), await person('Bob')];
  const board = await createBoard(ann.id, 'Plan', '', 'none');
  await inviteBoardMember(null, board.id, ann, { email: bob.email, role: 'editor' });
  const doc = new Y.Doc();
  for (const e of [sticky('budget', 'Budget: 10'), sticky('venue', 'Venue: Lyon', 200), sticky('old', 'Old idea', 400)]) doc.getMap('elements').set(e.id, e);
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  const stop = onBoardChange((e) => recordChanges(e));
  let added = '';
  try {
    // A version is kept, then Bob edits while Ann is still there (she saw that live).
    await freezeBoard(board.id, ann.id, 'Kickoff', () => null);
    await changeBoard(board.id, { userId: bob.id, role: 'editor' }, () => ({ change: { update: [{ id: 'venue', patch: { text: '<p>Venue: Paris</p>' } }] } }));
    await flushBursts(Date.now() + getConfig().activityIdleMs);
    await new Promise((r) => setTimeout(r, 5));
    await onBoardLeft({ boardId: board.id, userId: ann.id, at: Date.now() });
    expect((await catchUpSummary(board.id, ann.id)).counts).toEqual({ added: 0, changed: 0, removed: 0, comments: 0 });

    // While she is away: Bob adds, changes, removes, and adds-then-removes; Ann edits from her phone.
    const { applied } = await changeBoard(board.id, { userId: bob.id, role: 'editor' }, () => ({
      change: { create: [sticky('n1', 'New: caterer', 600) as never, sticky('n2', 'Typo', 800) as never], update: [{ id: 'budget', patch: { text: '<p>Budget: 12</p>' } }], remove: ['old'] },
    }));
    const temp = applied.created[1];
    added = applied.created[0];
    await changeBoard(board.id, { userId: bob.id, role: 'editor' }, () => ({ change: { remove: [temp] } }));
    await changeBoard(board.id, { userId: ann.id, role: 'owner' }, () => ({ change: { update: [{ id: 'venue', patch: { text: '<p>Venue: Nice</p>' } }] } }));
    await flushBursts(Date.now() + getConfig().activityIdleMs);
  } finally {
    stop();
  }

  const summary = await catchUpSummary(board.id, ann.id);
  expect(summary.counts).toEqual({ added: 1, changed: 1, removed: 1, comments: 0 });
  expect(summary.people.map((p) => p.name)).toEqual(['Bob']);

  const changes = await catchUpChanges(board.id, ann.id);
  expect(changes.added.map((i) => [i.id, i.text, i.by])).toEqual([[added, 'New: caterer', ['Bob']]]);
  expect(changes.changed.map((i) => [i.id, i.before, i.text])).toEqual([['budget', 'Budget: 10', 'Budget: 12']]);
  // Removed: as it read in the version kept before her visit.
  expect(changes.removed.map((i) => [i.id, i.kind, i.text])).toEqual([['old', 'sticky', 'Old idea']]);

  // Bob's own view: Ann's edit is the only news for him (he never left: no marker, nothing offered).
  expect((await catchUpSummary(board.id, bob.id)).since).toBeNull();
  // The feed entry of Bob's burst knows its items, so it can take Ann to them.
  const entry = (await boardActivity(board.id, ann.id)).entries.find((e) => e.actorName === 'Bob' && e.items?.includes(added));
  expect(entry?.items).toEqual(expect.arrayContaining([added, 'budget']));
  expect(entry?.removedItems).toBe(1);
});

it('a viewer who comes back is not told about changes inside hidden frames', async () => {
  const [owner, viewer] = [await person('Owner'), await person('Viewer')];
  const board = await createBoard(owner.id, 'Launch', '', 'viewer');
  await onBoardLeft({ boardId: board.id, userId: viewer.id, at: Date.now() - 1000 });
  await onBoardLeft({ boardId: board.id, userId: owner.id, at: Date.now() - 1000 });
  const t0 = Date.now();
  const other = await person('Editor');
  recordChanges({ boardId: board.id, actorId: other.id, actorName: other.name, layer: 'editors', changes: [{ id: 'secret', op: 'add', type: 'sticky', frameId: null }], frameTitles: {} }, t0);
  await flushBursts(t0 + getConfig().activityIdleMs);
  expect((await catchUpSummary(board.id, viewer.id)).counts.added).toBe(0);
  expect((await catchUpSummary(board.id, owner.id)).counts.added).toBe(1);
});
