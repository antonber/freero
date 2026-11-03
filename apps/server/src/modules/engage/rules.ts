// Pure rules of live activities (KAI-132): what a valid answer is for an activity, and the results
// the board shows. No answer leaves the server except as these results — counts, words, averages —
// plus, for answers given openly (not anonymous) to a poll, the names that picked each choice.
import {
  ENGAGE_MAX_CLOUD_WORDS,
  ENGAGE_MAX_OPTIONS,
  ENGAGE_MAX_QUIZ_QUESTIONS,
  ENGAGE_MAX_QUIZ_SECONDS,
  ENGAGE_MAX_WORD_LENGTH,
  ENGAGE_MAX_WORDS,
  ENGAGE_QUIZ_GRACE_MS,
  ENGAGE_QUIZ_POINTS,
  type ActivityAnswer,
  type ActivityElement,
  type ActivityResults,
  type QuizQuestion,
} from '@freero/shared';

export class AnswerError extends Error {}

/** The options of an activity as the server trusts them: unique ids, at most ENGAGE_MAX_OPTIONS. */
export function optionIds(a: Pick<ActivityElement, 'options'>): string[] {
  const out: string[] = [];
  for (const o of Array.isArray(a.options) ? a.options : []) {
    if (o && typeof o.id === 'string' && o.id && !out.includes(o.id)) out.push(o.id);
    if (out.length >= ENGAGE_MAX_OPTIONS) break;
  }
  return out;
}

export const scaleOf = (a: Pick<ActivityElement, 'scale'>): number =>
  typeof a.scale === 'number' && Number.isInteger(a.scale) && a.scale >= 2 && a.scale <= 10 ? a.scale : 5;

export const maxChoicesOf = (a: Pick<ActivityElement, 'maxChoices' | 'options'>): number => {
  const n = optionIds(a).length;
  return typeof a.maxChoices === 'number' && Number.isInteger(a.maxChoices) && a.maxChoices >= 1 ? Math.min(a.maxChoices, Math.max(1, n)) : 1;
};

/** One word-cloud entry as it is counted: trimmed, single-spaced, lower case. '' when unusable. */
export function normalWord(w: unknown): string {
  if (typeof w !== 'string') return '';
  const t = w.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  return t.length > ENGAGE_MAX_WORD_LENGTH ? '' : t;
}

/** The answer `raw` to `activity`, cleaned; throws an AnswerError (a message fit for people) when it isn't one. */
export function cleanAnswer(activity: ActivityElement, raw: unknown): ActivityAnswer {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const ids = optionIds(activity);
  switch (activity.kind) {
    case 'poll': {
      const picked = Array.isArray(v.choices) ? [...new Set(v.choices.filter((c): c is string => typeof c === 'string'))] : [];
      if (!picked.length) throw new AnswerError('Pick an answer');
      if (picked.some((c) => !ids.includes(c))) throw new AnswerError('That choice isn’t in this poll any more');
      const max = maxChoicesOf(activity);
      if (picked.length > max) throw new AnswerError(max === 1 ? 'Pick one answer' : `Pick at most ${max} answers`);
      return { choices: ids.filter((id) => picked.includes(id)) };
    }
    case 'wordcloud': {
      const words = Array.isArray(v.words) ? v.words : [];
      const clean = [...new Set(words.map(normalWord).filter(Boolean))];
      if (words.some((w) => typeof w === 'string' && w.trim() && !normalWord(w))) throw new AnswerError(`Keep each answer under ${ENGAGE_MAX_WORD_LENGTH} characters`);
      if (!clean.length) throw new AnswerError('Type a word');
      if (clean.length > ENGAGE_MAX_WORDS) throw new AnswerError(`Up to ${ENGAGE_MAX_WORDS} words`);
      return { words: clean };
    }
    case 'ranking': {
      const order = Array.isArray(v.order) ? v.order.filter((c): c is string => typeof c === 'string') : [];
      if (order.length !== ids.length || new Set(order).size !== order.length || order.some((id) => !ids.includes(id)))
        throw new AnswerError('Rank every item once');
      return { order };
    }
    case 'rating': {
      const scale = scaleOf(activity);
      const given = v.ratings && typeof v.ratings === 'object' && !Array.isArray(v.ratings) ? (v.ratings as Record<string, unknown>) : {};
      const ratings: Record<string, number> = {};
      for (const [id, n] of Object.entries(given)) {
        if (!ids.includes(id)) throw new AnswerError('That statement isn’t in this activity any more');
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > scale) throw new AnswerError(`Rate from 1 to ${scale}`);
        ratings[id] = n;
      }
      if (!Object.keys(ratings).length) throw new AnswerError('Rate at least one statement');
      return { ratings };
    }
    case 'matrix': {
      const given = v.positions && typeof v.positions === 'object' && !Array.isArray(v.positions) ? (v.positions as Record<string, unknown>) : {};
      const positions: Record<string, { x: number; y: number }> = {};
      for (const [id, p] of Object.entries(given)) {
        if (!ids.includes(id)) throw new AnswerError('That item isn’t in this matrix any more');
        const { x, y } = (p ?? {}) as { x?: unknown; y?: unknown };
        if (!unit(x) || !unit(y)) throw new AnswerError('Place items inside the matrix');
        positions[id] = { x: round3(x), y: round3(y) };
      }
      if (!Object.keys(positions).length) throw new AnswerError('Place at least one item');
      return { positions };
    }
    default:
      throw new AnswerError('Ask a question or upvote one instead');
  }
}

