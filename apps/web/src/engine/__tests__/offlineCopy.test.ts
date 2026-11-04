// The copy of a board kept on the device (#178): the store reads it before connecting, keeps it up
// to date, keeps hidden frames' contents only for someone who reads them, and lets go of it when the
// server ends access. No server here: the socket points nowhere, as on a train.
import { afterEach, expect, it } from 'vitest';
import type { BoardElement, BoardLayer } from '@freero/shared';
import type { OfflineCopy } from '../api';
import { BoardStore, type StorePersistence } from '../store/BoardStore';

const stores: BoardStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.destroy();
});

/** A device's storage: what the store saved last, and whether it was told to forget. */
interface Device {
  copy: OfflineCopy | null;
  forgotten: boolean;
  editor: boolean;
  persist: StorePersistence;
}
function device(editor = true): Device {
  const d: Device = {
    copy: null,
    forgotten: false,
    editor,
    persist: {
      load: async () => d.copy,
      save: async (copy: OfflineCopy) => void (d.copy = copy),
      forget: async () => {
        d.forgotten = true;
        d.copy = null;
      },
      keeps: (layer: BoardLayer) => layer === 'private' || d.editor,
    },
  };
  return d;
}
function open(d: Device): BoardStore {
  const s = new BoardStore({ boardId: 'b1', syncUrl: 'ws://127.0.0.1:9/ws/boards', persist: d.persist });
  stores.push(s);
  return s;
}
const opened = async (s: BoardStore) => {
  for (let i = 0; i < 50 && !(s as unknown as { persist: unknown }).persist; i++) await new Promise((r) => setTimeout(r, 5));
};
const note = (id: string, text: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 100, z: 1, text }) as unknown as BoardElement;

it('an edit made offline is still there after the page reloads without a network', async () => {
  const d = device();
  const first = open(d);
  await opened(first);
  first.transact(() => first.setElement(note('n1', 'written on the train')));
  first.destroy(); // closing the tab saves at once, without waiting for the timer

  const again = open(d);
  await opened(again);
  expect(again.restored).toBe(true);
  expect((again.getElement('n1') as unknown as { text: string }).text).toBe('written on the train');
});

it('hidden frames’ contents are neither kept nor read back on a device whose person no longer edits the board', async () => {
  const d = device(true);
  const s = open(d);
  await opened(s);
  s.transact(() => s.moveElement(note('h1', 'inside a hidden frame'), 'editors'));
  s.flushPersisted();
  expect(d.copy?.editors).toBeDefined();
  s.destroy();

  d.editor = false; // made a viewer: the copy the device still holds must not come back
  const later = open(d);
  await opened(later);
  expect(later.getElement('h1')).toBeUndefined();
  later.transact(() => later.setElement(note('n2', 'anything')));
  later.destroy();
  expect(d.copy?.editors).toBeUndefined();
});

it('when the server ends access for good the device copy is deleted, and nothing is saved again', async () => {
  const d = device();
  const s = open(d);
  await opened(s);
  s.transact(() => s.setElement(note('n1', 'soon gone')));
  s.flushPersisted();
  expect(d.copy).not.toBeNull();

  (s.provider as unknown as { emit(name: string, args: unknown[]): void }).emit('connection-close', [{ code: 4403, reason: 'no access' }]);
  await new Promise((r) => setTimeout(r, 0));
  expect(d.forgotten).toBe(true);
  s.transactSilently(() => s.setElement(note('n2', 'after the end')));
  s.destroy();
  expect(d.copy).toBeNull();
});
