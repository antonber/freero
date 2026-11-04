// @vitest-environment jsdom
// Interface languages (#5): the language is the interface's, never the board's. A board drawn in
// another language — every element type the board feature set draws, in German and Arabic —
// writes nothing into the board and shows its content exactly as authored.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestBoard, type TestBoard } from '@engine';
import { installLocale } from '@ui';
import { loadCatalogs } from '../i18n/catalogs';
import { features } from './features';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let board: TestBoard | null = null;
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  board?.destroy();
  board = null;
  installLocale('en');
  document.body.innerHTML = '';
});

/** Draws every element as replica 0 does, each in its own container; returns their text. */
async function draw(b: TestBoard, ids: string[]): Promise<string[]> {
  const texts: string[] = [];
  for (const id of ids) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(b.element(0, id)));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    texts.push(host.textContent ?? '');
  }
  b.sync();
  return texts;
}

describe('switching the interface language', () => {
  it('writes nothing into the board and leaves what its items say as authored', async () => {
    board = createTestBoard({ users: ['ann', 'bob'], features });
    const [ann, bob] = board.editors();
    const ids = [
      ann.create({ type: 'sticky', x: 0, y: 0, w: 200, h: 200, text: '<p>Ship the beta</p>', color: 'yellow' } as never),
      ann.create({ type: 'frame', x: 300, y: 0, w: 400, h: 300, title: 'Sprint 12' } as never),
      ann.create({ type: 'card', x: 0, y: 400, w: 260, h: 90, title: 'Write the brief', description: '', color: '#5B3FF0', status: 'todo' } as never),
      ann.create({ type: 'shape', x: 300, y: 400, w: 160, h: 100, shape: 'rect', text: '<p>Decide</p>' } as never),
      ann.create({ type: 'text', x: 600, y: 400, w: 200, h: 40, text: '<p>Notes</p>' } as never),
    ];
    board.sync();
    const before = JSON.stringify({ elements: bob.getElements(), settings: bob.getSettings() });
    const english = await draw(board, ids);

    for (const locale of ['de', 'ar'] as const) {
      const catalogs = await loadCatalogs(locale);
      expect(Object.keys(catalogs)).toContain('features/frame'); // the language really is loaded
      installLocale(locale, catalogs);
      for (const r of roots.splice(0)) act(() => r.unmount());
      document.body.innerHTML = '';
      const shown = await draw(board, ids);
      expect(JSON.stringify({ elements: bob.getElements(), settings: bob.getSettings() })).toBe(before);
      for (const [i, text] of ['Ship the beta', 'Sprint 12', 'Write the brief', 'Decide', 'Notes'].entries()) {
        expect(english[i]).toContain(text);
        expect(shown[i]).toContain(text);
      }
    }
  });
});