const unit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---- quiz (#147) ----

/** A quiz's questions as the server trusts them: unique ids, valid options, at most the cap. */
export function quizQuestions(a: Pick<ActivityElement, 'questions'>): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  for (const q of Array.isArray(a.questions) ? a.questions : []) {
    if (!q || typeof q.id !== 'string' || !q.id || out.some((x) => x.id === q.id)) continue;
    out.push({ id: q.id, text: typeof q.text === 'string' ? q.text : '', options: optionsOf(q), seconds: secondsOf(q), multi: q.multi === true });
    if (out.length >= ENGAGE_MAX_QUIZ_QUESTIONS) break;
  }
  return out;
}

const optionsOf = (q: { options?: unknown }) => {
  const ids = optionIds({ options: q.options as ActivityElement['options'] });
  return (Array.isArray(q.options) ? q.options : []).filter((o) => ids.includes(o?.id)).map((o) => ({ id: o.id as string, text: typeof o.text === 'string' ? o.text : '' }));
};
const secondsOf = (q: { seconds?: unknown }) =>
  typeof q.seconds === 'number' && Number.isInteger(q.seconds) && q.seconds > 0 ? Math.min(q.seconds, ENGAGE_MAX_QUIZ_SECONDS) : 0;

/** The question open for answers now, or why there is none (a message fit for people). */
export function openQuestion(a: ActivityElement, now: number): QuizQuestion | string {
  const qs = quizQuestions(a);
  const step = a.quiz?.step ?? -1;
  if (!a.quiz || step < 0 || step >= qs.length) return 'The quiz hasn’t started yet';
  if (a.quiz.showAnswer) return 'Wait for the next question';
  const q = qs[step];
  if (q.seconds && now > a.quiz.openedAt + q.seconds * 1000 + ENGAGE_QUIZ_GRACE_MS) return 'Time’s up for this question';
  return q;
}

/**
 * A quiz answer: the open question's choices, merged into the person's earlier answers (which
 * stay as they were), stamped with how long they took on the server's clock.
 */
