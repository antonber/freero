// What a board picture draws and how its work is cut up (engine/editor/paintPlan.ts). The
// rasterizing itself needs a real browser (layout, canvas); its timings are in
// docs/design/kanban-fields-and-views.md, "Performance (as measured)".
import { describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import { CHUNK_NODES, MAX_DETAILED, chunkByCost, planThumbnail } from '../editor/paintPlan';

const box = (id: string, type: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) =>
  ({ id, type, x, y, w, h, rotation: 0, z: 0, ...extra }) as unknown as BoardElement;

describe('board thumbnails', () => {
  it('a 2,000-card kanban rasterizes a bounded number of items in full, drawing the cards as boxes between their kanban and what lies on top', () => {
    // A tracker import: one tall kanban, its cards in four columns (render order: kanban first).
    const kanban = box('k', 'kanban', 0, 0, 1200, 50_000);
    const cards = Array.from({ length: 2000 }, (_, i) => box(`c${i}`, 'card', 20 + (i % 4) * 290, 60 + Math.floor(i / 4) * 98, 260, 90, { color: '#2E9BF0' }));
    const line = box('l', 'connector', 20, 60, 260, 98);
    // A big note someone laid over the board, above the cards.
    const note = box('n', 'sticky', 100, 100, 4000, 4000);
    const scale = 640 / 80_000; // the 16:10 thumbnail around it

    const steps = planThumbnail([kanban, ...cards, line, note], scale, (el) => (el.type === 'connector' ? null : '#e3e2ec'));

    const inFull = steps.flatMap((s) => (s.kind === 'dom' ? s.items : []));
    const boxes = steps.flatMap((s) => (s.kind === 'boxes' ? s.items.map((b) => b.el) : []));
    // Rasterizing every card in full froze the page for half a minute after each edit.
    expect(inFull.length).toBeLessThanOrEqual(MAX_DETAILED);
    expect(inFull).toContain(kanban);
    expect(boxes).toHaveLength(2000);
    // Order is kept: card boxes are painted over the kanban they stand in, and under the note.
    expect(steps.map((s) => s.kind)).toEqual(['dom', 'boxes', 'dom']);
    expect(steps[0].items).toEqual([kanban]);
    expect(steps[2].items).toEqual([note]);
    // A line a few pixels long is thinner than a pixel: left out, not a solid box.
    expect(boxes).not.toContain(line);
  });

  it('on a board too dense for detail everywhere, the biggest items keep it and the rest become boxes', () => {
    // 400 stickies big enough on the picture to show detail, and one frame around them.
    const frame = box('f', 'frame', 0, 0, 4000, 2500);
    const stickies = Array.from({ length: 400 }, (_, i) => box(`s${i}`, 'sticky', 10 + (i % 25) * 160, 10 + Math.floor(i / 25) * 155, 150, 150));
    const steps = planThumbnail([frame, ...stickies], 0.12, () => '#fff9b1');

    const inFull = steps.flatMap((s) => (s.kind === 'dom' ? s.items : []));
    expect(inFull).toHaveLength(MAX_DETAILED);
    expect(inFull).toContain(frame);
  });
});

describe('board pictures render in bounded steps', () => {
  it('an export of thousands of items is cut into tasks of bounded work, and a highlighter stroke is composited alone so it still multiplies', () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({ id: i, nodes: 25, blend: i === 700 }));
    const chunks = chunkByCost(items, (it) => it.nodes, CHUNK_NODES, (it) => it.blend);

    expect(chunks.flat()).toEqual(items); // every item once, in render order
    for (const c of chunks) expect(c.reduce((s, it) => s + it.nodes, 0)).toBeLessThanOrEqual(CHUNK_NODES);
    expect(chunks.find((c) => c.some((it) => it.blend))).toEqual([items[700]]);
  });
});
