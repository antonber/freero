// Board layers: server-held Y.Docs next to a board's shared doc that only some connections may
// sync (see "Board layers" in ARCHITECTURE.md and WS_MESSAGE_LAYER in @freero/shared).
//
// Why separate docs and not a filter on the shared doc: a Y.Doc replicates as a whole. Every
// client's updates form one gap-free sequence per client id, so withholding some structs of the
// shared doc from one connection leaves that connection unable to apply anything that client
// writes later. Content another connection must not read therefore never enters the shared doc
// until it is revealed; it lives in a layer doc that is simply never sent to that connection.
//
//   storage name   wire name   who may read                  who may write
//   'u:<userId>'   'private'   that user's sockets           …while their role is owner/editor
//   'editors'      'editors'   owner/editor sockets          owner/editor sockets
//
// Revealing moves entries from the private layers into the shared doc on the server (an owner or
// editor asks with a LayerOp), so it works while their authors are offline.
import * as Y from 'yjs';
import type { BoardLayer, LayerOp, Role } from '@freero/shared';

export const EDITORS_LAYER = 'editors';
export const privateLayerOf = (userId: string) => `u:${userId}`;
export const isPrivateLayer = (name: string) => name.startsWith('u:');

export interface LayerReader {
  userId: string;
  role: Role;
}

const canEdit = (role: Role) => role === 'owner' || role === 'editor';

/** Storage name of the layer a socket asks for by wire name, or null when it may not read it. */
export function readableLayer(wire: string, who: LayerReader): string | null {
  if (wire === 'private') return privateLayerOf(who.userId);
  if (wire === 'editors' && canEdit(who.role)) return EDITORS_LAYER;
  return null;
}

/** Wire name under which `who` receives layer `name`, or null when it may not read it. */
export function wireNameFor(name: string, who: LayerReader): BoardLayer | null {
  if (name === privateLayerOf(who.userId)) return 'private';
  if (name === EDITORS_LAYER && canEdit(who.role)) return 'editors';
  return null;
}

export function mayWriteLayer(name: string, who: LayerReader): boolean {
  return wireNameFor(name, who) !== null && canEdit(who.role);
}

export function mayRunLayerOp(who: LayerReader): boolean {
  return canEdit(who.role);
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** A well-formed LayerOp from a client's JSON, or null. */
export function parseLayerOp(json: string): LayerOp | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const { type, collection, prefix } = v as Record<string, unknown>;
  if (type !== 'reveal' && type !== 'discard') return null;
  if (typeof collection !== 'string' || !NAME_RE.test(collection)) return null;
  if (prefix !== undefined && (typeof prefix !== 'string' || prefix.length > 200)) return null;
  return { type, collection, ...(prefix !== undefined ? { prefix } : {}) };
}

/**
 * Applies `op` to every private layer (and, for 'reveal', the shared doc `main`): matching entries
 * are written to `main` in ONE transaction, then deleted from their layers. Values that are shared
 * types (not plain JSON) are never revealed. Returns how many entries were affected.
 */
export function applyLayerOp(op: LayerOp, main: Y.Doc, layers: Map<string, Y.Doc>, origin: unknown): number {
  const prefix = op.prefix ?? '';
  const hits: Array<{ doc: Y.Doc; keys: string[] }> = [];
  const reveal: Array<[string, unknown]> = [];
  for (const [name, doc] of layers) {
    if (!isPrivateLayer(name) || !doc.share.has(op.collection)) continue;
    const map = doc.getMap<unknown>(op.collection);
    const keys: string[] = [];
    for (const [key, value] of map) {
      if (!key.startsWith(prefix)) continue;
      keys.push(key);
      if (!(value instanceof Y.AbstractType)) reveal.push([key, value]);
    }
    if (keys.length) hits.push({ doc, keys });
  }
  if (!hits.length) return 0;
  if (op.type === 'reveal' && reveal.length) {
    const target = main.getMap<unknown>(op.collection);
    main.transact(() => {
      for (const [key, value] of reveal) target.set(key, value);
    }, origin);
  }
  for (const { doc, keys } of hits) {
    const map = doc.getMap<unknown>(op.collection);
    doc.transact(() => {
      for (const key of keys) map.delete(key);
    }, origin);
  }
  return hits.reduce((n, h) => n + h.keys.length, 0);
}
