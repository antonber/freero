// Live audience activities (KAI-132): answers, questions and upvotes come in on requests (the
// person's session or a guest's), are checked against the `activity` element as that person sees
// the board, and are kept here — never in the board. The board gets only the results
// (rules.ts computeResults), written by realtime as the one server-written collection. A sealed
// activity (`results: 'reveal'`) publishes only how many answered until an editor reveals it.
import {
  ENGAGE_MAX_QUESTION,
  ENGAGE_MAX_QUESTIONS_PER_PERSON,
  ENGAGE_RESULTS_COLLECTION,
  guestDisplayName,
  type ActivityElement,
  type ActivityResults,
  type ActivityState,
  type Role,
} from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import type { Actor } from '../auth/index';
import { actorId as idOf } from '../auth/index';
import { requireBoardAccess } from '../boards/index';
import { readBoardView, writeServerCollection } from '../realtime/index';
import * as repo from './repo';
import { AnswerError, cleanAnswer, computeResults } from './rules';

/** Answers kept per activity (a workshop, a town hall): more is refused, never silently dropped. */
const MAX_ANSWERS = 5000;

interface Ctx {
  boardId: string;
  personId: string;
  /** The name shown with an open answer or question. */
  name: string;
  guest: boolean;
  role: Role;
  activity: ActivityElement;
}

const canEdit = (role: Role) => role === 'owner' || role === 'editor';
const nameOf = (a: Actor) => (a.kind === 'user' ? a.user.name : guestDisplayName(a.guest.name));

/** The activity as `actor` sees the board (404 when they can't open the board or don't see the activity). */
async function load(boardId: string, activityId: string, actor: Actor): Promise<Ctx> {
  const personId = idOf(actor);
  const { role } = await requireBoardAccess(boardId, personId);
  const view = await readBoardView(boardId, { userId: personId, role });
  // Not someone's private draft (only its author sees it, and it may still change).
  const hit = view.elements.find((e) => e.el.id === activityId && e.el.type === 'activity' && e.layer !== 'private');
  if (!hit) throw notFound('This activity is no longer on the board');
  return { boardId, personId, name: nameOf(actor), guest: actor.kind === 'guest', role, activity: hit.el as ActivityElement };
}

/** Why this person can't answer now (null: they can). */
function refusal(c: Ctx): string | null {
  if (c.activity.closed) return 'Answers are closed';
  if (c.guest && !c.activity.guests) return 'Sign in to answer this one';
  return null;
}

function requireAnswering(c: Ctx): void {
  const why = refusal(c);
  if (why) throw new HttpError(409, why, 'engage_closed');
}

function requireEditor(c: Ctx): void {
  if (!canEdit(c.role)) throw forbidden('Only owners and editors run activities');
}

async function resultsOf(c: Ctx, now = Date.now()): Promise<{ results: ActivityResults; revealed: boolean }> {
  const revealed = c.activity.results !== 'reveal' || (await repo.isRevealed(c.boardId, c.activity.id));
  const [answers, questions] = await Promise.all([
    c.activity.kind === 'qna' ? Promise.resolve([]) : repo.answersOf(c.boardId, c.activity.id, MAX_ANSWERS),
    c.activity.kind === 'qna' ? repo.questionsOf(c.boardId, c.activity.id) : Promise.resolve([]),
  ]);
  return { results: computeResults(c.activity, answers, questions, !revealed, now), revealed };
}

// One publish per activity at a time; changes arriving meanwhile are folded into one more round,
// so a burst of answers costs two board writes, not one each.
const inFlight = new Map<string, { again: Ctx | null; done: Promise<void> }>();

