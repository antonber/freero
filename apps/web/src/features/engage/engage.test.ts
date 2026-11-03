import { expect, it } from 'vitest';
import type { ActivityElement, ActivityResults } from '@freero/shared';
import { resultsCsv } from './lib/activity';

const activity = (patch: Partial<ActivityElement>): ActivityElement =>
  ({ id: 'a1', type: 'activity', kind: 'wordcloud', question: 'Q', options: [], anonymous: true, results: 'live', guests: true, color: '#5B3FF0', ...patch }) as ActivityElement;

it('a participant’s word that a spreadsheet would run as a formula stays text in the results CSV', () => {
  const r: ActivityResults = { activityId: 'a1', respondents: 2, sealed: false, updatedAt: 0, words: [{ word: '=hyperlink("http://x","y")', count: 2 }] };
  const csv = resultsCsv(activity({}), r);
  expect(csv.split('\r\n')[1]).toBe(`"'=hyperlink(""http://x"",""y"")",2`);
});
