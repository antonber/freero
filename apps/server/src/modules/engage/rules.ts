// Pure rules of live activities (KAI-132): what a valid answer is for an activity, and the results
// the board shows. No answer leaves the server except as these results — counts, words, averages —
// plus, for answers given openly (not anonymous) to a poll, the names that picked each choice.
import {
  ENGAGE_MAX_CLOUD_WORDS,
  ENGAGE_MAX_OPTIONS,
  ENGAGE_MAX_WORD_LENGTH,
  ENGAGE_MAX_WORDS,
  type ActivityAnswer,
  type ActivityElement,
  type ActivityResults,
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
    default:
      throw new AnswerError('Ask a question or upvote one instead');
  }
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
): ActivityResults {
  const ids = optionIds(activity);
  const shown = questions.filter((q) => !q.hidden);
  const respondents =
    activity.kind === 'qna' ? new Set(shown.flatMap((q) => [...(q.authorId ? [q.authorId] : []), ...q.voters])).size : answers.length;
  const out: ActivityResults = { activityId: activity.id, respondents, sealed, updatedAt: now };
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
    case 'qna':
      out.questions = shown
        .map((q) => ({ id: q.id, text: q.text, ...(q.authorName ? { by: q.authorName } : {}), votes: q.voters.length, answered: q.answered, at: q.createdAt }))
        .sort((x, y) => Number(x.answered) - Number(y.answered) || y.votes - x.votes || x.at - y.at);
      break;
  }
  return out;
}
