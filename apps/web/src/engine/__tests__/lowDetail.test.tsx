// @vitest-environment jsdom
// Low detail on the live canvas (#131, canvas/detail.ts, canvas/LowDetailLayer.tsx): zoomed out,
// items whose type paints itself cheaply go onto a shared canvas instead of their DOM — with
// hysteresis, so a zoom resting near the threshold never flickers — while exports and thumbnails,
// an item being edited and an item still big on screen draw in full, and render order is kept.
// The world layer's per-item state (selected) comes from one subscription that tells each item
// only about its own changes.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestBoard, defineElement, defineFeature, type ElementDefinition, type FeatureBundle, type NewElement, type TestBoard } from '@engine';
import { LOW_DETAIL_ZOOM } from '../canvas/detail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no 2D canvas: what is painted is a browser's business; which items go there is ours.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

/** How many times an item was drawn in full (its component rendered). */
let fullRenders = 0;
const sticky = (): Omit<NewElement<'sticky'>, 'x' | 'y'> => ({ type: 'sticky', w: 200, h: 200, color: 'yellow', text: '', fontFamily: 'sans', fontSize: 'auto', textColor: '#17162B', align: 'center', vAlign: 'middle' });
const probe = defineElement({
  type: 'sticky',
  resize: 'free',
  textField: 'text',
  defaults: sticky,
  Component: ({ element, selected }) => {
    fullRenders++;
    return <div className="full" data-id={element.id} data-selected={selected ? '' : undefined} />;
  },
  lowDetail: (_el, p) => p.box({ fill: '#FFF3A3' }),
});
// A type with no low-detail painting (a kanban, a table): always its own DOM.
const plain = defineElement({
  type: 'shape',
  resize: 'free',
  defaults: (): Omit<NewElement<'shape'>, 'x' | 'y'> => ({ type: 'shape', w: 100, h: 100, shape: 'rect', fill: '#fff', fillOpacity: 1, stroke: '#000', strokeWidth: 2, strokeStyle: 'solid', text: '', fontFamily: 'sans', fontSize: 16, textColor: '#000', align: 'center', vAlign: 'middle' }),
  Component: ({ element }) => <div className="full" data-id={element.id} />,
});
const bundle: FeatureBundle = {
  manifest: defineFeature({ name: 'probe', description: 'probe' }),
  elements: [probe, plain] as unknown as ElementDefinition[],
  tools: [],
  formats: [],
  panels: [],
  commands: [],
};

const boards: TestBoard[] = [];
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const b of boards.splice(0)) b.destroy();
  document.body.innerHTML = '';
});

function setup() {
  const board = createTestBoard({ users: ['ann'], features: [bundle] });
  boards.push(board);
  const [ed] = board.editors();
  return { board, ed };
}

function mount(el: Parameters<Root['render']>[0]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(el));
  return host;
}

/** What the world layer shows, in order: an item drawn in full (its id) or a low-detail canvas ('low ×n'). */
const drawn = (world: HTMLElement) =>
  [...world.children].map((n) => (n.matches('canvas.fr-lod-layer') ? `low ×${n.getAttribute('data-items')}` : n.querySelector('[data-id]')?.getAttribute('data-id')));

