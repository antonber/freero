// @vitest-environment jsdom
// Frames in low detail (#185): zoomed far out a frame paints on the shared canvas — but only once
// its title (what you drag it by) is too small to show, never while hidden (viewers see a cover
// there), and never in an export (a picture of the board is drawn from its components).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { createTestBoard, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import element from './element';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no 2D canvas: which items go there is what matters here.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const bundle: FeatureBundle = { manifest, elements: [element], tools: [], formats: [], panels: [], commands: [] };
const boards: TestBoard[] = [];
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const b of boards.splice(0)) b.destroy();
  document.body.innerHTML = '';
});

function mount(node: Parameters<Root['render']>[0]): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

it('zoomed out, a frame paints on the canvas only once its title is too small to show, a hidden one never, and its export still draws it in full', () => {
  const board = createTestBoard({ users: ['ann'], features: [bundle] });
  boards.push(board);
  const [ed] = board.editors('frame');
  const frame = (x: number, title: string, hidden = false) => ed.create<'frame'>({ type: 'frame', x, y: 0, w: 1000, h: 600, title, fill: '#FFFFFF', index: 0, ...(hidden ? { hidden } : {}) });
  const plain = frame(0, 'Plan');
  const hidden = frame(2000, 'Budget', true);
  const world = mount(board.world(0));
  const drawnInFull = () => [...world.querySelectorAll('.fr-el[data-id]')].map((n) => n.getAttribute('data-id'));
  const painted = () => [...world.querySelectorAll('canvas')].reduce((n, c) => n + Number(c.getAttribute('data-items')), 0);

  // 0.12: in low detail, but a 1000-wide frame is 120 px on screen and its title shows.
  act(() => ed.setCamera({ x: -100, y: -100, zoom: 0.12 }));
  expect(drawnInFull()).toEqual([plain, hidden]);
  // 0.05: 50 px, no title any more: painted; the hidden one keeps its DOM.
  act(() => ed.setCamera({ x: -100, y: -100, zoom: 0.05 }));
  expect(drawnInFull()).toEqual([hidden]);
  expect(painted()).toBe(1);

  const exported = mount(board.exported(0, plain));
  expect(exported.querySelector('.fr-frame')).not.toBeNull();
});
