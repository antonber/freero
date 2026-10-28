import { describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import { buildOutline, restackZ } from './lib/outline';
import { layoutRows, rowHeight, visibleRange } from './lib/rows';

const el = (id: string, z: number, extra: Record<string, unknown> = {}) =>
  ({ id, type: 'sticky', x: 0, y: 0, w: 10, h: 10, rotation: 0, z, ...extra }) as unknown as BoardElement;

/** Front-most first, after giving `id` its new z. */
const order = (items: BoardElement[], id: string, z: number) =>
  items
    .map((it) => (it.id === id ? { ...it, z } : it))
    .sort((a, b) => b.z - a.z)
    .map((it) => it.id);

describe('Layers panel restacking', () => {
  const items = [el('a', 9), el('b', 7), el('c', 4), el('d', 1)]; // front-most first

  it('drops an item exactly at the slot it was released on, without renumbering the others', () => {
    expect(order(items, 'd', restackZ(items, 'd', 1)!)).toEqual(['a', 'd', 'b', 'c']);
    expect(order(items, 'a', restackZ(items, 'a', 3)!)).toEqual(['b', 'c', 'a', 'd']);
    expect(order(items, 'b', restackZ(items, 'b', 0)!)).toEqual(['b', 'a', 'c', 'd']);
    expect(order(items, 'b', restackZ(items, 'b', 4)!)).toEqual(['a', 'c', 'd', 'b']);
    expect(restackZ(items, 'b', 2)).toBeNull(); // released where it already is
  });

  it('groups items under the frame they sit in, frames in presentation order, loose items last', () => {
    const f1 = el('f1', 0, { type: 'frame', index: 1, title: 'Two' });
    const f2 = el('f2', 0, { type: 'frame', index: 0, title: 'One' });
    const groups = buildOutline([f1, f2, el('x', 3, { frameId: 'f1' }), el('y', 5), el('z', 8, { frameId: 'f1' }), el('orphan', 2, { frameId: 'gone' })]);
    expect(groups.map((g) => [g.frame?.id ?? null, g.items.map((i) => i.id)])).toEqual([
      ['f2', []],
      ['f1', ['z', 'x']],
      [null, ['y', 'orphan']],
    ]);
  });
});

describe('Layers list windowing', () => {
  const frame = el('f', 0, { type: 'frame', index: 0, title: 'F' });
  const items = [
    frame,
    ...Array.from({ length: 60 }, (_, i) => el(`in${i}`, i, { frameId: 'f' })),
    ...Array.from({ length: 300 }, (_, i) => el(`out${i}`, i)),
  ];
  const groups = buildOutline(items);

  it('mounts every row the viewport shows (and only about that many) at any scroll position, groups open or folded', () => {
    for (const collapsed of [new Set<string>(), new Set(['f'])]) {
      const { rows, height } = layoutRows(groups, collapsed);
      for (let top = 0; top <= height; top += 13) {
        const [from, to] = visibleRange(rows, top, 400, 0);
        const shown = rows.filter((r) => r.top < top + 400 && r.top + rowHeight(r) > top);
        expect(shown.every((r) => rows.indexOf(r) >= from && rows.indexOf(r) < to)).toBe(true);
        expect(to - from).toBeLessThanOrEqual(shown.length);
      }
    }
  });
});
