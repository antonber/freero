import { describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import { createTestBoard, type ElementDefinition, type FeatureBundle } from '@engine';
import { similarIds } from './lib/similar';
import manifest from './feature';
import commands from './commands';

describe('select only', () => {
  it('offers a newly added item type under the name its own feature gives it, with no table to update', () => {
    const def = (type: string, extra: Partial<ElementDefinition> = {}) =>
      ({ type, Component: () => null, defaults: () => ({ type, w: 10, h: 10 }), resize: 'free', ...extra }) as unknown as ElementDefinition;
    const items: FeatureBundle = {
      manifest: { name: 'items', description: 'test items' },
      elements: [def('sticky', { label: { one: 'Sticky note', many: 'Sticky notes' } }), def('kanban', { label: { one: 'Lane board', many: 'Lane boards' } })],
      tools: [], formats: [], panels: [], commands: [],
    };
    const selectSimilar: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: [], commands: [], commandFactories: [commands as never] };
    const board = createTestBoard({ users: ['ann'], features: [items, selectSimilar] });
    try {
      const [ed] = board.editors('select-similar');
      const ids = [ed.create({ type: 'sticky', x: 0, y: 0 } as never), ed.create({ type: 'kanban', x: 50, y: 0 } as never), ed.create({ type: 'kanban', x: 99, y: 0 } as never)];
      ed.select(ids);
      const only = ed.listActions().find((a) => a.id === 'select-similar.only.kanban');
      expect(only).toMatchObject({ label: 'Select only lane boards', detail: '2', disabledReason: null });
      ed.runCommand('select-similar.only.kanban');
      expect(ed.getSelection()).toEqual(ids.slice(1));
    } finally {
      board.destroy();
    }
  });
});

const el = (id: string, type: string, extra: Record<string, unknown>) => ({ id, type, ...extra }) as unknown as BoardElement;

describe('select all like this', () => {
  const board = [
    el('s1', 'sticky', { color: 'yellow', tags: ['t1'] }),
    el('s2', 'sticky', { color: 'yellow' }),
    el('s3', 'sticky', { color: 'blue', tags: ['t2'] }),
    el('r1', 'shape', { fill: '#FFF3A3', stroke: '#000' }), // the sticky yellow, but a shape
    el('r2', 'shape', { fill: 'transparent', stroke: '#fff3a3' }),
    el('c1', 'card', { color: '#5b3ff0', tags: ['t1', 't2'] }),
  ];

  it('same colour means the same colour on the same kind of item (a yellow note is not yellow ink)', () => {
    expect(similarIds(board, [board[0]], 'colour')).toEqual(['s1', 's2']);
    // A shape is compared by its fill, or its outline when unfilled; case doesn't matter.
    expect(similarIds(board, [board[3]], 'colour')).toEqual(['r1', 'r2']);
  });

  it('same tag matches any tag of any selected item, across stickies and cards', () => {
    expect(similarIds(board, [board[0], board[2]], 'tag')).toEqual(['s1', 's3', 'c1']);
  });
});