function publish(c: Ctx): Promise<void> {
  const key = `${c.boardId}\n${c.activity.id}`;
  const running = inFlight.get(key);
  if (running) {
    running.again = c;
    return running.done;
  }
  const entry: { again: Ctx | null; done: Promise<void> } = { again: null, done: Promise.resolve() };
  entry.done = (async () => {
    for (let next: Ctx | null = c; next; ) {
      const { results } = await resultsOf(next);
      await writeServerCollection(next.boardId, ENGAGE_RESULTS_COLLECTION, { [next.activity.id]: results });
      next = entry.again;
      entry.again = null;
    }
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, entry);
  return entry.done;
}

async function stateFor(c: Ctx): Promise<ActivityState> {
  const [{ results, revealed }, mine, my] = await Promise.all([
    resultsOf(c),
    c.activity.kind === 'qna' ? Promise.resolve(null) : repo.myAnswer(c.boardId, c.activity.id, c.personId),
    c.activity.kind === 'qna' ? repo.mine(c.boardId, c.activity.id, c.personId) : Promise.resolve({ upvotes: [], questions: [] }),
  ]);
  const why = refusal(c);
  return { results, mine, myUpvotes: my.upvotes, myQuestions: my.questions, revealed, canAnswer: !why, ...(why ? { reason: why } : {}) };
}

export async function activityState(boardId: string, activityId: string, actor: Actor): Promise<ActivityState> {
  return stateFor(await load(boardId, activityId, actor));
}

/** Sets the person's answer (one per person: a new one replaces it), then publishes the results. */
export async function answer(boardId: string, activityId: string, actor: Actor, raw: unknown, now = Date.now()): Promise<ActivityState> {
  const c = await load(boardId, activityId, actor);
  requireAnswering(c);
  let value;
  try {
    value = cleanAnswer(c.activity, raw);
  } catch (e) {
    if (e instanceof AnswerError) throw badRequest(e.message);
    throw e;
  }
  if (!(await repo.myAnswer(boardId, activityId, c.personId)) && (await repo.countAnswers(boardId, activityId)) >= MAX_ANSWERS)
    throw new HttpError(409, 'This activity can’t take more answers', 'engage_full');
  // Anonymous: no name is kept with the answer, so switching the activity to named later shows nothing.
  if (!(await repo.setAnswer(boardId, activityId, c.personId, c.activity.anonymous ? null : c.name, value, now))) throw notFound('Board not found');
  await publish(c);
  return stateFor(c);
}

export async function withdraw(boardId: string, activityId: string, actor: Actor): Promise<ActivityState> {
  const c = await load(boardId, activityId, actor);
  requireAnswering(c);
  await repo.deleteAnswer(boardId, activityId, c.personId);
  await publish(c);
  return stateFor(c);
}

export async function ask(boardId: string, activityId: string, actor: Actor, text: unknown, now = Date.now()): Promise<ActivityState> {
  const c = await load(boardId, activityId, actor);
  if (c.activity.kind !== 'qna') throw badRequest('This activity takes answers, not questions');
  requireAnswering(c);
  const t = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!t) throw badRequest('Type your question');
  if (t.length > ENGAGE_MAX_QUESTION) throw badRequest(`Keep it under ${ENGAGE_MAX_QUESTION} characters`);
  if ((await repo.countQuestionsBy(boardId, activityId, c.personId)) >= ENGAGE_MAX_QUESTIONS_PER_PERSON)
    throw new HttpError(409, `You can ask up to ${ENGAGE_MAX_QUESTIONS_PER_PERSON} questions here`, 'engage_full');
  const ok = await repo.addQuestion({ id: newId(12), boardId, activityId, authorId: c.personId, authorName: c.activity.anonymous ? null : c.name, text: t, now });
  if (!ok) throw notFound('Board not found');
  await publish(c);
  return stateFor(c);
}

/** One upvote per person per question (`on: false` takes it back). */
export async function upvote(boardId: string, activityId: string, questionId: string, actor: Actor, on: unknown, now = Date.now()): Promise<ActivityState> {
  const c = await load(boardId, activityId, actor);
  requireAnswering(c);
  if (typeof on !== 'boolean') throw badRequest('on must be true or false');
  if (!(await repo.questionIn(boardId, activityId, questionId))) throw notFound('That question is gone');
  await repo.setUpvote(questionId, c.personId, on, now);
  await publish(c);
  return stateFor(c);
}

/** Editors: mark a question answered, or hide it from the board. */
export async function moderate(boardId: string, activityId: string, questionId: string, actor: Actor, body: { answered?: unknown; hidden?: unknown }, now = Date.now()): Promise<ActivityState> {
  const c = await load(boardId, activityId, actor);
  requireEditor(c);
  const patch: { answered?: boolean; hidden?: boolean } = {};
  if (typeof body.answered === 'boolean') patch.answered = body.answered;
  if (typeof body.hidden === 'boolean') patch.hidden = body.hidden;
  if (!Object.keys(patch).length) throw badRequest('Say answered or hidden');
  if (!(await repo.questionIn(boardId, activityId, questionId, true))) throw notFound('That question is gone');
  await repo.moderateQuestion(questionId, patch, now);
  await publish(c);
  return stateFor(c);
}

/** Editors: show sealed results to everyone (or seal them again). */
export async function reveal(boardId: string, activityId: string, actor: Actor, revealed: unknown, now = Date.now()): Promise<ActivityState> {
  const c = await load(boardId, activityId, actor);
  requireEditor(c);
  if (typeof revealed !== 'boolean') throw badRequest('revealed must be true or false');
  await repo.setRevealed(boardId, activityId, revealed, now);
  await publish(c);
  return stateFor(c);
}

/** Editors: start over (every answer, question and upvote of this activity goes). */
export async function clear(boardId: string, activityId: string, actor: Actor): Promise<ActivityState> {
  const c = await load(boardId, activityId, actor);
  requireEditor(c);
  await repo.clearActivity(boardId, activityId);
  await publish(c);
  return stateFor(c);
}
