// Pure helpers of live activities (KAI-132): what each kind is called, its starting content, and
// how results are drawn (shares, word sizes). The answers themselves are the server's.
import { richTextToPlain, type ActivityElement, type ActivityInfo, type ActivityKind, type ActivityOption, type ActivityResults, type QuizQuestion } from '@freero/shared';

export const ANSWER_DIALOG = 'engage.answer';
export const SETTINGS_DIALOG = 'engage.settings';
export const LINK_DIALOG = 'engage.link';
export const STAGE_DIALOG = 'engage.stage';
export const RESULTS = 'engageResults';
export const TOOL_ID = 'engage';

export const KINDS: ReadonlyArray<{ value: ActivityKind; label: string; hint: string }> = [
  { value: 'poll', label: 'Poll', hint: 'Pick one (or a few) of the choices' },
  { value: 'wordcloud', label: 'Word cloud', hint: 'Answer in a word or two' },
  { value: 'ranking', label: 'Ranking', hint: 'Put the items in order' },
  { value: 'rating', label: 'Rating scale', hint: 'Rate each statement' },
  { value: 'qna', label: 'Q&A', hint: 'Ask questions and upvote the ones you want answered' },
  { value: 'matrix', label: '2×2 matrix', hint: 'Place each item on two axes' },
  { value: 'quiz', label: 'Quiz', hint: 'Questions with right answers, scores and a leaderboard' },
];

/** A new activity's accent: one per kind, never red for a quiz (red reads as "wrong" there). */
export const kindAccent = (k: ActivityKind): string => (k === 'quiz' ? '#2E9BF0' : k === 'matrix' ? '#14B8A6' : ACCENTS[KINDS.findIndex((x) => x.value === k) % ACCENTS.length]);

export const kindLabel = (k: ActivityKind): string => KINDS.find((x) => x.value === k)?.label ?? 'Activity';

/** Kinds whose answers pick among the element's options. */
export const usesOptions = (k: ActivityKind): boolean => k === 'poll' || k === 'ranking' || k === 'rating' || k === 'matrix';

export const ACCENTS = ['#5B3FF0', '#2E9BF0', '#14B8A6', '#1FA463', '#F5A524', '#F97316', '#E5484D', '#E64DA6'];
export const ACTIVITY_W = 520;
export const ACTIVITY_H = 340;

const STARTERS: Record<ActivityKind, { question: string; options: string[] }> = {
  poll: { question: 'Which option do you prefer?', options: ['Option A', 'Option B', 'Option C'] },
  wordcloud: { question: 'One word for how this week went?', options: [] },
  ranking: { question: 'What should we do first?', options: ['First idea', 'Second idea', 'Third idea'] },
  rating: { question: 'How much do you agree?', options: ['We communicate well', 'Our goals are clear'] },
  qna: { question: 'Questions for the team', options: [] },
  matrix: { question: 'Where does each idea land?', options: ['First idea', 'Second idea', 'Third idea'] },
  quiz: { question: 'Team quiz', options: [] },
};

/** The question and options a new activity of this kind starts with, and what else the kind needs. */
export function starter(kind: ActivityKind, newId: () => string): { question: string; options: ActivityOption[]; extra: Partial<ActivityElement> } {
  const s = STARTERS[kind];
  const extra: Partial<ActivityElement> =
    kind === 'matrix'
      ? { axes: { x: ['Low effort', 'High effort'], y: ['Low impact', 'High impact'] } }
      : kind === 'quiz'
        ? { questions: [newQuizQuestion(newId, 1)], quiz: { step: -1, openedAt: 0, showAnswer: false }, results: 'reveal', anonymous: false }
        : {};
  return { question: s.question, options: s.options.map((text) => ({ id: newId(), text })), extra };
}

/** A fresh quiz question with two answers (#147). */
export function newQuizQuestion(newId: () => string, n: number): QuizQuestion {
  return { id: newId(), text: `Question ${n}`, options: [{ id: newId(), text: 'Answer A' }, { id: newId(), text: 'Answer B' }], seconds: 20 };
}

/** Whole-number percentages of `counts` that add up to 100 (largest remainder), all 0 for no answers. */
export function shares(counts: number[]): number[] {
  const total = counts.reduce((s, n) => s + n, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((n) => (n * 100) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, n) => s + n, 0);
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (counts[i] > 0) {
      out[i]++;
      left--;
    }
  }
  return out;
}

