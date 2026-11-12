// What happened to a board's elements, derived on the server from the changes it applies — the
// trusted source for the activity feed (modules/activity). Like comments.ts: only changes made
// through one of THIS instance's sockets, or on a request it served (realtime.changeBoard: the
// public API, MCP, insert structure; KAI-207), are reported — each change once across instances,
// the same updates this instance appends to the board's update log — attributed to the socket's
// authenticated user or guest, or the request's actor, never to what a client claims.
//
// Confidentiality: private layers (drafts, sealed ballots) are never observed. Changes in the
// 'editors' layer (hidden frames' contents) are reported with `layer: 'editors'`, which activity
// shows to owners/editors only. A removal from the shared doc of something inside a hidden frame
// is the editors' clients moving it into that layer (the frame was hidden), not news, and would
// leak how much the frame holds: it is not reported. No element content (text) is ever reported.
import type * as Y from 'yjs';
import type { ActingApp } from '@freero/shared';
import { logError } from '../../platform/log';
import { currentRequestContext } from '../../platform/requestContext';

export const ELEMENTS = 'elements';

/**
 * How a change reached the board, for product analytics (modules/analytics), which counts these
 * events later, outside the request: the door (a board socket is the app's) and whether the
 * browser behind it asked not to be tracked — GPC, DNT or the opt-out cookie, on the request or
 * on the socket's upgrade (platform/requestContext `privacySignal`).
 */
export interface ChangeDoor {
  surface: 'app' | 'api' | 'mcp' | 'other';
  privacySignal: boolean;
}

/** A board socket's door: the app, with what its upgrade request said. */
export const socketDoor = (privacySignal: boolean): ChangeDoor => ({ surface: 'app', privacySignal });

/** The door of the request being handled (a change made on no request — a job — is 'other'). */
export function requestDoor(): ChangeDoor {
  const ctx = currentRequestContext();
  return { surface: ctx?.surface ?? 'other', privacySignal: ctx?.privacySignal === true };
}

export interface ElementChange {
  id: string;
  op: 'add' | 'change' | 'remove';
  /** Element type ('sticky', 'shape', …; 'item' when unknown). */
  type: string;
  /** The frame it is in (after the change; before it for a removal), or null. */
  frameId: string | null;
}

export interface BoardChangeEvent {
  boardId: string;
  /** The socket's user or guest id; for a change made on a request (changeBoard), its actor. */
  actorId: string;
  /** The app or token that made a request's change for `actorId` (the API, MCP; KAI-168). */
  via?: ActingApp;
  /** The name others see them by (a guest's "Guest · <name>"). */
  actorName: string;
  /** Which doc changed: the shared doc, or the hidden frames' 'editors' layer. */
  layer: 'shared' | 'editors';
  changes: ElementChange[];
  /** Titles of the frames the changes are in (frames live in the shared doc). */
  frameTitles: Record<string, string>;
  door?: ChangeDoor;
}

type Listener = (e: BoardChangeEvent) => void;
const listeners = new Set<Listener>();

/** Called synchronously for every element change applied from a socket or a request on this instance. Keep it cheap. */
export function onBoardChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function hasBoardChangeListeners(): boolean {
  return listeners.size > 0;
}

export function emitBoardChange(e: BoardChangeEvent): void {
  if (e.changes.length === 0) return;
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      logError('realtime: a board-change listener failed', err);
    }
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const typeOf = (v: unknown) => (isObj(v) && typeof v.type === 'string' && v.type ? v.type : 'item');
const frameOf = (v: unknown) => (isObj(v) && typeof v.frameId === 'string' && v.frameId ? v.frameId : null);

/**
 * The element changes in one applied change of an `elements` map (`layer`'s), and the titles of
 * the frames they are in. `shared` is the shared doc's elements map (frames live there).
 */
export function elementChanges(
  layer: 'shared' | 'editors',
  elements: Y.Map<unknown>,
  shared: Y.Map<unknown>,
  keys: Map<string, { action: 'add' | 'update' | 'delete'; oldValue: unknown }>,
): { changes: ElementChange[]; frameTitles: Record<string, string> } {
  const changes: ElementChange[] = [];
  const frameTitles: Record<string, string> = {};
  const hiddenFrame = (id: string | null) => {
    const f = id ? shared.get(id) : undefined;
    return isObj(f) && f.type === 'frame' && f.hidden === true;
  };
  for (const [id, k] of keys) {
    if (k.action === 'delete') {
      const frameId = frameOf(k.oldValue);
      if (layer === 'shared' && hiddenFrame(frameId)) continue; // moved into the hidden frame's layer
      changes.push({ id, op: 'remove', type: typeOf(k.oldValue), frameId });
      continue;
    }
    const value = elements.get(id);
    changes.push({ id, op: k.action === 'add' ? 'add' : 'change', type: typeOf(value), frameId: frameOf(value) });
  }
  for (const c of changes) {
    if (!c.frameId || c.frameId in frameTitles) continue;
    const f = shared.get(c.frameId);
    if (isObj(f) && typeof f.title === 'string') frameTitles[c.frameId] = f.title;
  }
  return { changes, frameTitles };
}

// ---- docs (KAI-162) ----

/** Someone changed a doc's text, through their socket or on a request (the API, MCP), on this instance. */
export interface DocEditedEvent {
  docId: string;
  /** The socket's user (a guest's id for a guest), or the request's actor. */
  actorId: string;
  door: ChangeDoor;
}

type DocListener = (e: DocEditedEvent) => void;
const docListeners = new Set<DocListener>();

/** Called synchronously for every change of a doc's text applied on this instance. Keep it cheap. */
export function onDocEdited(fn: DocListener): () => void {
  docListeners.add(fn);
  return () => docListeners.delete(fn);
}

export function emitDocEdited(e: DocEditedEvent): void {
  for (const fn of docListeners) {
    try {
      fn(e);
    } catch (err) {
      logError('realtime: a doc-edit listener failed', err);
    }
  }
}