describe('low detail', () => {
  it('switches on below the threshold and back only above the higher one, so a zoom resting between them never flickers', async () => {
    const { board, ed } = setup();
    const id = ed.create({ ...sticky(), x: 0, y: 0 });
    const world = mount(board.world(0));
    // Leaving low detail mounts items over the next frames (#184): let them.
    const zoomTo = async (zoom: number) => {
      act(() => ed.setCamera({ x: -100, y: -100, zoom }));
      for (let i = 0; i < 3; i++) await act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    };
    const { enter, exit } = LOW_DETAIL_ZOOM;
    await zoomTo((enter + exit) / 2);
    expect(drawn(world)).toEqual([id]);
    await zoomTo(enter * 0.9);
    expect(drawn(world)).toEqual(['low ×1']);
    // Back up into the band (a trackpad settling, a glide ending): still low.
    await zoomTo(enter * 1.05);
    await zoomTo((enter + exit) / 2);
    expect(drawn(world)).toEqual(['low ×1']);
    await zoomTo(exit * 1.05);
    expect(drawn(world)).toEqual([id]);
    await zoomTo((enter + exit) / 2);
    expect(drawn(world)).toEqual([id]);
  });

  it('a jump far out (the fit on load) goes straight to the canvas: the items it brings into view are never mounted in full on the way (#183)', () => {
    const { board, ed } = setup();
    for (let i = 0; i < 30; i++) ed.create({ ...sticky(), x: i * 1000, y: 0 });
    act(() => ed.setCamera({ x: -100, y: -100, zoom: 1 }));
    const world = mount(board.world(0));
    const before = fullRenders;
    act(() => ed.setCamera({ x: -100, y: -100, zoom: 0.03 }));
    expect(drawn(world)).toEqual(['low ×30']);
    expect(fullRenders - before).toBe(0);
  });

  it('leaving low detail mounts the items a frame’s worth at a time, nearest the middle of the view first, until all are drawn in full (#184)', async () => {
    const { board, ed } = setup();
    // 400 stickies over 3,000 × 3,000: all in view at 0.25, out of low detail.
    const ids: string[] = [];
    for (let row = 0; row < 20; row++) for (let col = 0; col < 20; col++) ids.push(ed.create({ ...sticky(), w: 100, h: 100, x: col * 150, y: row * 150 }));
    act(() => ed.setCamera({ x: -500, y: -500, zoom: 0.08 }));
    const world = mount(board.world(0));
    expect(drawn(world)).toEqual(['low ×400']);
    const mid = { x: -500 + 1000 / 0.25 / 2, y: -500 + 800 / 0.25 / 2 };
    act(() => ed.setCamera({ x: -500, y: -500, zoom: 0.25 }));
    const full = () => new Set([...world.querySelectorAll('.full')].map((n) => n.getAttribute('data-id')!));
    const far = (id: string) => {
      const el = ed.getElement(id)!;
      return Math.hypot(el.x + el.w / 2 - mid.x, el.y + el.h / 2 - mid.y);
    };
    // The frame that leaves low detail mounts none of them: the canvas still paints them all.
    expect(full().size).toBe(0);
    const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    await frame();
    const first = full();
    expect(first.size).toBeGreaterThan(0);
    expect(first.size).toBeLessThan(400);
    // Nearest the middle first (not in render order, which would start at the top left).
    const median = ids.map(far).sort((a, b) => a - b)[ids.length / 2];
    expect([...first].every((id) => far(id) < median)).toBe(true);
    for (let i = 0; i < 200 && full().size < 400; i++) await frame();
    expect(full().size).toBe(400);
    expect(world.querySelector('canvas')).toBeNull();
  });

  it('keeps render order around items drawn in full, and never reaches exports and thumbnails, an item being edited, or one still big on screen', () => {
    const { board, ed } = setup();
    const a = ed.create({ ...sticky(), x: 0, y: 0 });
    const b = ed.create({ ...sticky(), x: 300, y: 0 });
    const table = ed.create({ ...plain.defaults(), x: 600, y: 0 });
    ed.create({ ...sticky(), x: 900, y: 0 });
    const huge = ed.create({ ...sticky(), x: 1200, y: 0, w: 8000, h: 8000 });
    const world = mount(board.world(0));
    const exported = mount(board.exported(0, a));
    act(() => ed.setCamera({ x: -100, y: -100, zoom: 0.03 }));
    expect(drawn(world)).toEqual(['low ×2', table, 'low ×1', huge]);
    expect(exported.querySelector('.full')).not.toBeNull();
    act(() => ed.startEditing(b));
    expect(drawn(world)).toEqual(['low ×1', b, table, 'low ×1', huge]);
  });

  it('marks each item selected and unselected as the selection changes', () => {
    const { board, ed } = setup();
    const ids = [0, 1, 2].map((i) => ed.create({ ...sticky(), x: i * 300, y: 0 }));
    const views = ids.map((id) => mount(board.element(0, id)));
    const selected = () => views.map((v) => !!v.querySelector('[data-selected]'));
    act(() => ed.select(ids));
    expect(selected()).toEqual([true, true, true]);
    act(() => ed.select([ids[1]]));
    expect(selected()).toEqual([false, true, false]);
    act(() => ed.select([]));
    expect(selected()).toEqual([false, false, false]);
  });
});
