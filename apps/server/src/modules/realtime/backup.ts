// Board backups (`.freero`, KAI-137; modules/backup builds and reads the file): the board's content
// as JSON per top-level collection — what the exporter may read of it — and, on restore, a fresh
// Yjs document built from such JSON. The doc layout is top-level Y.Maps of plain JSON values
// (@freero/shared ydoc.ts), so JSON is lossless; a restore builds NEW history (one client, one
// transaction), never replays someone else's CRDT updates from an untrusted file.
import * as Y from 'yjs';
import { Y_LEFT_OUT_OF_BACKUPS } from '@freero/shared';
import { snapshotBoardDoc, snapshotBoardLayer } from './rooms';

/** Collection name -> key -> JSON value: one doc (the shared doc, or a layer) as plain data. */
export type BoardContentJson = Record<string, Record<string, unknown>>;

const LEFT_OUT: ReadonlySet<string> = new Set(Y_LEFT_OUT_OF_BACKUPS);

/** Element fields that point at state a restored board does not have (a tracker link's row). */
const ELEMENT_FIELDS_LEFT_OUT = ['trackerLink'] as const;

const plain = (v: unknown) => (v instanceof Y.AbstractType ? v.toJSON() : v);

function decode(state: Uint8Array | null): BoardContentJson {
  const out: BoardContentJson = {};
  if (!state) return out;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    for (const name of [...doc.share.keys()].sort()) {
      if (LEFT_OUT.has(name)) continue;
      const map: Record<string, unknown> = {};
      for (const [k, v] of doc.getMap<unknown>(name).entries()) map[k] = plain(v);
      if (Object.keys(map).length) out[name] = map;
    }
    return withoutLeftOutFields(out);
  } finally {
    doc.destroy();
  }
}

/** The content with the collections and element fields a backup leaves out removed. */
export function withoutLeftOutFields(content: BoardContentJson): BoardContentJson {
  const out: BoardContentJson = {};
  for (const [name, map] of Object.entries(content)) {
    if (LEFT_OUT.has(name)) continue;
    if (name !== 'elements') {
      out[name] = map;
      continue;
    }
    const elements: Record<string, unknown> = {};
    for (const [id, el] of Object.entries(map)) {
      if (!el || typeof el !== 'object' || Array.isArray(el)) continue;
      const copy = { ...(el as Record<string, unknown>) };
      for (const f of ELEMENT_FIELDS_LEFT_OUT) delete copy[f];
      elements[id] = copy;
    }
    out[name] = elements;
  }
  return out;
}

export interface BoardBackupContent {
  /** The shared doc: what everyone who can open the board reads. */
  doc: BoardContentJson;
  /** The `editors` layer (hidden frames' contents and their element content), owners/editors only; never pending suggestions. */
  editors: BoardContentJson | null;
}

/**
 * The board's content for a backup, live (caught up with every instance): the shared doc, plus the
 * `editors` layer when the exporter may read it. Never anyone's private layer — drafts and sealed
 * ballots are not board content yet (a duplicate leaves them out the same way).
 */
export async function boardBackupContent(boardId: string, opts: { editorsLayer: boolean }): Promise<BoardBackupContent> {
  const doc = decode(await snapshotBoardDoc(boardId));
  if (!opts.editorsLayer) return { doc, editors: null };
  const editors = decode(await snapshotBoardLayer(boardId, 'editors', { withoutSuggestions: true }));
  return { doc, editors: Object.keys(editors).length ? editors : null };
}

/** A new Yjs document state holding exactly `content` (one transaction), for initBoardDoc / initBoardLayer. */
export function encodeBoardContent(content: BoardContentJson): Uint8Array {
  const doc = new Y.Doc();
  try {
    doc.transact(() => {
      for (const [name, entries] of Object.entries(content)) {
        const map = doc.getMap<unknown>(name);
        for (const [key, value] of Object.entries(entries)) map.set(key, value);
      }
    });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
