// @vitest-environment jsdom
// The world layer mounts only what is near the view (#182): selecting everything on a large board
// and zooming in must not mount every selected item in full detail. The item being edited stays
// mounted wherever it is: its text editor holds the keyboard focus.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { createTestBoard, defineElement, defineFeature, type ElementDefinition, type FeatureBundle, type NewElement, type TestBoard } from '@engine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sticky = (): Omit<NewElement<'sticky'>, 'x' | 'y'> => ({ type: 'sticky', w: 200, h: 200, color: 'yellow', text: '', fontFamily: 'sans', fontSize: 'auto', textColor: '#17162B', align: 'center', vAlign: 'middle' });
const probe = defineElement({
  type: 'sticky',
  resize: 'free',
  textField: 'text',
  defaults: sticky,
  Component: () => <div />,
});
const bundle: FeatureBundle = {
  manifest: defineFeature({ name: 'probe', description: 'probe' }),
  elements: [probe] as unknown as ElementDefinition[],
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

it('selecting everything and zooming in mounts only the items near the view, and the item being edited stays mounted when the view leaves it', () => {
  const board = createTestBoard({ users: ['ann'], features: [bundle] });
  boards.push(board);
  const [ed] = board.editors();
  // A row of 40 stickies 10,000 units apart: at 100% only the first is anywhere near the view.
  const ids = Array.from({ length: 40 }, (_, i) => ed.create({ ...sticky(), x: i * 10_000, y: 0 }));
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(board.world(0)));
  const mounted = () => [...host.querySelectorAll('.fr-el[data-id]')].map((n) => n.getAttribute('data-id'));

  act(() => ed.select(ids));
  act(() => ed.setCamera({ x: -100, y: -100, zoom: 1 }));
  expect(mounted()).toEqual([ids[0]]);

  act(() => ed.startEditing(ids[0]));
  act(() => ed.setCamera({ x: 200_000, y: -100, zoom: 1 }));
  expect(mounted()).toEqual([ids[0], ids[20]]);
});
