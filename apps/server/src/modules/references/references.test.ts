// The references index end to end on real stored boards (in-memory Postgres): board saves raise
// outbox events in their own transaction, the consumer derives the index, backlinks filter it by
// the reader's live access.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { formatObjectUri, type Account, type BoardElement } from '@freero/shared';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, recordBoardOpen, registerBoardObjectTypes } from '../boards/index';
import { changeBoard, initBoardDoc } from '../realtime/index';
import { createDoc } from '../docs/index';
import * as repo from './repo';
import { backlinksOf, deriveBoardReferences, rebuildReferences, REFERENCES_CONSUMER, referencesConsumer } from './service';

beforeAll(async () => {
  await openTestDb();
  registerBoardObjectTypes();
  registerOutboxConsumer(referencesConsumer);
});
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@refs.test.freero.app`, password: 'password-123' }, { emailVerified: true });
let z = 0;
const sticky = (id: string, text: string, extra: Record<string, unknown> = {}): BoardElement =>
  ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: ++z, createdBy: 'x', createdAt: 1, updatedAt: 1, text, color: 'yellow', ...extra }) as BoardElement;

/** Saves board content the way a new board's first state is saved (raises its outbox event). */
async function save(boardId: string, elements: BoardElement[], comments: Record<string, unknown> = {}) {
  const doc = new Y.Doc();
  for (const e of elements) doc.getMap('elements').set(e.id, e);
  for (const [k, v] of Object.entries(comments)) doc.getMap('comments').set(k, v);
  await initBoardDoc(boardId, Y.encodeStateAsUpdate(doc));
}
const boardUri = (id: string) => formatObjectUri({ type: 'board', id });
const sorted = <T>(xs: T[]) => [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

it('item links, smart links, addresses in text and in comments all become backlinks, and deleting the linking item drops its backlink on the next derivation', async () => {
  const owner = await user('Owner');
  const target = await createBoard(owner.id, 'Roadmap', '');
  const source = await createBoard(owner.id, 'Retro', '');
  await save(target.id, [sticky('goal', 'Ship v2')]);
  await save(
    source.id,
    [
      sticky('a', 'go there', { link: `/board/${target.id}?el=goal` }),
      { ...sticky('chip', ''), type: 'objectlink', uri: boardUri(target.id) } as unknown as BoardElement,
      sticky('b', `<p>see freero://board/${target.id}#goal, please.</p>`),
      sticky('self', 'to myself', { link: '#self' }),
    ],
    {
      't:t1': { kind: 'thread', id: 't1', x: 0, y: 0, elementId: 'b', createdAt: 1, createdBy: owner.id },
      'm:t1:m1': { kind: 'message', threadId: 't1', id: 'm1', authorId: owner.id, authorName: 'Owner', text: `also freero://board/${target.id}`, createdAt: 1 },
    },
  );
  await drainOutbox(REFERENCES_CONSUMER);

  const shape = (bl: Awaited<ReturnType<typeof backlinksOf>>) => sorted(bl.map((l) => ({ from: l.source.uri, kinds: l.kinds.sort(), to: l.target })));
  const goal = formatObjectUri({ type: 'element', boardId: target.id, id: 'goal' });
  expect(shape(await backlinksOf({ userId: owner.id }, boardUri(target.id), []))).toEqual(
    sorted([
      { from: formatObjectUri({ type: 'element', boardId: source.id, id: 'a' }), kinds: ['link'], to: goal },
      { from: formatObjectUri({ type: 'element', boardId: source.id, id: 'chip' }), kinds: ['embed'], to: boardUri(target.id) },
      { from: formatObjectUri({ type: 'element', boardId: source.id, id: 'b' }), kinds: ['mention'], to: goal },
      { from: formatObjectUri({ type: 'element', boardId: source.id, id: 'b' }), kinds: ['comment'], to: boardUri(target.id) },
    ]),
  );
  // The item's own backlinks: just the two pointing at it.
  expect((await backlinksOf({ userId: owner.id }, goal, [])).map((l) => l.source.uri).sort()).toEqual(
    ['a', 'b'].map((id) => formatObjectUri({ type: 'element', boardId: source.id, id })),
  );
  // An item linking to itself on its own board is no reference.
  expect((await repo.referencesFrom(source.id)).some((r) => r.sourceElement === 'self')).toBe(false);

  await changeBoard(source.id, { userId: owner.id, role: 'owner' }, () => ({ change: { remove: ['a'] } }));
  await drainOutbox(REFERENCES_CONSUMER);
  expect((await backlinksOf({ userId: owner.id }, goal, [])).map((l) => l.source.uri)).toEqual([formatObjectUri({ type: 'element', boardId: source.id, id: 'b' })]);
});

it('backlinks name only boards the reader can open, a board they reach only by its link once they opened it, and nothing about a target they can’t see', async () => {
  const [owner, reader, stranger] = await Promise.all([user('BOwner'), user('BReader'), user('BStranger')]);
  const target = await createBoard(owner.id, 'Shared target', '', 'viewer');
  const hidden = await createBoard(owner.id, 'Private notes', '', 'none');
  const byLink = await createBoard(owner.id, 'Link-only plan', '', 'viewer');
  const theirs = await createBoard(reader.id, 'Reader’s board', '');
  for (const b of [hidden, byLink, theirs]) await save(b.id, [sticky('x', '', { link: `/board/${target.id}` })]);
  await drainOutbox(REFERENCES_CONSUMER);

  const titles = async () => (await backlinksOf({ userId: reader.id }, boardUri(target.id), [])).map((l) => l.board.title).sort();
  expect(await titles()).toEqual(['Reader’s board']);
  await recordBoardOpen(byLink.id, reader.id);
  expect(await titles()).toEqual(['Link-only plan', 'Reader’s board']);
  // The owner sees their own two, never the reader's personal board.
  expect((await backlinksOf({ userId: owner.id }, boardUri(target.id), [])).map((l) => l.board.title).sort()).toEqual(['Link-only plan', 'Private notes']);
  // A target the caller can't see answers like a missing one.
  await expect(backlinksOf({ userId: stranger.id }, boardUri(hidden.id), [])).rejects.toMatchObject({ status: 404 });
});

