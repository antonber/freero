// Search end to end on real stored boards (in-memory Postgres): saves raise outbox events, the
// consumer derives the index from what every reader sees, and every query re-checks the reader's
// live access before showing anything.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Account, BoardElement } from '@freero/shared';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, recordBoardOpen, registerBoardObjectTypes } from '../boards/index';
import { inviteBoardMember, removeBoardMember } from '../members/index';
import { initBoardDoc, initBoardLayer } from '../realtime/index';
import { SEARCH_CONSUMER, searchConsumer, searchFor } from './service';

beforeAll(async () => {
  await openTestDb();
  registerBoardObjectTypes();
  registerOutboxConsumer(searchConsumer);
});
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@search.test.freero.app`, password: 'password-123' }, { emailVerified: true });
let z = 0;
const el = (id: string, type: string, fields: Record<string, unknown>): BoardElement =>
  ({ id, type, x: 0, y: 0, w: 100, h: 100, rotation: 0, z: ++z, createdBy: 'x', createdAt: 1, updatedAt: 1, ...fields }) as BoardElement;
const sticky = (id: string, text: string, extra: Record<string, unknown> = {}) => el(id, 'sticky', { text, color: 'yellow', ...extra });

async function save(boardId: string, shared: BoardElement[], comments: Record<string, unknown> = {}) {
  const doc = new Y.Doc();
  for (const e of shared) doc.getMap('elements').set(e.id, e);
  for (const [k, v] of Object.entries(comments)) doc.getMap('comments').set(k, v);
  await initBoardDoc(boardId, Y.encodeStateAsUpdate(doc));
}
async function layer(boardId: string, name: string, elements: BoardElement[]) {
  const doc = new Y.Doc();
  for (const e of elements) doc.getMap('elements').set(e.id, e);
  await initBoardLayer(boardId, name, Y.encodeStateAsUpdate(doc));
}
const hitsOf = async (userId: string, q: string, extra: Record<string, unknown> = {}) => (await searchFor({ userId }, { q, ...extra })).hits;

it('finds a word on a sticky and in a comment, opening the board at that item; never a private draft, a hidden frame’s contents or a comment pinned inside one — not even for the owner', async () => {
  const owner = await user('Owner');
  const b = await createBoard(owner.id, 'Launch plan', '');
  const t = Date.now();
  await save(
    b.id,
    [
      sticky('s1', '<p>Run the pricing experiment in May</p>'),
      el('hf', 'frame', { title: 'Secret frame', hidden: true }),
      // In flight to the editors layer: still in the shared doc, but under a hidden frame.
      sticky('inside', 'pricing for the board only', { frameId: 'hf' }),
    ],
    {
      't:t1': { kind: 'thread', id: 't1', x: 0, y: 0, elementId: 's1', createdAt: t, createdBy: owner.id },
      'm:t1:m1': { kind: 'message', threadId: 't1', id: 'm1', authorId: owner.id, authorName: 'Owner', text: 'Budget approved for pricing', createdAt: t },
      't:t2': { kind: 'thread', id: 't2', x: 0, y: 0, elementId: 'inside', createdAt: t, createdBy: owner.id },
      'm:t2:m1': { kind: 'message', threadId: 't2', id: 'm1', authorId: owner.id, authorName: 'Owner', text: 'pricing whispers', createdAt: t },
    },
  );
  await layer(b.id, 'editors', [sticky('hidden-copy', 'pricing behind the curtain', { frameId: 'hf' })]);
  await layer(b.id, `u:${owner.id}`, [sticky('draft', 'pricing draft nobody saw')]);
  await drainOutbox(SEARCH_CONSUMER);

  const hits = await hitsOf(owner.id, 'pric');
  expect(hits.map((h) => `${h.kind} ${h.itemId ?? ''}`).sort()).toEqual(['comment s1', 'item s1']);
  const item = hits.find((h) => h.kind === 'item')!;
  expect(item.path).toBe(`/board/${b.id}?el=s1`);
  expect(item.board).toEqual({ id: b.id, title: 'Launch plan' });
  expect(item.highlights.map((r) => item.snippet.slice(r.start, r.end))).toEqual(['pricing']);
  expect(hits.find((h) => h.kind === 'comment')!.path).toBe(`/board/${b.id}?thread=t1`);
  // Nothing withheld leaks into any snippet.
  // (The hidden frame's own title is on the board for everyone; only what is inside it is withheld.)
  for (const word of ['curtain', 'draft', 'whispers', 'board only']) expect(await hitsOf(owner.id, word)).toEqual([]);
});

it('someone removed from a board stops finding it on the next query (no re-derive), and a board reached only by its link is found once they opened it', async () => {
  const [owner, reader] = await Promise.all([user('Keeper'), user('Visitor')]);
  const shared = await createBoard(owner.id, 'Shared notes', '');
  const byLink = await createBoard(owner.id, 'Link notes', '', 'viewer');
  await save(shared.id, [sticky('a', 'quarterly roadmap')]);
  await save(byLink.id, [sticky('b', 'quarterly retro')]);
  await drainOutbox(SEARCH_CONSUMER);
  const titles = async () => (await hitsOf(reader.id, 'quarterly')).map((h) => h.board.title).sort();

  expect(await titles()).toEqual([]);
  await inviteBoardMember(null, shared.id, owner, { email: reader.email, role: 'viewer' });
  expect(await titles()).toEqual(['Shared notes']);
  await recordBoardOpen(byLink.id, reader.id);
  expect(await titles()).toEqual(['Link notes', 'Shared notes']);
  await removeBoardMember(shared.id, owner.id, reader.id);
  expect(await titles()).toEqual(['Link notes']);
});

it('query syntax in what people type is just words: operators, quotes and backslashes never fail the query or widen it', async () => {
  const owner = await user('Typist');
  const b = await createBoard(owner.id, 'Syntax', '');
  await save(b.id, [sticky('x', 'alpha beta'), sticky('y', 'gamma')]);
  await drainOutbox(SEARCH_CONSUMER);
  for (const q of [`alpha & !beta`, `alpha | gamma`, `'alpha':*`, `al\\pha)`, `"alpha" <-> (beta`])
    expect((await hitsOf(owner.id, q, { board: b.id })).every((h) => h.itemId === 'x')).toBe(true);
  expect((await hitsOf(owner.id, `alpha | gamma`, { board: b.id })).length).toBe(0);
});
