// Pure helpers of live activities (KAI-132): what each kind is called, its starting content, and
// how results are drawn (shares, word sizes). The answers themselves are the server's.
import type { ActivityElement, ActivityKind, ActivityOption, ActivityResults } from '@freero/shared';

export const ANSWER_DIALOG = 'engage.answer';
export const SETTINGS_DIALOG = 'engage.settings';
export const RESULTS = 'engageResults';
export const TOOL_ID = 'engage';

export const KINDS: ReadonlyArray<{ value: ActivityKind; label: string; hint: string }> = [
  { value: 'poll', label: 'Poll', hint: 'Pick one (or a few) of the choices' },
  { value: 'wordcloud', label: 'Word cloud', hint: 'Answer in a word or two' },
  { value: 'ranking', label: 'Ranking', hint: 'Put the items in order' },
  { value: 'rating', label: 'Rating scale', hint: 'Rate each statement' },
  { value: 'qna', label: 'Q&A', hint: 'Ask questions and upvote the ones you want answered' },
];

export const kindLabel = (k: ActivityKind): string => KINDS.find((x) => x.value === k)?.label ?? 'Activity';

/** Kinds whose answers pick among the element's options. */
export const usesOptions = (k: ActivityKind): boolean => k === 'poll' || k === 'ranking' || k === 'rating';

export const ACCENTS = ['#5B3FF0', '#2E9BF0', '#14B8A6', '#1FA463', '#F5A524', '#F97316', '#E5484D', '#E64DA6'];
export const ACTIVITY_W = 520;
export const ACTIVITY_H = 340;

const STARTERS: Record<ActivityKind, { question: string; options: string[] }> = {
  poll: { question: 'Which option do you prefer?', options: ['Option A', 'Option B', 'Option C'] },
  wordcloud: { question: 'One word for how this week went?', options: [] },
  ranking: { question: 'What should we do first?', options: ['First idea', 'Second idea', 'Third idea'] },
  rating: { question: 'How much do you agree?', options: ['We communicate well', 'Our goals are clear'] },
  qna: { question: 'Questions for the team', options: [] },
};

/** The question and options a new activity of this kind starts with. */
export function starter(kind: ActivityKind, newId: () => string): { question: string; options: ActivityOption[] } {
  const s = STARTERS[kind];
  return { question: s.question, options: s.options.map((text) => ({ id: newId(), text })) };
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

/** The URL that opens this activity's answer form (phones, a QR code on a slide). */
export const answerLink = (activityId: string): string => {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('activity', activityId);
  return u.toString();
};