export function cleanQuizAnswer(a: ActivityElement, prev: ActivityAnswer | null, raw: unknown, now: number): ActivityAnswer {
  const q = openQuestion(a, now);
  if (typeof q === 'string') throw new AnswerError(q);
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const given = v.quiz && typeof v.quiz === 'object' ? (v.quiz as Record<string, unknown>)[q.id] : undefined;
  const choices = given && typeof given === 'object' && Array.isArray((given as { choices?: unknown }).choices) ? [...new Set((given as { choices: unknown[] }).choices.filter((c): c is string => typeof c === 'string'))] : [];
  const ids = q.options.map((o) => o.id);
  if (!choices.length) throw new AnswerError('Pick an answer');
  if (choices.some((c) => !ids.includes(c))) throw new AnswerError('That answer isn’t in this question');
  return { quiz: { ...(prev?.quiz ?? {}), [q.id]: { choices: ids.filter((id) => choices.includes(id)), ms: Math.max(0, now - (a.quiz?.openedAt ?? now)) } } };
}

/** A clean answer key: for questions of this quiz, at least one of their options each. */
export function cleanKey(a: ActivityElement, raw: unknown): Record<string, string[]> {
  const given = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string[]> = {};
  for (const q of quizQuestions(a)) {
    const ids = q.options.map((o) => o.id);
    const right = Array.isArray(given[q.id]) ? ids.filter((id) => (given[q.id] as unknown[]).includes(id)) : [];
    if (right.length) out[q.id] = right;
  }
  return out;
}

/** Points for one answer: nothing unless it picked exactly the right options; faster earns more under a time limit. */
export function quizPoints(q: QuizQuestion, right: readonly string[] | undefined, given: { choices: string[]; ms?: number } | undefined): number {
  if (!given || !right?.length) return 0;
  const exact = given.choices.length === right.length && right.every((id) => given.choices.includes(id));
  if (!exact) return 0;
  if (!q.seconds) return ENGAGE_QUIZ_POINTS;
  const used = Math.min(1, Math.max(0, (given.ms ?? 0) / (q.seconds * 1000)));
  return Math.round(ENGAGE_QUIZ_POINTS / 2 + (ENGAGE_QUIZ_POINTS / 2) * (1 - used));
}

/** A person's score and how many they got right. */
export function quizScore(a: ActivityElement, key: Record<string, string[]>, answer: ActivityAnswer | null): { score: number; right: number } {
  let score = 0;
  let right = 0;
  for (const q of quizQuestions(a)) {
    const p = quizPoints(q, key[q.id], answer?.quiz?.[q.id]);
    score += p;
    if (p) right++;
  }
  return { score, right };
}

export interface StoredAnswer {
  value: ActivityAnswer;
  /** Set only for an answer given openly. */
  name: string | null;
}

