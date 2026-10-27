import { describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import { stripPatches, togglePatches, type Taggable } from './lib/tags';

const el = (id: string, type: 'sticky' | 'card' | 'shape', tags?: string[]) => ({ id, type, tags }) as unknown as BoardElement;

describe('toggling a tag on a selection', () => {
  it('completes a mixed selection instead of stripping the tag from the ones that had it', () => {
    const sel = [el('a', 'sticky', ['t1']), el('b', 'card', []), el('c', 'sticky')] as Taggable[];
    expect(togglePatches(sel, 't1')).toEqual([
      { id: 'b', patch: { tags: ['t1'] } },
      { id: 'c', patch: { tags: ['t1'] } },
    ]);
    const all = [el('a', 'sticky', ['t1', 't2']), el('b', 'card', ['t1'])] as Taggable[];
    expect(togglePatches(all, 't1')).toEqual([
      { id: 'a', patch: { tags: ['t2'] } },
      { id: 'b', patch: { tags: [] } },
    ]);
  });
});

describe('deleting a tag', () => {
  it('removes its id from every tagged sticky and card, leaving other tags and elements alone', () => {
    const board = [el('a', 'sticky', ['t1', 't2']), el('b', 'card', ['t1']), el('c', 'sticky', ['t2']), el('d', 'shape')];
    expect(stripPatches(board, 't1')).toEqual([
      { id: 'a', patch: { tags: ['t2'] } },
      { id: 'b', patch: { tags: [] } },
    ]);
  });
});
