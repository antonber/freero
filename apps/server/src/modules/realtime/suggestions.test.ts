// Suggestions on the server (KAI-169): a proposal never touches the board until it is accepted,
// only owners and editors ever read it, accepting on a request applies it attributed to both
// people and refuses to overwrite a change made since unless forced — and a socket can only
// DECIDE suggestions as itself, never forge or rewrite one (the badge says who proposed it).
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SUGGESTIONS_COLLECTION, type BoardElement, type SuggestionRecord } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { changeBoard, decideSuggestions, initBoardDoc, proposeSuggestions, readBoardView } from './rooms';
import { guardSuggestionWrites, SuggestionStaleError } from './suggestions';

let owner: string;
beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: '100' });
  owner = (await createUser({ name: 'Owner', email: 'suggest@test.freero.app', password: 'password-123' })).id;
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await closeTestDb();
});

const sticky = (id: string, text: string, x = 0) =>
  ({ id, type: 'sticky', x, y: 0, w: 200, h: 200, rotation: 0, z: 1, createdBy: 'someone', createdAt: 1, updatedAt: 1, text, color: 'yellow' }) as unknown as BoardElement;
const author = { kind: 'app' as const, name: 'Planner bot', userId: 'agent-owner', userName: 'Maria', credentialId: 'tok1' };
const draft = (el: BoardElement) => {
  const { z: _z, createdBy: _c, createdAt: _a, updatedAt: _u, ...rest } = el;
  return rest as never;
};

it('a proposal is not on the board, reaches only owners and editors, and accepting it later refuses to overwrite an edit made since unless forced', async () => {
  const boardId = (await createBoard(owner, 'Suggest', '')).id;
  const seed = new Y.Doc();
  seed.getMap('elements').set('x', sticky('x', 'Old'));
  await initBoardDoc(boardId, Y.encodeStateAsUpdate(seed));
  const editor = { userId: owner, role: 'owner' as const };

  const { records } = await proposeSuggestions(boardId, editor, { author, description: 'Tidy up' }, () => ({
    change: { create: [draft(sticky('n', 'New idea', 600))], update: [{ id: 'x', patch: { text: 'Rewritten' } }] },
  }));
  expect(records.map((r) => r.op).sort()).toEqual(['create', 'update']);
  const seen = await readBoardView(boardId, editor);
  expect(seen.elements.map((e) => e.el.id)).toEqual(['x']); // nothing written
  expect((seen.elements[0].el as unknown as { text: string }).text).toBe('Old');
  expect(seen.suggestions).toHaveLength(2);
  expect((await readBoardView(boardId, { userId: 'v', role: 'viewer' })).suggestions).toHaveLength(0);
  expect((await readBoardView(boardId, { userId: 'c', role: 'commenter' })).suggestions).toHaveLength(0);

  // Someone edits the sticky the proposal rewrites.
  await changeBoard(boardId, editor, () => ({ change: { update: [{ id: 'x', patch: { text: 'Edited by Bob' } }] } }));
  const groupId = records[0].groupId;
  await expect(decideSuggestions(boardId, editor, { groupId, status: 'accepted' })).rejects.toBeInstanceOf(SuggestionStaleError);
  let view = await readBoardView(boardId, editor);
  expect(view.elements.map((e) => e.el.id)).toEqual(['x']); // refused whole: the new sticky didn't land either
  expect((view.elements[0].el as unknown as { text: string }).text).toBe('Edited by Bob');

  const out = await decideSuggestions(boardId, editor, { groupId, status: 'accepted', force: true });
  expect(out.decision.forced).toBe(true);
  view = await readBoardView(boardId, editor);
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  expect((byId.get('x') as unknown as { text: string }).text).toBe('Rewritten');
  expect(byId.get('n')?.createdBy).toBe(owner); // who accepted it…
  expect(byId.get('n')?.suggestedBy).toEqual({ kind: 'app', name: 'Planner bot', userId: 'agent-owner' }); // …and who proposed it
  expect(view.suggestions).toHaveLength(0);
});

it('a socket may only accept, reject or undo a suggestion as itself; adding, rewriting or deleting one is undone in the same transaction', () => {
  const doc = new Y.Doc();
  const map = doc.getMap<unknown>(SUGGESTIONS_COLLECTION);
  const rec: SuggestionRecord = { id: 's1', groupId: 'g', author, description: 'Ideas', createdAt: 1, op: 'create', element: sticky('n', 'Idea') };
  map.set('s1', rec);
  const asSocket = (userId: string, write: () => void) => {
    let out!: ReturnType<typeof guardSuggestionWrites>;
    doc.transact((tr) => {
      write();
      out = guardSuggestionWrites(tr, doc, userId);
    });
    return out;
  };

  // Forging a proposal under someone else's badge, rewriting one, deleting one: all undone.
  expect(asSocket('ann', () => map.set('s2', { ...rec, id: 's2', author: { ...author, name: 'Freero' } })).reverted).toBe(1);
  expect(asSocket('ann', () => map.set('s1', { ...rec, description: 'Delete everything' })).reverted).toBe(1);
  expect(asSocket('ann', () => map.delete('s1')).reverted).toBe(1);
  expect(asSocket('ann', () => map.set('s1', { ...rec, decision: { status: 'accepted', by: 'bob', at: 2 } })).reverted).toBe(1);
  expect([...map.keys()]).toEqual(['s1']);
  expect(map.get('s1')).toEqual(rec);

  // Deciding as yourself, and undoing your own decision, go through (and are reported for the audit log).
  const ok = asSocket('ann', () => map.set('s1', { ...rec, decision: { status: 'accepted', by: 'ann', at: 2 } }));
  expect(ok).toMatchObject({ reverted: 0, decided: [{ to: { status: 'accepted', by: 'ann' } }] });
  expect(asSocket('bob', () => map.set('s1', rec)).reverted).toBe(1); // not Bob's decision to undo
  expect(asSocket('ann', () => map.set('s1', rec))).toMatchObject({ reverted: 0, decided: [{ to: undefined }] });
});
