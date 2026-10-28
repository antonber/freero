import { expect, it } from 'vitest';
import type { ActivityEntry } from '@freero/shared';
import { mergeFirstPage } from './lib/feed';

const entry = (id: string, at: number): ActivityEntry => ({ id, boardId: 'b', actor: null, actorName: 'Ann', kind: 'edit', text: 'added 1 shape', startedAt: at, at });

it('refreshing the newest page keeps the older pages already loaded, without listing an entry twice', () => {
  const loaded = [entry('c', 30), entry('b', 20), entry('a', 10)];
  const fresh = [entry('d', 40), entry('c', 30)];
  expect(mergeFirstPage(fresh, loaded).map((e) => e.id)).toEqual(['d', 'c', 'b', 'a']);
});
