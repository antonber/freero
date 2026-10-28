// Live activities (KAI-132): answers stay on the server; the board gets results only — and a
// sealed activity not even those until an editor reveals them.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ENGAGE_RESULTS_COLLECTION, type ActivityElement, type ActivityResults, type ElementDraft, type User } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getAccount, markEmailVerified, type Actor } from '../auth/index';
import { createBoard } from '../boards/index';
import { changeBoard, snapshotBoardDoc } from '../realtime/index';
import * as service from './service';

beforeAll(() => openTestDb({ FREERO_DOC_IDLE_MS: '100' }));
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300)); // rooms unload (and save) first
  await closeTestDb();
});

let n = 0;
async function person(label: string): Promise<User> {
  const email = `${label.toLowerCase()}-${++n}@engage.test.freero.app`;
  const u = await createUser({ name: label, email, password: 'password-123' });
  await markEmailVerified(u.id, email);
  return u;
}
const as = async (u: User): Promise<Actor> => ({ kind: 'user', user: await getAccount(u.id) });

async function boardWith(owner: User, activity: Partial<ActivityElement>): Promise<{ boardId: string; id: string }> {
  // Anyone signed in may view: viewers answer too.
  const board = await createBoard(owner.id, 'Town hall', '', 'viewer');
  const draft = {
    id: 'act1',
    x: 0,
    y: 0,
    w: 520,
    h: 400,
    rotation: 0,
    type: 'activity',
    kind: 'poll',
    question: 'Lunch?',
    options: [
      { id: 'a', text: 'Pizza' },
      { id: 'b', text: 'Salad' },
    ],
    maxChoices: 1,
    anonymous: true,
    results: 'live',
    guests: true,
    color: '#5B3FF0',
    ...activity,
  } as unknown as ElementDraft;
  await changeBoard(board.id, { userId: owner.id, role: 'owner' }, () => ({ change: { create: [draft] } }));
  return { boardId: board.id, id: 'act1' };
}

/** What every client of the board holds: the shared doc's state. */
async function boardDoc(boardId: string): Promise<{ json: string; results: ActivityResults | undefined }> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await snapshotBoardDoc(boardId))!);
  return { json: JSON.stringify(doc.toJSON()), results: doc.getMap<ActivityResults>(ENGAGE_RESULTS_COLLECTION).get('act1') };
}

it('an anonymous poll puts only counts on the board — no respondent id or name — and a changed answer replaces the old one', async () => {
  const [owner, ann, bob] = [await person('Owner'), await person('Annabel'), await person('Bartholomew')];
  const { boardId, id } = await boardWith(owner, {});
  await service.answer(boardId, id, await as(ann), { choices: ['a'] });
  await service.answer(boardId, id, await as(bob), { choices: ['a'] });
  const mine = await service.answer(boardId, id, await as(ann), { choices: ['b'] });
  expect(mine.mine).toEqual({ choices: ['b'] });

  const { json, results } = await boardDoc(boardId);
  expect(results?.respondents).toBe(2);
  expect(results?.poll).toEqual([
    { optionId: 'a', count: 1 },
    { optionId: 'b', count: 1 },
  ]);
  for (const secret of [ann.id, bob.id, 'Annabel', 'Bartholomew']) expect(json).not.toContain(secret);
});

it('a sealed activity shows only how many answered until an editor reveals it, and a viewer cannot reveal it', async () => {
  const [owner, viewer] = [await person('Owner'), await person('Viewer')];
  const { boardId, id } = await boardWith(owner, { results: 'reveal' });
  await service.answer(boardId, id, await as(viewer), { choices: ['b'] });
  expect((await boardDoc(boardId)).results).toMatchObject({ respondents: 1, sealed: true });
  expect((await boardDoc(boardId)).results?.poll).toBeUndefined();

  await expect(service.reveal(boardId, id, await as(viewer), true)).rejects.toMatchObject({ status: 403 });
  await service.reveal(boardId, id, await as(owner), true);
  expect((await boardDoc(boardId)).results).toMatchObject({ sealed: false, poll: [{ optionId: 'a', count: 0 }, { optionId: 'b', count: 1 }] });
});

it('a poll answered openly shows names, and an answer over the choice limit or to a closed activity is refused', async () => {
  const [owner, ann] = [await person('Owner'), await person('Ann')];
  const { boardId, id } = await boardWith(owner, { anonymous: false });
  await expect(service.answer(boardId, id, await as(ann), { choices: ['a', 'b'] })).rejects.toMatchObject({ status: 400 });
  await service.answer(boardId, id, await as(ann), { choices: ['a'] });
  expect((await boardDoc(boardId)).results?.poll?.[0]).toEqual({ optionId: 'a', count: 1, names: ['Ann'] });

  const closed = await boardWith(owner, { closed: true });
  await expect(service.answer(closed.boardId, closed.id, await as(ann), { choices: ['a'] })).rejects.toMatchObject({ status: 409 });
});

it('Q&A: each person upvotes a question once, and the most upvoted question comes first', async () => {
  const [owner, ann, bob] = [await person('Owner'), await person('Ann'), await person('Bob')];
  const { boardId, id } = await boardWith(owner, { kind: 'qna', options: [] });
  await service.ask(boardId, id, await as(ann), 'When do we ship?');
  const s = await service.ask(boardId, id, await as(ann), 'Who owns QA?');
  const qa = s.results!.questions!.find((q) => q.text === 'Who owns QA?')!;
  await service.upvote(boardId, id, qa.id, await as(bob), true);
  await service.upvote(boardId, id, qa.id, await as(bob), true);
  await service.upvote(boardId, id, qa.id, await as(owner), true);
  const { results } = await boardDoc(boardId);
  expect(results?.questions?.map((q) => [q.text, q.votes])).toEqual([
    ['Who owns QA?', 2],
    ['When do we ship?', 0],
  ]);
  expect(results?.questions?.every((q) => q.by === undefined)).toBe(true);
});
