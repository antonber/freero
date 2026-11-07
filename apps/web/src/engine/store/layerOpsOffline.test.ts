// A reveal asked for offline (state-machine audit FAC-8): ending a sealed vote while not connected
// must never leave its ballots sealed under an ended vote. The store keeps the reveal with the
// device copy and sends it first on reconnecting — before its offline doc changes, which carry the
// vote's end. The server here is a stand-in for rooms.ts: it sends sync step 1 on join and answers
// the sync protocol, and notes what its doc said when the reveal arrived.
import { afterEach, expect, it, vi } from 'vitest';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WS_MESSAGE_LAYER_OP, type BoardLayer, type LayerOp } from '@freero/shared';
import type { OfflineCopy } from '../api';
import { BoardStore, type StorePersistence } from './BoardStore';

/** The board's server: its doc, and each reveal with whether the vote read as ended when it came. */
const server = { doc: new Y.Doc(), up: false, reveals: [] as Array<{ op: LayerOp; voteEndedBefore: boolean }> };
const voteEnded = (doc: Y.Doc) => (doc.getMap<{ active: boolean }>('voting').get('session')?.active ?? true) === false;

class FakeSocket {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    setTimeout(() => {
      if (this.readyState === 3) return; // closed before it opened (the page went away)
      if (!server.up) return this.close(1006);
      this.readyState = 1;
      // As rooms.ts join(): its sync step 1 is on its way as the socket opens, ahead of any answer.
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, 0);
      syncProtocol.writeSyncStep1(e, server.doc);
      this.deliver(encoding.toUint8Array(e));
      this.onopen?.();
    }, 0);
  }
  private deliver(bytes: Uint8Array) {
    setTimeout(() => this.readyState === 1 && this.onmessage?.({ data: bytes.slice().buffer }), 0);
  }
  send(data: Uint8Array) {
    const d = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(d);
    if (type === WS_MESSAGE_LAYER_OP) {
      server.reveals.push({ op: JSON.parse(decoding.readVarString(d)) as LayerOp, voteEndedBefore: voteEnded(server.doc) });
    } else if (type === 0) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, 0);
      syncProtocol.readSyncMessage(d, reply, server.doc, 'socket');
      if (encoding.length(reply) > 1) this.deliver(encoding.toUint8Array(reply));
    }
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.onclose?.({ code, reason: '' }), 0);
  }
}

const stores: BoardStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.destroy();
  vi.unstubAllGlobals();
});

const waitFor = async (cond: () => boolean, what: string) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
};

it('a sealed vote ended offline is revealed before the server reads it as ended, also when the tab was closed before reconnecting', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  const session = { id: 'v1', active: true, title: 'Lunch', votesPerUser: 2, anonymous: true, elementIds: null, startedBy: 'ann', startedAt: 1, endedAt: null };
  server.doc.getMap('voting').set('session', session);
  // The device kept the board while the vote ran (#178).
  const device: { copy: OfflineCopy | null } = { copy: { shared: Y.encodeStateAsUpdate(server.doc) } };
  const persist: StorePersistence = {
    load: async () => device.copy,
    save: async (copy) => void (device.copy = copy),
    forget: async () => void (device.copy = null),
    keeps: (_layer: BoardLayer) => true,
  };
  const open = () => {
    const s = new BoardStore({ boardId: 'b1', syncUrl: 'ws://freero.test/ws/boards', persist });
    stores.push(s);
    return s;
  };

  // Offline: the facilitator ends the vote — its ballots' reveal, then the end, as voting does.
  const offline = open();
  await waitFor(() => offline.restored, 'the device copy');
  offline.runLayerOp({ type: 'reveal', collection: 'voting', prefix: 'v1:' });
  offline.transact(() => offline.collectionMap('voting').set('session', { ...session, active: false, endedAt: 2 }));
  offline.destroy(); // the tab is closed before the network comes back

  server.up = true;
  open(); // opened again later, online
  await waitFor(() => voteEnded(server.doc), 'the end to reach the server');

  expect(server.reveals).toEqual([{ op: { type: 'reveal', collection: 'voting', prefix: 'v1:' }, voteEndedBefore: false }]);
});
