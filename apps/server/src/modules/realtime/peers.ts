// Messages between app instances (through platform/pubsub.ts), see "Across instances" in rooms.ts.
//
// Board channel (one per board, joined by every instance that has the board loaded):
//   update        a Yjs update made through one of the sender's sockets (already role-checked)
//   awareness     presence of the sender's sockets (already sanitized)
//   sync-request  "I just opened this board (or reconnected): send me what my state vector lacks"
//   sync-reply    the answer, addressed to one instance: missing updates + its sockets' presence
//   layer-update  a Yjs update of one of the board's LAYER docs (layers.ts), made through one of the
//                 sender's sockets or by the sender itself (a reveal); receivers re-check access
//                 per socket before relaying it. sync-request / sync-reply carry the layers too
//                 (appended after the shared-doc fields, so older instances still read the rest).
// Control channel (all instances): access changed, board deleted, session ended.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { newId } from '../../platform/ids';

/** This process, as seen by the other instances (messages it sent come back to it; ignore those). */
export const INSTANCE_ID = newId(16);

export const boardChannel = (boardId: string) => `freero:rt:board:${boardId}`;
export const CONTROL_CHANNEL = 'freero:rt:control';

/** Per layer (storage name, see layers.ts): a state vector in a request, an update in a reply. */
export type LayerParts = Array<{ layer: string; data: Uint8Array }>;

export type PeerMessage =
  | { type: 'update'; update: Uint8Array }
  | { type: 'awareness'; update: Uint8Array }
  | { type: 'sync-request'; stateVector: Uint8Array; layers?: LayerParts }
  | { type: 'sync-reply'; to: string; update: Uint8Array; awareness: Uint8Array | null; layers?: LayerParts }
  | { type: 'layer-update'; layer: string; update: Uint8Array };

export type ControlMessage = { type: 'refresh-access' | 'close-board'; boardId: string } | { type: 'end-session'; sessionKey: string };

// New types are only ever appended (instances of two versions run side by side during a deploy).
const PEER_TYPES = ['update', 'awareness', 'sync-request', 'sync-reply', 'layer-update'] as const;

function writeLayers(e: encoding.Encoder, layers: LayerParts | undefined): void {
  encoding.writeVarUint(e, layers?.length ?? 0);
  for (const l of layers ?? []) {
    encoding.writeVarString(e, l.layer);
    encoding.writeVarUint8Array(e, l.data);
  }
}

function readLayers(d: decoding.Decoder): LayerParts {
  if (!decoding.hasContent(d)) return []; // from an instance that predates layers
  const out: LayerParts = [];
  for (let n = decoding.readVarUint(d); n > 0; n--) out.push({ layer: decoding.readVarString(d), data: decoding.readVarUint8Array(d) });
  return out;
}
const CONTROL_TYPES = ['refresh-access', 'close-board', 'end-session'] as const;

export function encodePeer(m: PeerMessage): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarString(e, INSTANCE_ID);
  encoding.writeVarUint(e, PEER_TYPES.indexOf(m.type));
  switch (m.type) {
    case 'update':
    case 'awareness':
      encoding.writeVarUint8Array(e, m.update);
      break;
    case 'sync-request':
      encoding.writeVarUint8Array(e, m.stateVector);
      writeLayers(e, m.layers);
      break;
    case 'sync-reply':
      encoding.writeVarString(e, m.to);
      encoding.writeVarUint8Array(e, m.update);
      encoding.writeVarUint8Array(e, m.awareness ?? new Uint8Array());
      writeLayers(e, m.layers);
      break;
    case 'layer-update':
      encoding.writeVarString(e, m.layer);
      encoding.writeVarUint8Array(e, m.update);
      break;
  }
  return encoding.toUint8Array(e);
}

/** The message and its sender; throws on a malformed message. */
export function decodePeer(data: Uint8Array): { from: string; msg: PeerMessage } {
  const d = decoding.createDecoder(data);
  const from = decoding.readVarString(d);
  const type = PEER_TYPES[decoding.readVarUint(d)];
  switch (type) {
    case 'update':
    case 'awareness':
      return { from, msg: { type, update: decoding.readVarUint8Array(d) } };
    case 'sync-request': {
      const stateVector = decoding.readVarUint8Array(d);
      return { from, msg: { type, stateVector, layers: readLayers(d) } };
    }
    case 'sync-reply': {
      const to = decoding.readVarString(d);
      const update = decoding.readVarUint8Array(d);
      const awareness = decoding.readVarUint8Array(d);
      return { from, msg: { type, to, update, awareness: awareness.byteLength ? awareness : null, layers: readLayers(d) } };
    }
    case 'layer-update': {
      const layer = decoding.readVarString(d);
      return { from, msg: { type, layer, update: decoding.readVarUint8Array(d) } };
    }
    default:
      throw new Error('unknown peer message type');
  }
}

export function encodeControl(m: ControlMessage): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarString(e, INSTANCE_ID);
  encoding.writeVarUint(e, CONTROL_TYPES.indexOf(m.type));
  encoding.writeVarString(e, m.type === 'end-session' ? m.sessionKey : m.boardId);
  return encoding.toUint8Array(e);
}

export function decodeControl(data: Uint8Array): { from: string; msg: ControlMessage } {
  const d = decoding.createDecoder(data);
  const from = decoding.readVarString(d);
  const type = CONTROL_TYPES[decoding.readVarUint(d)];
  const key = decoding.readVarString(d);
  if (type === 'end-session') return { from, msg: { type, sessionKey: key } };
  if (type === 'refresh-access' || type === 'close-board') return { from, msg: { type, boardId: key } };
  throw new Error('unknown control message type');
}
