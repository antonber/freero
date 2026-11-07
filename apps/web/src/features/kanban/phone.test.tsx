// @vitest-environment jsdom
// A kanban on a phone (view mode): it covers most of the screen, so pans and pinches start on it
// all the time. They must move the view, never select it or open focus mode; a tap opens it.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestBoard, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import elementDefs from './element';
import commands from './commands';
import panels from './panel';
import { newKanban } from './lib/actions';
import { FOCUS_PANEL } from './lib/constants';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bundle: FeatureBundle = { manifest, elements: elementDefs, tools: [], formats: [], panels, commands };

let board: TestBoard | null = null;
let root: Root | null = null;
beforeEach(() => {
  // A phone-sized window, and what jsdom lacks for the canvas.
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.setPointerCapture ??= () => undefined;
  // A 1000 × 800 screen (jsdom lays nothing out), so the kanban is on it and mounted.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}) });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  board?.destroy();
  board = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A phone showing a board with one kanban under the middle of the screen (screen = world here). */
function phone() {
  board = createTestBoard({ users: ['ann'], features: [bundle] });
  const [ed] = board.editors('kanban');
  const kid = ed.create(newKanban({ x: 400, y: 300 }));
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() => root!.render(board!.canvas(0)));
  const viewport = host.querySelector<HTMLElement>('.fr-viewport')!;
  const send = (type: string, id: number, x: number, y: number) =>
    act(() => {
      viewport.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    });
  return { ed, kid, send, b: board };
}

it('a one-finger pan that starts on a kanban on a phone moves the view without selecting the kanban or opening focus mode', () => {
  const { ed, kid, send, b } = phone();
  const before = ed.getElement(kid)!;
  send('pointerdown', 1, 400, 300);
  for (let i = 1; i <= 5; i++) send('pointermove', 1, 400 - i * 30, 300 - i * 20);
  send('pointerup', 1, 250, 200);
  expect(ed.getCamera()).toMatchObject({ x: 150, y: 100 });
  expect(ed.getElement(kid)).toMatchObject({ x: before.x, y: before.y });
  expect(ed.getSelection()).toEqual([]);
  expect(b.dialog(0)).toBeNull();
});

it('a pinch whose first finger lands on a kanban on a phone zooms without opening focus mode', () => {
  const { ed, send, b } = phone();
  send('pointerdown', 1, 400, 300);
  send('pointerdown', 2, 600, 300);
  for (let i = 1; i <= 5; i++) {
    send('pointermove', 1, 400 - i * 20, 300);
    send('pointermove', 2, 600 + i * 20, 300);
  }
  send('pointerup', 2, 700, 300);
  send('pointerup', 1, 300, 300);
  expect(ed.getCamera().zoom).toBeGreaterThan(1.5);
  expect(ed.getSelection()).toEqual([]);
  expect(b.dialog(0)).toBeNull();
});

it('a tap on a kanban on a phone selects it and opens focus mode', () => {
  const { ed, kid, send, b } = phone();
  send('pointerdown', 1, 400, 300);
  send('pointermove', 1, 403, 302);
  send('pointerup', 1, 403, 302);
  expect(ed.getSelection()).toEqual([kid]);
  expect(b.dialog(0)).toEqual({ id: FOCUS_PANEL, props: { id: kid } });
});

it('a long press on a kanban on a phone selects it for the menu without opening focus mode', () => {
  vi.useFakeTimers();
  const { ed, kid, send, b } = phone();
  send('pointerdown', 1, 400, 300);
  act(() => vi.advanceTimersByTime(600));
  send('pointerup', 1, 400, 300);
  expect(ed.getSelection()).toEqual([kid]);
  expect(b.dialog(0)).toBeNull();
});
