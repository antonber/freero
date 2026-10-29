// Decision snapshots (KAI-161): the content side. modules/decisions keeps the decisions themselves
// (title, note, frame, who); what a decision SHOWS is a version of kind 'decision' kept here, taken
// from the live board (every instance's latest edits) and never written again.
//
// A frame decision serves only that frame: its items at any depth, the content that belongs to
// them (table cells, their comment threads…: ELEMENT_CONTENT_COLLECTIONS), and lines fully inside
// it — both ends on those items, or loose ends inside the frame. The version itself keeps the
// whole shared board (restoring it from the history must not wipe the rest of the board); the cut
// is made on every read, from that immutable state.
//
// Only the SHARED doc is ever versioned: hidden frames' contents and private drafts are in no
// decision, so a decision can be shown to everyone who may open its board.
import * as Y from 'yjs';
import { ELEMENT_CONTENT_COLLECTIONS, Y_ELEMENTS, Y_SETTINGS, type BoardElement, type ConnectorElement } from '@freero/shared';
import * as repo from './repo';
import { snapshotBoardDoc } from './rooms';
import { viewOf, type BoardView } from './view';

/** Collections a frame decision keeps besides elements and element content: board-level vocabulary only. */
const KEPT_WHOLE = new Set([Y_SETTINGS, 'tags']);

const EMPTY_STATE = () => Y.encodeStateAsUpdate(new Y.Doc());

/**
 * Freezes the board as it is right now (live, every instance) as a decision version. `accept`
 * looks at the state first and may throw (a frame that isn't there): then nothing is kept.
 */
export async function freezeBoard<T>(boardId: string, userId: string, name: string, accept: (state: Uint8Array) => T): Promise<{ version: repo.SnapshotInfo; accepted: T }> {
  const state = (await snapshotBoardDoc(boardId)) ?? EMPTY_STATE();
  const accepted = accept(state);
  const version = await repo.insertSnapshot(boardId, { state, kind: 'decision', name, createdBy: userId }, Date.now());
  return { version, accepted };
}

/** A decision's version (null when it is not this board's, or not a decision any more). */
export async function decisionVersion(boardId: string, versionId: number): Promise<Uint8Array | null> {
  const found = await repo.snapshotWithState(boardId, versionId);
  return found && found.info.kind === 'decision' ? found.state : null;
}

/** After a decision is deleted, its version stays in the history as a named one. */
export async function releaseDecisionVersion(boardId: string, versionId: number): Promise<void> {
  await repo.demoteDecisionSnapshot(boardId, versionId);
}

const isElement = (v: unknown): v is BoardElement => !!v && typeof v === 'object' && typeof (v as BoardElement).id === 'string' && typeof (v as BoardElement).type === 'string';

/** Ids of the frame's items at any depth (the frame included). */
function subtree(elements: Map<string, BoardElement>, frameId: string): Set<string> {
  const inside = new Set<string>([frameId]);
  const within = (el: BoardElement): boolean => {
    let parent = el.frameId;
    for (let depth = 0; parent && depth < 64; depth++) {
      if (parent === frameId) return true;
      parent = elements.get(parent)?.frameId ?? null;
    }
    return false;
  };
  for (const el of elements.values()) if (el.type !== 'connector' && within(el)) inside.add(el.id);
  return inside;
}

/** A line belongs to the frame when both ends do: attached to its items, or loose inside its box. */
function lineInside(c: ConnectorElement, inside: Set<string>, frame: BoardElement): boolean {
  const end = (e: ConnectorElement['start'] | undefined) => {
    if (!e) return false;
    if (e.elementId) return inside.has(e.elementId);
    return e.x >= frame.x && e.x <= frame.x + frame.w && e.y >= frame.y && e.y <= frame.y + frame.h;
  };
  return end(c.start) && end(c.end);
}

/**
 * The part of a frozen board a frame decision shows: that frame and what belongs to it. Null when
 * the frame isn't in the state (it was hidden or a draft when frozen: nothing to show).
 */
export function frameOnlyState(state: Uint8Array, frameId: string): { state: Uint8Array; frameTitle: string } | null {
  const src = new Y.Doc();
  const out = new Y.Doc();
  try {
    Y.applyUpdate(src, state);
    const elements = new Map<string, BoardElement>();
    if (src.share.has(Y_ELEMENTS)) for (const [k, v] of src.getMap<unknown>(Y_ELEMENTS)) if (isElement(v) && v.id === k) elements.set(k, v);
    const frame = elements.get(frameId);
    // A hidden frame's contents are not in the shared doc: an empty frame is not what anyone decided on.
    if (!frame || frame.type !== 'frame' || (frame as { hidden?: unknown }).hidden) return null;
    const inside = subtree(elements, frameId);
    for (const el of elements.values()) if (el.type === 'connector' && lineInside(el as ConnectorElement, inside, frame)) inside.add(el.id);
    out.transact(() => {
      const els = out.getMap<unknown>(Y_ELEMENTS);
      // Out of every frame it was in: the decision's frame stands on its own.
      for (const id of inside) {
        const el = elements.get(id)!;
        els.set(id, id === frameId ? { ...el, frameId: null } : el);
      }
      for (const name of src.share.keys()) {
        if (name === Y_ELEMENTS) continue;
        const rule = ELEMENT_CONTENT_COLLECTIONS[name];
        if (!rule && !KEPT_WHOLE.has(name)) continue;
        const from = src.getMap<unknown>(name);
        const to = out.getMap<unknown>(name);
        for (const [k, v] of from) {
          if (rule) {
            const owners = rule.owners(k, v, (key) => from.get(key));
            if (!owners.length || !owners.every((o) => inside.has(o))) continue;
          }
          to.set(k, v);
        }
      }
    });
    const title = (frame as { title?: unknown }).title;
    return { state: Y.encodeStateAsUpdate(out), frameTitle: typeof title === 'string' ? title : '' };
  } finally {
    src.destroy();
    out.destroy();
  }
}

/** A frozen state read like a board everyone sees (what "what changed" compares). */
export function viewOfState(state: Uint8Array): BoardView {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const view = viewOf(doc, new Map(), { userId: '', role: 'viewer' });
    const collections = new Map<string, ReadonlyMap<string, unknown>>();
    for (const name of doc.share.keys()) collections.set(name, new Map(view.collection(name)));
    return { ...view, collection: (name) => collections.get(name) ?? new Map() };
  } finally {
    doc.destroy();
  }
}

/**
 * The live board as EVERY reader sees it (the shared doc, viewer rules: no hidden frame's
 * contents, nobody's drafts) — the other side of "what changed since this decision". A frame
 * decision compares against that frame cut out of the live board the same way.
 */
export async function liveSharedState(boardId: string): Promise<Uint8Array> {
  return (await snapshotBoardDoc(boardId)) ?? EMPTY_STATE();
}
