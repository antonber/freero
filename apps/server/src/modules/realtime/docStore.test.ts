// The update log + compaction against a real (in-memory) Postgres: compaction runs while other
// saves (and other compactions, from other instances) keep happening, and must never drop one.
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { appendUpdates, compactDoc, listSnapshots, loadDoc, loadSnapshot, snapshotEveryMs, snapshotIfDue } from './docStore';

// Lets a test pause a compaction after it read and folded the log, before it writes.
const hooks = vi.hoisted(() => ({ beforeWrite: async () => {} }));
vi.mock('./repo', async (importOriginal) => {
  const real = await importOriginal<typeof import('./repo')>();
  return {
    ...real,
    compact: async (...args: Parameters<typeof real.compact>) => {
      await hooks.beforeWrite();
      return real.compact(...args);
    },
  };
});

let userId: string;
beforeAll(async () => {
  await openTestDb();
  userId = (await createUser({ name: 'Log', email: 'log@test.freero.app', password: 'password-123' })).id;
});
afterAll(closeTestDb);
beforeEach(() => {
  hooks.beforeWrite = async () => {};
});

/** A client editing the board: each call returns the update that one edit produced. */
function editor() {
  const doc = new Y.Doc();
  return (key: string, value = key) => {
    let update: Uint8Array | null = null;
    const grab = (u: Uint8Array) => (update = u);
    doc.on('update', grab);
    doc.getMap('elements').set(key, value);
    doc.off('update', grab);
    return update!;
  };
}
async function stored(boardId: string): Promise<Record<string, unknown>> {
  const doc = new Y.Doc();
  const { state } = await loadDoc(boardId);
  if (state) Y.applyUpdate(doc, state);
  return doc.getMap('elements').toJSON();
}
function paused() {
  let reached!: () => void;
  let release!: () => void;
  const at = new Promise<void>((r) => (reached = r));
  const gate = new Promise<void>((r) => (release = r));
  return { at, release, hook: async () => (reached(), gate) };
}

it('an edit saved while a compaction is folding the log is not lost when the compaction deletes the folded rows', async () => {
  const board = (await createBoard(userId, 'Busy', '')).id;
  const edit = editor();
  for (let i = 0; i < 20; i++) await appendUpdates(board, [edit(`k${i}`)]);

  const p = paused();
  hooks.beforeWrite = p.hook;
  const compaction = compactDoc(board);
  await p.at; // it has read and folded k0..k19
  await appendUpdates(board, [edit('during')]);
  p.release();
  expect(await compaction).toBe('compacted');

  const after = await stored(board);
  expect(Object.keys(after).sort()).toEqual([...Array.from({ length: 20 }, (_, i) => `k${i}`), 'during'].sort());
  expect((await loadDoc(board)).logRows).toBe(1); // only the row written during the compaction is left
});

it('a compaction that read the log before another instance compacted it does not overwrite that newer base', async () => {
  const board = (await createBoard(userId, 'Two instances', '')).id;
  const edit = editor();
  await appendUpdates(board, [edit('a')]);

  const p = paused();
  hooks.beforeWrite = p.hook;
  const slow = compactDoc(board); // instance 1 folds { a }
  await p.at;
  hooks.beforeWrite = async () => {};
  await appendUpdates(board, [edit('b')]);
  expect(await compactDoc(board)).toBe('compacted'); // instance 2 folds { a, b } and deletes both rows
  p.release();
  expect(await slow).toBe('skipped');

  expect(Object.keys(await stored(board)).sort()).toEqual(['a', 'b']);
});

it('a snapshot keeps the board as it was when taken, and compacting more often does not add one each time', async () => {
  const board = (await createBoard(userId, 'History', '')).id;
  const edit = editor();
  const t0 = Date.now();
  const SNAPSHOT_EVERY_MS = snapshotEveryMs();
  await appendUpdates(board, [edit('first')], t0);
  await compactDoc(board, t0);
  await appendUpdates(board, [edit('second')], t0 + 60_000);
  await compactDoc(board, t0 + 60_000); // a minute later: no new snapshot
  await appendUpdates(board, [edit('third')], t0 + SNAPSHOT_EVERY_MS + 1);
  await compactDoc(board, t0 + SNAPSHOT_EVERY_MS + 1);

  const snaps = await listSnapshots(board);
  expect(snaps.map((s) => s.createdAt)).toEqual([t0 + SNAPSHOT_EVERY_MS + 1, t0]);
  const oldest = new Y.Doc();
  Y.applyUpdate(oldest, (await loadSnapshot(board, snaps[1].id))!);
  expect(Object.keys(oldest.getMap('elements').toJSON())).toEqual(['first']);
  expect(Object.keys(await stored(board)).sort()).toEqual(['first', 'second', 'third']);

  const other = (await createBoard(userId, 'Other', '')).id;
  expect(await loadSnapshot(other, snaps[0].id)).toBeNull(); // a snapshot id only opens its own board
});

it('two instances keeping the live board as an automatic version at the same moment store one, and a compaction in the same period adds none', async () => {
  const board = (await createBoard(userId, 'Open on two instances', '')).id;
  const state = editor()('live');
  const t0 = Date.now();
  const both = await Promise.all([snapshotIfDue(board, state, t0), snapshotIfDue(board, state, t0 + 1)]);
  expect(both.filter((r) => r.taken)).toHaveLength(1);
  await appendUpdates(board, [editor()('later')], t0 + 60_000);
  await compactDoc(board, t0 + 60_000);
  expect(await listSnapshots(board)).toHaveLength(1);
  expect((await snapshotIfDue(board, state, t0 + snapshotEveryMs())).taken).toBe(true); // a period later
});