export interface StoredQuestion {
  id: string;
  text: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: number;
  answered: boolean;
  hidden: boolean;
  voters: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * What the board shows for `activity`. `sealed`: only how many answered. Answers to choices that
 * no longer exist are ignored; names appear only on a poll that is not anonymous now AND only for
 * answers that were given openly.
 */
export function computeResults(
  activity: ActivityElement,
  answers: StoredAnswer[],
  questions: StoredQuestion[],
  sealed: boolean,
  now: number,
  key: Record<string, string[]> = {},
): ActivityResults {
  const ids = optionIds(activity);
  const shown = questions.filter((q) => !q.hidden);
  const respondents =
    activity.kind === 'qna' ? new Set(shown.flatMap((q) => [...(q.authorId ? [q.authorId] : []), ...q.voters])).size : answers.length;
  const out: ActivityResults = { activityId: activity.id, respondents, sealed, updatedAt: now };
  // A quiz runs in the open question by question; only its leaderboard waits for the reveal.
  if (activity.kind === 'quiz') {
    out.quiz = quizResults(activity, answers, key, sealed);
    return out;
  }
  if (sealed) return out;
  switch (activity.kind) {
    case 'poll': {
      const named = !activity.anonymous;
      out.poll = ids.map((optionId) => {
        const picked = answers.filter((a) => a.value.choices?.includes(optionId));
        const names = named ? picked.flatMap((a) => (a.name ? [a.name] : [])) : [];
        return { optionId, count: picked.length, ...(names.length ? { names } : {}) };
      });
      break;
    }
    case 'wordcloud': {
      const counts = new Map<string, number>();
      for (const a of answers) for (const w of a.value.words ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
      out.words = [...counts]
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
        .slice(0, ENGAGE_MAX_CLOUD_WORDS)
        .map(([word, count]) => ({ word, count }));
      break;
    }
    case 'ranking': {
      const n = ids.length;
      const valid = answers.filter((a) => a.value.order && a.value.order.length === n && a.value.order.every((id) => ids.includes(id)));
      out.ranking = ids
        .map((optionId) => {
          const places = valid.map((a) => a.value.order!.indexOf(optionId) + 1);
          const points = places.reduce((s, p) => s + (n - p + 1), 0);
          return { optionId, points, avgRank: places.length ? round1(places.reduce((s, p) => s + p, 0) / places.length) : 0 };
        })
        .sort((x, y) => y.points - x.points || x.avgRank - y.avgRank);
      break;
    }
    case 'rating': {
      const scale = scaleOf(activity);
      out.rating = ids.map((optionId) => {
        const given = answers.map((a) => a.value.ratings?.[optionId]).filter((r): r is number => typeof r === 'number' && r >= 1 && r <= scale);
        const dist = Array.from({ length: scale }, (_, i) => given.filter((r) => r === i + 1).length);
        return { optionId, avg: given.length ? round1(given.reduce((s, r) => s + r, 0) / given.length) : 0, count: given.length, dist };
      });
      break;
    }
    case 'matrix':
      out.matrix = ids.map((optionId) => {
        const placed = answers.map((a) => a.value.positions?.[optionId]).filter((p): p is { x: number; y: number } => !!p && unit(p.x) && unit(p.y));
        const n = placed.length;
        const mean = (f: (p: { x: number; y: number }) => number) => (n ? placed.reduce((s, p) => s + f(p), 0) / n : 0.5);
        const x = mean((p) => p.x);
        const y = mean((p) => p.y);
        const sd = (f: (p: { x: number; y: number }) => number, m: number) => (n ? Math.sqrt(placed.reduce((s, p) => s + (f(p) - m) ** 2, 0) / n) : 0);
        return { optionId, count: n, x: round3(x), y: round3(y), sx: round3(sd((p) => p.x, x)), sy: round3(sd((p) => p.y, y)) };
      });
      break;
    case 'qna':
      out.questions = shown
        .map((q) => ({ id: q.id, text: q.text, ...(q.authorName ? { by: q.authorName } : {}), votes: q.voters.length, answered: q.answered, at: q.createdAt }))
        .sort((x, y) => Number(x.answered) - Number(y.answered) || y.votes - x.votes || x.at - y.at);
      break;
  }
  return out;
}

const LEADERBOARD = 10;

function quizResults(a: ActivityElement, answers: StoredAnswer[], key: Record<string, string[]>, sealed: boolean): NonNullable<ActivityResults['quiz']> {
  const qs = quizQuestions(a);
  const q = a.quiz && a.quiz.step >= 0 ? qs[a.quiz.step] : undefined;
  const out: NonNullable<ActivityResults['quiz']> = {
    questionId: q?.id ?? null,
    answered: q ? answers.filter((x) => x.value.quiz?.[q.id]).length : 0,
  };
  if (q && a.quiz?.showAnswer) {
    out.correct = key[q.id] ?? [];
    out.counts = q.options.map((o) => ({ optionId: o.id, count: answers.filter((x) => x.value.quiz?.[q.id]?.choices.includes(o.id)).length }));
  }
  if (!sealed)
    out.leaderboard = answers
      .map((x) => ({ name: !a.anonymous && x.name ? x.name : 'Someone', ...quizScore(a, key, x.value) }))
      .sort((x, y) => y.score - x.score || y.right - x.right)
      .slice(0, LEADERBOARD);
  return out;
}
