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

it('the phone answer page gets the activity from the server alone: its question as plain text and its choices, and only editors may run it', async () => {
  const [owner, viewer] = [await person('Owner'), await person('Viewer')];
  const { boardId, id } = await boardWith(owner, { question: '<p>Lunch <b>today</b>?</p>' });
  const seen = await service.activityState(boardId, id, await as(viewer));
  expect(seen.activity).toMatchObject({ id, kind: 'poll', question: 'Lunch today?', options: [{ id: 'a', text: 'Pizza' }, { id: 'b', text: 'Salad' }], guests: true });
  expect(seen.canRun).toBe(false);
  expect((await service.activityState(boardId, id, await as(owner))).canRun).toBe(true);
});

it('2×2 matrix: each item shows where people put it on average and how far they disagree', async () => {
  const [owner, ann, bob] = [await person('Owner'), await person('Ann'), await person('Bob')];
  const { boardId, id } = await boardWith(owner, { kind: 'matrix', axes: { x: ['Low effort', 'High effort'], y: ['Low impact', 'High impact'] } });
  await service.answer(boardId, id, await as(ann), { positions: { a: { x: 0.2, y: 0.9 }, b: { x: 0.5, y: 0.5 } } });
  await service.answer(boardId, id, await as(bob), { positions: { a: { x: 0.4, y: 0.7 } } });
  await expect(service.answer(boardId, id, await as(bob), { positions: { a: { x: 1.4, y: 0.7 } } })).rejects.toMatchObject({ status: 400 });
  expect((await boardDoc(boardId)).results?.matrix).toEqual([
    { optionId: 'a', count: 2, x: 0.3, y: 0.8, sx: 0.1, sy: 0.1 },
    { optionId: 'b', count: 1, x: 0.5, y: 0.5, sx: 0, sy: 0 },
  ]);
});

it('quiz: the right answer reaches the board only once shown, a late answer is refused, the faster right answer scores more, and the leaderboard waits for the reveal', async () => {
  const [owner, ann, bob, cat] = [await person('Owner'), await person('Ann'), await person('Bob'), await person('Cat')];
  const questions = [
    { id: 'q1', text: 'Capital of Peru?', options: [{ id: 'lima', text: 'Lima' }, { id: 'cusco', text: 'Cusco' }], seconds: 20 },
    { id: 'q2', text: 'Primes?', options: [{ id: 'two', text: '2' }, { id: 'four', text: '4' }, { id: 'five', text: '5' }] },
  ];
  const { boardId, id } = await boardWith(owner, { kind: 'quiz', options: [], questions, anonymous: false, results: 'reveal' });
  await service.setKey(boardId, id, await as(owner), { q1: ['lima'], q2: ['two', 'five'] });
  await expect(service.answer(boardId, id, await as(ann), { quiz: { q1: { choices: ['lima'] } } })).rejects.toMatchObject({ status: 409 });

  const t0 = Date.now();
  await service.runQuiz(boardId, id, await as(owner), { step: 0 }, t0);
  await service.answer(boardId, id, await as(ann), { quiz: { q1: { choices: ['lima'] } } }, t0 + 2000);
  await service.answer(boardId, id, await as(bob), { quiz: { q1: { choices: ['lima'] } } }, t0 + 15000);
  await service.answer(boardId, id, await as(cat), { quiz: { q1: { choices: ['cusco'] } } }, t0 + 5000);
  await expect(service.answer(boardId, id, await as(cat), { quiz: { q1: { choices: ['lima'] } } }, t0 + 25000)).rejects.toMatchObject({ status: 400 });
  let { json, results } = await boardDoc(boardId);
  expect(results?.quiz).toEqual({ questionId: 'q1', answered: 3 });
  expect(json).not.toContain('"correct"');

  await service.runQuiz(boardId, id, await as(owner), { showAnswer: true });
  ({ results } = await boardDoc(boardId));
  expect(results?.quiz?.correct).toEqual(['lima']);
  expect(results?.quiz?.counts).toEqual([{ optionId: 'lima', count: 2 }, { optionId: 'cusco', count: 1 }]);
  await expect(service.answer(boardId, id, await as(cat), { quiz: { q1: { choices: ['lima'] } } })).rejects.toMatchObject({ status: 409 });

  const annScore = (await service.activityState(boardId, id, await as(ann))).myScore!;
  const bobScore = (await service.activityState(boardId, id, await as(bob))).myScore!;
  expect(annScore).toBeGreaterThan(bobScore);
  expect(bobScore).toBeGreaterThan(0);
  expect(results?.quiz?.leaderboard).toBeUndefined();
  // Participants never get the key; whoever runs the quiz does.
  expect((await service.activityState(boardId, id, await as(ann))).key).toBeUndefined();

  await service.reveal(boardId, id, await as(owner), true);
  ({ results } = await boardDoc(boardId));
  expect(results?.quiz?.leaderboard?.map((r) => [r.name, r.right])).toEqual([['Ann', 1], ['Bob', 1], ['Cat', 0]]);
});
