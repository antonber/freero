// @vitest-environment jsdom
// The Import dialog's Cancel (#193): an import still being read when the person cancels is never put
// on the board afterwards.
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import type { MiroImportResponse } from '@freero/shared';
import { createTestBoard, type Editor, type FeatureBundle, type PanelDefinition, type TestBoard } from '@engine';
import manifest from './feature';
import panel from './panel';
import { IMPORT_DIALOG } from './lib/insert';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let board: TestBoard | null = null;
let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  board?.destroy();
  board = null;
  document.body.innerHTML = '';
});

/** The dialog open on a fresh board, with `host` overriding parts of the editor's host. */
function openDialog(source: 'file' | 'miro', host: Record<string, unknown>): Editor {
  const bundle: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: [panel as PanelDefinition], commands: [] };
  board = createTestBoard({ users: ['ann'], features: [bundle] });
  const [ed] = board.editors('import');
  Object.assign(ed.host, host);
  ed.openPanel(IMPORT_DIALOG, { source });
  const el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(<StrictMode>{board!.panel(0, IMPORT_DIALOG, { source })}</StrictMode>));
  return ed;
}

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const cancel = () => {
  act(() => [...document.querySelectorAll('button')].find((b) => /cancel/i.test(b.textContent ?? ''))!.click());
  expect(board!.dialog(0)).toBeNull();
};

it('cancelling the import dialog while a Miro board is being read never puts that board on this one, and tells the read to stop', async () => {
  let answer!: (r: MiroImportResponse) => void;
  let signal: AbortSignal | undefined;
  const ed = openDialog('miro', {
    boardImport: {
      miro: (_b: string, _t: string, s?: AbortSignal) => ((signal = s), new Promise<MiroImportResponse>((r) => (answer = r))),
    },
  });
  const [link, token] = [...document.querySelectorAll<HTMLInputElement>('#fr-import-miro input')];
  act(() => {
    setValue(link, 'https://miro.com/app/board/uXjVabc123=/');
    setValue(token, 'miro-token-1234567890');
  });
  act(() => void document.getElementById('fr-import-miro')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

  // The read takes a while (up to two minutes); the person presses Cancel.
  cancel();
  expect(signal?.aborted).toBe(true); // the request is aborted: the server stops copying pictures

  // A host that answers anyway (the answer was already on its way).
  await act(async () => {
    answer({
      board: { name: 'Retro' },
      items: [{ id: 'a', type: 'shape', x: 0, y: 0, w: 240, h: 120, rotation: 0, parentId: null, content: '<p>Plan</p>', shape: 'rectangle' } as never],
      connectors: [],
      tags: [],
      truncated: false,
      imagesOverCap: 0,
    });
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(ed.getElements()).toEqual([]);
});

it('cancelling the import dialog while a file’s pictures are being stored never puts the file on the board', async () => {
  let stored!: (r: { url: string }) => void;
  const ed = openDialog('file', { uploadImage: () => new Promise<{ url: string }>((r) => (stored = r)) });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const scene = {
    type: 'excalidraw',
    elements: [
      { id: 'r', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, angle: 0 },
      { id: 'i', type: 'image', x: 200, y: 0, width: 100, height: 100, angle: 0, fileId: 'f1' },
    ],
    files: { f1: { dataURL: png } },
  };
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(scene)], 'sketch.excalidraw')] });
  act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
  // The scene is read and its picture is being uploaded when the person presses Cancel.
  await act(async () => {
    while (!stored) await new Promise((r) => setTimeout(r, 0));
  });
  cancel();

  await act(async () => {
    stored({ url: '/uploads/sketch.png' });
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(ed.getElements()).toEqual([]);
});
