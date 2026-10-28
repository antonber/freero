import { describe, expect, it } from 'vitest';
import type { BoardElement, StickyElement, Tag } from '@freero/shared';
import { createTestBoard, type FeatureBundle, type NewElement } from '@engine';
import commands from './commands';
import manifest from './feature';
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

describe('tagging by name (another feature, e.g. a CSV import)', () => {
  it('reuses a board tag whatever its case, creates a missing one once, and keeps the tags an item had', () => {
    const bundle: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: [], commands: commands as FeatureBundle['commands'] };
    const board = createTestBoard({ users: ['ann'], features: [bundle] });
    const [ed] = board.editors('tags');
    ed.collection<Tag>('tags').set('t1', { id: 't1', name: 'Urgent', color: '#E5484D' });
    const sticky = { type: 'sticky', y: 0, w: 200, h: 200, color: 'yellow', text: '', fontFamily: 'sans', fontSize: 'auto', textColor: '#000', align: 'center', vAlign: 'middle' } as const;
    const [a, b] = ed.createMany([{ ...sticky, x: 0, tags: ['t1'] } as NewElement<'sticky'>, { ...sticky, x: 240 }]);
    ed.runCommand('tags.applyNames', { items: [{ id: a, names: ['URGENT', 'Ops'] }, { id: b, names: ['ops '] }] });
    const tags = ed.collection<Tag>('tags').entries().map(([, t]) => t);
    expect(tags.map((t) => t.name).sort()).toEqual(['Ops', 'Urgent']);
    const ops = tags.find((t) => t.name === 'Ops')!.id;
    expect(ed.getElement<StickyElement>(a)!.tags).toEqual(['t1', ops]);
    expect(ed.getElement<StickyElement>(b)!.tags).toEqual([ops]);
    board.destroy();
  });
});
