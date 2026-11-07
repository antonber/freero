// Two instances holding one board: after one of them could not publish for a while (its Redis
// connection was down), both copies of the board converge once it is back — the instance that
// missed nothing still gets what the other made meanwhile. Two copies of this module (one per
// "instance") on an in-process message bus that can drop one instance's publishes; storage is
// stubbed (the database is not what is under test, and both instances share it anyway).
import { afterAll, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { BoardElement } from '@freero/shared';

interface Sub {
  instance: number;
  message(data: Uint8Array): void;
  resubscribed?(): void;
}
const bus = { subs: new Map<string, Set<Sub>>(), down: new Set<number>() };

/** platform/pubsub as instance number `instance` has it (one Redis, two connections). */
function pubsubOf(instance: number) {
  return {
    isShared: () => true,
    publish(channel: string, data: Uint8Array) {
      if (bus.down.has(instance)) return; // dropped, as while the connection is down
      const copy = data.slice();
      queueMicrotask(() => {
        for (const s of [...(bus.subs.get(channel) ?? [])]) s.message(copy);
      });
    },
    subscribe(channel: string, s: Omit<Sub, 'instance'>) {
      const sub = { ...s, instance };
      if (!bus.subs.has(channel)) bus.subs.set(channel, new Set());
      bus.subs.get(channel)!.add(sub);
      return { ready: Promise.resolve(true), close: () => bus.subs.get(channel)?.delete(sub) };
    },
    subscribedInstances: async (channel: string) => new Set([...(bus.subs.get(channel) ?? [])].map((s) => s.instance)).size,
  };
}
vi.mock('./docStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./docStore')>()),
  loadDoc: async () => ({ state: null, logRows: 0, logBytes: 0 }),
  appendUpdates: async (_id: string, updates: Uint8Array[]) => updates.reduce((n, u) => n + u.byteLength, 0),
  compactDoc: async () => 'skipped',
  snapshotIfDue: async () => ({ newestAt: Date.now() }),
  missingFromStore: async () => null,
}));
vi.mock('./layerStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./layerStore')>()),
  loadLayers: async () => [],
  appendLayerUpdates: async () => {},
  compactLayer: async () => {},
  missingLayerFromStore: async () => null,
}));
vi.mock('../boards/index', () => ({ touchBoard: async () => {}, getBoardAccess: async () => ({ role: 'owner', removed: false, kind: 'board', coOwner: false }) }));

/** App instance number `n`: its own copy of the realtime rooms (and config), on the shared bus. */
async function instance(n: number) {
  vi.resetModules();
  vi.doMock('../../platform/pubsub', () => pubsubOf(n));
  (await import('../../platform/config')).loadConfig({ NODE_ENV: 'test', FREERO_DATA_DIR: 'memory', FREERO_DOC_IDLE_MS: '600000' });
  return import('./rooms');
}
afterAll(() => vi.resetModules());

const owner = { userId: 'owner', role: 'owner' as const };
const sticky = (id: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, rotation: 0, text: id, color: 'yellow' }) as unknown as BoardElement;
const write = (rooms: Awaited<ReturnType<typeof instance>>, id: string) => rooms.changeBoard('b1', owner, () => ({ change: { create: [sticky(id)] } }));
/** The items an instance's loaded copy of the board holds right now (no catching up first). */
const itemsOn = (rooms: Awaited<ReturnType<typeof instance>>) => {
  const doc = new Y.Doc();
  for (const s of rooms.loadedDocStates()) Y.applyUpdate(doc, s);
  return [...doc.getMap('elements').keys()].sort();
};
const settle = () => new Promise((r) => setTimeout(r, 50));

it('an instance whose publishes were lost for a while still gets the other copy of the board in step once it is back', async () => {
  const a = await instance(0);
  const b = await instance(1);
  await write(a, 'a1');
  await write(b, 'b1'); // b opens the board: catches up with a, and a hears b's edit
  await settle();
  expect([itemsOn(a), itemsOn(b)]).toEqual([['a1', 'b1'], ['a1', 'b1']]);

  bus.down.add(0); // a can't publish: its edit reaches nobody
  await write(a, 'gap');
  await settle();
  expect(itemsOn(b)).toEqual(['a1', 'b1']);

  // a's connection is back: its subscriptions are told they may have missed something.
  bus.down.delete(0);
  for (const subs of bus.subs.values()) for (const s of subs) if (s.instance === 0) s.resubscribed?.();
  await settle();
  expect(itemsOn(b)).toEqual(['a1', 'b1', 'gap']);
});