/** Font size of a word-cloud entry: the most frequent at `max`, the least at `min`, linear between. */
export function wordSize(count: number, least: number, most: number, min = 14, max = 44): number {
  if (most <= least) return Math.round((min + max) / 2);
  return Math.round(min + ((count - least) / (most - least)) * (max - min));
}

/** The option's text, or a placeholder for one removed since. */
export const optionText = (a: Pick<ActivityElement, 'options'>, id: string): string => a.options.find((o) => o.id === id)?.text || 'Removed choice';

/** "No answers yet" / "1 answer" / "12 answers" (Q&A counts people taking part). */
export function answersLabel(kind: ActivityKind, results: ActivityResults | undefined): string {
  const n = results?.respondents ?? 0;
  if (kind === 'qna') return n === 0 ? 'Nobody has asked yet' : n === 1 ? '1 person taking part' : `${n} people taking part`;
  return n === 0 ? 'No answers yet' : n === 1 ? '1 answer' : `${n} answers`;
}

/**
 * The URL people answer through (phones, a QR code on a slide): the board-free answer page
 * `/respond/<board>/<activity>` (#40). Without a server (the offline sandbox) the board's own
 * `?activity=` link, which opens the answer dialog over the board.
 */
export const answerLink = (boardId: string, activityId: string, onServer = true): string => {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '';
  if (!onServer) {
    u.searchParams.set('activity', activityId);
    return u.toString();
  }
  u.pathname = `/respond/${encodeURIComponent(boardId)}/${encodeURIComponent(activityId)}`;
  return u.toString();
};

/** What the answer form needs of an activity (the same the server sends the phone page). */
export const activityInfo = (a: ActivityElement): ActivityInfo => ({
  id: a.id,
  kind: a.kind,
  question: richTextToPlain(a.question).trim(),
  options: a.options,
  maxChoices: a.maxChoices,
  scale: a.scale,
  anonymous: a.anonymous,
  results: a.results,
  guests: a.guests,
  closed: a.closed,
  color: a.color,
  axes: a.axes,
  questions: a.questions,
  quiz: a.quiz,
});

/** The quiz question open now, or null (#147). */
export const currentQuestion = (a: Pick<ActivityElement, 'questions' | 'quiz'>): QuizQuestion | null =>
  a.quiz && a.quiz.step >= 0 ? (a.questions?.[a.quiz.step] ?? null) : null;

const csvCell = (v: string | number): string => {
  const s = String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};

/**
 * The results everyone sees on the board as CSV rows (#147): per choice, word, item or statement;
 * a matrix's average place and spread; a quiz's leaderboard. Nothing the board doesn't show.
 */
export function resultsCsv(a: ActivityElement, r: ActivityResults | undefined): string {
  const text = (id: string) => optionText(a, id);
  const rows: Array<Array<string | number>> = [];
  if (!r || (r.sealed && a.kind !== 'quiz')) rows.push(['Answers'], [r?.respondents ?? 0]);
  else
    switch (a.kind) {
      case 'poll':
        rows.push(['Choice', 'Answers'], ...a.options.map((o) => [o.text, r.poll?.find((p) => p.optionId === o.id)?.count ?? 0]));
        break;
      case 'wordcloud':
        rows.push(['Word', 'Count'], ...(r.words ?? []).map((w) => [w.word, w.count]));
        break;
      case 'ranking':
        rows.push(['Item', 'Points', 'Average place'], ...(r.ranking ?? []).map((x) => [text(x.optionId), x.points, x.avgRank]));
        break;
      case 'rating':
        rows.push(['Statement', 'Average', 'Ratings'], ...(r.rating ?? []).map((x) => [text(x.optionId), x.avg, x.count]));
        break;
      case 'qna':
        rows.push(['Question', 'Upvotes', 'Answered'], ...(r.questions ?? []).map((q) => [q.text, q.votes, q.answered ? 'yes' : 'no']));
        break;
      case 'matrix': {
        const ax = a.axes ?? { x: ['Low', 'High'], y: ['Low', 'High'] };
        rows.push(
          ['Item', `${ax.x[0]} → ${ax.x[1]} (0–1)`, `${ax.y[0]} → ${ax.y[1]} (0–1)`, 'Spread across', 'Spread up', 'Placed by'],
          ...(r.matrix ?? []).map((m) => [text(m.optionId), m.x, m.y, m.sx, m.sy, m.count]),
        );
        break;
      }
      case 'quiz':
        rows.push(['Place', 'Name', 'Score', 'Right answers'], ...(r.quiz?.leaderboard ?? []).map((x, i) => [i + 1, x.name, x.score, x.right]));
        break;
    }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
