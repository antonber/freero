// @vitest-environment jsdom
// Dark mode changes how the live canvas is painted, never what people authored (canvas/theme.ts):
// an item's ink follows what is shown behind it (canvas/backdrop.ts), exports keep the authored colours.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestBoard, defineElement, defineFeature, useCanvasInk, type ElementDefinition, type FeatureBundle, type NewElement, type TestBoard } from '@engine';
import { canvasInk, contrast, darkFiltered, isLightSurface, shownBackground, SURFACE_INVERT } from '../canvas/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stand-ins for the real types, with what the engine relies on: a frame whose light fill a dark
// page shows dark, a filled box shown as authored, and free text drawn in its canvas ink.
const frame = defineElement({
  type: 'frame',
  resize: 'free',
  defaults: (): Omit<NewElement<'frame'>, 'x' | 'y'> => ({ type: 'frame', w: 1000, h: 800, title: 'Plan', fill: '#F6EEE3', index: 0, preset: 'custom' }),
  Component: () => <div />,
  surface: (el) => ({ color: el.fill || '#FFFFFF', darkens: true }),
});
const box = defineElement({
  type: 'shape',
  resize: 'free',
  defaults: (): Omit<NewElement<'shape'>, 'x' | 'y'> => ({ type: 'shape', w: 300, h: 400, shape: 'rect', fill: '#FFFFFF', fillOpacity: 1, stroke: '#E3DED6', strokeWidth: 1, strokeStyle: 'solid', text: '', fontFamily: 'sans', fontSize: 16, textColor: '#000000', align: 'center', vAlign: 'middle' }),
  Component: () => <div />,
  surface: (el) => (el.fill !== 'transparent' ? { color: el.fill } : null),
});
const text = defineElement({
  type: 'text',
  resize: 'scale',
  defaults: (): Omit<NewElement<'text'>, 'x' | 'y'> => ({ type: 'text', w: 200, h: 30, text: 'Hello', fontFamily: 'sans', fontSize: 18, textColor: '#000000', align: 'left', background: 'transparent', autoWidth: false }),
  Component: function Ink({ element }) {
    const ink = useCanvasInk();
    return <span data-ink={element.id} style={{ color: ink(element.textColor) }} />;
  },
});
const bundle: FeatureBundle = {
  manifest: defineFeature({ name: 'probe', description: 'probe' }),
  elements: [frame, box, text] as unknown as ElementDefinition[],
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
  document.documentElement.removeAttribute('data-theme');
});

function setup(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  const board = createTestBoard({ users: ['ann'], features: [bundle] });
  boards.push(board);
  const [ed] = board.editors();
  act(() => ed.setCamera({ x: -50, y: -50, zoom: 1 }));
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

/** The ink item `id` is painted in (its inline `color`, as the browser receives it). */
/** A text item at (x, y) in `textColor`. */
const textAt = (ed: ReturnType<TestBoard['editors']>[number], x: number, y: number, textColor: string, frameId: string) =>
  ed.create({ ...text.defaults!(), x, y, textColor, frameId } as NewElement<'text'>);
const inkOf = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-ink="${id}"]`)!.style.getPropertyValue('color');
const LIGHT_INK = 'var(--fr-canvas-ink, #000000)';

describe('dark canvas', () => {
  it('repaints only the default inks (through a variable that exports leave unset), never a colour someone picked', () => {
    expect(canvasInk('#17162B')).toBe('var(--fr-canvas-ink, #17162B)');
    for (const picked of ['#E5484D', '#FFF3A3', '#FFFFFF', '#5B3FF0']) expect(canvasInk(picked)).toBe(picked);
  });

  it('turns a light board background dark, keeps one the author made dark, and leaves light mode alone', () => {
    const light = shownBackground('#F3F2F8', 'dark');
    expect(isLightSurface(light)).toBe(false);
    expect(shownBackground('#17162B', 'dark')).toBe('#17162B');
    expect(shownBackground('#F3F2F8', 'light')).toBe('#F3F2F8');
  });

  it('default-ink text over a white shape stays dark in dark mode, and turns light once moved off it onto the frame', async () => {
    const { board, ed } = setup('dark');
    const f = ed.create({ ...frame.defaults!(), x: 0, y: 0 });
    ed.create({ ...box.defaults!(), x: 40, y: 160, frameId: f });
    const t = ed.create({ ...text.defaults!(), x: 56, y: 180, frameId: f });
    const world = mount(board.world(0));
    // Black on white, as the author saw it: not the light canvas ink (#ecebf5 on white).
    expect(inkOf(world, t)).toBe('rgb(0, 0, 0)');
    await act(async () => ed.update(t, { x: 56, y: 650 }));
    expect(inkOf(world, t)).toBe(LIGHT_INK);
  });

  it('a dark-brown heading on a light frame shown dark is drawn light, while a label that already reads stays as authored', () => {
    const { board, ed } = setup('dark');
    const f = ed.create({ ...frame.defaults!(), x: 0, y: 0 });
    const heading = textAt(ed, 40, 30, '#5C3A1E', f);
    const label = textAt(ed, 40, 100, '#9AAA3A', f);
    const world = mount(board.world(0));
    const toHex = (rgb: string) => `#${rgb.match(/\d+/g)!.map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
    const frameShown = darkFiltered('#F6EEE3', SURFACE_INVERT); // the frame as the page shows it
    const brown = toHex(inkOf(world, heading));
    expect(brown).not.toBe('#5c3a1e');
    expect(contrast(brown, frameShown)).toBeGreaterThan(3);
    // Still a brown, not a grey: the filter keeps its hue (red over green over blue).
    const [r, g, b] = brown.slice(1).match(/../g)!.map((h) => parseInt(h, 16));
    expect(r > g && g > b).toBe(true);
    expect(inkOf(world, label)).toBe('rgb(154, 170, 58)');
  });

  it('exports and light mode keep every authored ink, wherever the item lies', () => {
    const dark = setup('dark');
    const f = dark.ed.create({ ...frame.defaults!(), x: 0, y: 0 });
    const heading = textAt(dark.ed, 40, 30, '#5C3A1E', f);
    const exported = mount(dark.board.exported(0, heading));
    expect(inkOf(exported, heading)).toBe('rgb(92, 58, 30)');

    document.documentElement.setAttribute('data-theme', 'light');
    const world = mount(dark.board.world(0));
    expect(inkOf(world, heading)).toBe('rgb(92, 58, 30)');
  });
});