it('a consumer killed between deriving and moving its cursor replays the batch and ends with the rows of an uninterrupted run', async () => {
  const owner = await user('Crash');
  const target = await createBoard(owner.id, 'T', '');
  const boards = await Promise.all(['S1', 'S2', 'S3'].map((t) => createBoard(owner.id, t, '')));
  for (const [i, b] of boards.entries()) await save(b.id, [sticky(`s${i}`, `freero://board/${target.id}`)]);

  // Dies after deriving the first board of the batch, before the cursor moves.
  let calls = 0;
  registerOutboxConsumer({
    ...referencesConsumer,
    async handle(events, ctx) {
      await referencesConsumer.handle(events.slice(0, 1), ctx);
      if (++calls === 1) throw new Error('killed');
      await referencesConsumer.handle(events.slice(1), ctx);
    },
  });
  await expect(drainOutbox(REFERENCES_CONSUMER)).rejects.toThrow('killed');
  await drainOutbox(REFERENCES_CONSUMER); // the restart
  registerOutboxConsumer(referencesConsumer);
  const afterCrash = await Promise.all(boards.map((b) => repo.referencesFrom(b.id)));
  expect(afterCrash.every((rows) => rows.length === 1)).toBe(true);

  // Deriving every board again from scratch (the same entries handled twice) changes nothing.
  await rebuildReferences();
  expect(await Promise.all(boards.map((b) => repo.referencesFrom(b.id)))).toEqual(afterCrash);
});

it('an older derivation arriving late never replaces a newer one (version 5, then 4)', async () => {
  const owner = await user('Order');
  const [a, b, source] = await Promise.all(['A', 'B', 'Src'].map((t) => createBoard(owner.id, t, '')));
  await save(source.id, [sticky('s', `freero://board/${a.id}`)]);
  await deriveBoardReferences(source.id, 1_000_005);
  await changeBoard(source.id, { userId: owner.id, role: 'owner' }, () => ({ change: { update: [{ id: 's', patch: { text: `freero://board/${b.id}` } }] } }));
  // A slow derivation that read the board before the change finally writes, with its older version.
  expect(await repo.replaceReferences(source.id, 1_000_004, [{ sourceElement: 's', sourceType: 'sticky', target: boardUri(a.id), targetBoard: a.id, kind: 'mention' }])).toBe('stale');
  expect((await repo.referencesFrom(source.id)).map((r) => r.target)).toEqual([boardUri(a.id)]);
  await deriveBoardReferences(source.id, 1_000_006);
  expect((await repo.referencesFrom(source.id)).map((r) => r.target)).toEqual([boardUri(b.id)]);
});

it('a rebuild after the index was lost (a restored database) reproduces the rows the live consumer produced', async () => {
  const owner = await user('Restore');
  const target = await createBoard(owner.id, 'Target', '');
  const sources = await Promise.all(['R1', 'R2'].map((t) => createBoard(owner.id, t, '')));
  await save(sources[0].id, [sticky('l', '', { link: `/board/${target.id}?el=zz` })]);
  await save(sources[1].id, [sticky('m', `freero://board/${target.id}`)]);
  await drainOutbox(REFERENCES_CONSUMER);
  const live = await Promise.all(sources.map((s) => repo.referencesFrom(s.id)));
  expect(live.flat()).toHaveLength(2);

  await repo.clearAll();
  await rebuildReferences();
  expect(await Promise.all(sources.map((s) => repo.referencesFrom(s.id)))).toEqual(live);
});

it('a doc embedding a live frame of a board, or linking to it, is in that board’s backlinks (opening the doc at the block) — only for readers of the doc', async () => {
  const [owner, boardOnly] = await Promise.all([user('Writer'), user('BoardReader')]);
  const board = await createBoard(owner.id, 'Workshop', '', 'viewer');
  await save(board.id, [sticky('f1', 'Ideas')]);
  const doc = await createDoc(owner.id, { markdown: `# Outcome\n\n![Live board](freero://board/${board.id}#f1)\n\nSee [the board](/board/${board.id}).\n` });
  await drainOutbox(REFERENCES_CONSUMER);

  const fromDoc = (await backlinksOf({ userId: owner.id }, boardUri(board.id), [])).filter((l) => l.source.type === 'doc');
  expect(fromDoc.map((l) => l.kinds[0]).sort()).toEqual(['embed', 'link']);
  expect(fromDoc.every((l) => l.source.uri === `freero://doc/${doc.id}` && l.source.path.startsWith(`/doc/${doc.id}?block=`))).toBe(true);
  // Someone who may read the board (its link) but not the doc never learns the doc exists.
  await recordBoardOpen(board.id, boardOnly.id);
  expect((await backlinksOf({ userId: boardOnly.id }, boardUri(board.id), [])).filter((l) => l.source.type === 'doc')).toEqual([]);
});
