// Comments session state: local UI (draft, open thread, filters), "seen" bookkeeping in
// localStorage, and the one writer of the `comments` collection.
import { createStore, useStore, type StoreApi } from 'zustand';
import { nanoid } from 'nanoid';
import type { Collection, Editor, Point } from '@engine';
import { ops, reconcile, threadPoint, type StoredMessage, type StoredThread, type ThreadFilter, type ThreadOp } from './model';

export const COLLECTION = 'comments';
export const PANEL_ID = 'comments.panel';
export const TOOL_ID = 'comments';

export interface Draft {
  x: number;
  y: number;
  elementId: string | null;
  origin: Point;
}

export interface CommentsUi {
  draft: Draft | null;
  openId: string | null;
  showResolved: boolean;
  filter: ThreadFilter;
  /** threadId -> latest activity timestamp you've seen. */
  seen: Record<string, number>;
}

interface Session {
  ui: StoreApi<CommentsUi>;
  writer: ThreadWriter;
}

const sessions = new WeakMap<Editor, Session>();

const seenKey = (editor: Editor) => `freero.comments.seen.${editor.user.id}.${editor.boardId}`;
const prefsKey = 'freero.comments.showResolved';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: seen state just won't persist
  }
}

/** The scoped comments Editor is cached per board session, so it keys the session state. */
export function session(editor: Editor): Session {
  let s = sessions.get(editor);
  if (!s) {
    const ui = createStore<CommentsUi>(() => ({
      draft: null,
      openId: null,
      showResolved: loadJson(prefsKey, false),
      filter: 'open',
      seen: typeof localStorage === 'undefined' ? {} : loadJson(seenKey(editor), {}),
    }));
    // Another tab of yours marked something read.
    if (typeof window !== 'undefined')
      window.addEventListener('storage', (e) => {
        if (e.key === seenKey(editor)) ui.setState({ seen: loadJson(seenKey(editor), {}) });
      });
    s = { ui, writer: new ThreadWriter(editor.collection<StoredThread>(COLLECTION)) };
    sessions.set(editor, s);
  }
  return s;
}

export function useCommentsUi<T>(editor: Editor, sel: (s: CommentsUi) => T): T {
  return useStore(session(editor).ui, sel);
}

export function setUi(editor: Editor, patch: Partial<CommentsUi>) {
  session(editor).ui.setState(patch);
  if ('showResolved' in patch) saveJson(prefsKey, patch.showResolved);
}

export function markSeen(editor: Editor, threadId: string, at: number) {
  const { ui } = session(editor);
  const seen = ui.getState().seen;
  if ((seen[threadId] ?? 0) >= at) return;
  const next = { ...seen, [threadId]: at };
  ui.setState({ seen: next });
  saveJson(seenKey(editor), next);
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------
const PENDING_MS = 10_000;

/**
 * Threads are stored whole (one map value each), so two people writing the same thread at
 * once would otherwise lose one of the writes (last writer wins). The writer keeps this
 * client's recent ops and re-applies them whenever the thread changes underneath, until they
 * have stuck for a while. Ops are idempotent, so re-applying is safe.
 */
export class ThreadWriter {
  private pending = new Map<string, Array<{ op: ThreadOp; until: number }>>();
  private busy = false;

  constructor(private coll: Collection<StoredThread>) {
    coll.observe(() => this.reconcileAll());
  }

  create(thread: StoredThread) {
    this.coll.set(thread.id, thread);
  }

  apply(id: string, op: ThreadOp) {
    if (!this.coll.get(id)) return;
    const list = this.pending.get(id) ?? [];
    list.push({ op, until: Date.now() + PENDING_MS });
    this.pending.set(id, list);
    this.reconcileOne(id);
  }

  remove(id: string) {
    this.pending.delete(id);
    this.coll.delete(id);
  }

  private reconcileOne(id: string) {
    const now = Date.now();
    const list = (this.pending.get(id) ?? []).filter((p) => p.until > now);
    const cur = this.coll.get(id);
    if (!list.length || !cur) {
      this.pending.delete(id);
      return;
    }
    this.pending.set(id, list);
    const next = reconcile(cur, list.map((p) => p.op));
    if (next) this.coll.set(id, next);
  }

  private reconcileAll() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const id of [...this.pending.keys()]) this.reconcileOne(id);
    } finally {
      this.busy = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Actions (all writes go through these)
// ---------------------------------------------------------------------------
function newMessage(editor: Editor, text: string): StoredMessage {
  return {
    id: nanoid(10),
    authorId: editor.user.id,
    authorName: editor.user.name,
    authorColor: editor.user.color,
    text,
    // Server clock: message order and "2m ago" agree across machines with skewed clocks.
    createdAt: editor.host.serverNow(),
  };
}

export function startDraft(editor: Editor, at: { x: number; y: number; elementId: string | null }) {
  const el = at.elementId ? editor.getElement(at.elementId) : undefined;
  setUi(editor, { draft: { ...at, origin: threadPoint(at, el) }, openId: null });
}

/** Persists a thread only now that it has its first message. Returns the new id. */
export function submitDraft(editor: Editor, text: string): string | null {
  const draft = session(editor).ui.getState().draft;
  const body = text.trim();
  if (!draft || !body || !editor.can('commenter')) return null;
  const msg = newMessage(editor, body);
  const thread: StoredThread = {
    id: nanoid(12),
    x: draft.x,
    y: draft.y,
    elementId: draft.elementId,
    resolved: false,
    messages: [msg],
    createdAt: msg.createdAt,
    origin: draft.origin,
  };
  session(editor).writer.create(thread);
  markSeen(editor, thread.id, msg.createdAt);
  setUi(editor, { draft: null, openId: thread.id });
  return thread.id;
}

export function reply(editor: Editor, threadId: string, text: string) {
  const body = text.trim();
  if (!body) return;
  session(editor).writer.apply(threadId, ops.addMessage(newMessage(editor, body)));
}

export function editMessage(editor: Editor, threadId: string, messageId: string, text: string) {
  const body = text.trim();
  if (!body) return;
  session(editor).writer.apply(threadId, ops.editMessage(messageId, body, editor.host.serverNow()));
}

/** Deleting the last message deletes the thread (an empty thread is never kept). */
export function deleteMessage(editor: Editor, threadId: string, messageId: string) {
  const { writer } = session(editor);
  const t = editor.collection<StoredThread>(COLLECTION).get(threadId);
  if (!t) return;
  if (t.messages.every((m) => m.id === messageId)) return deleteThread(editor, threadId);
  writer.apply(threadId, ops.deleteMessage(messageId));
}

export function toggleReaction(editor: Editor, threadId: string, messageId: string, emoji: string) {
  const t = editor.collection<StoredThread>(COLLECTION).get(threadId);
  const m = t?.messages.find((x) => x.id === messageId);
  if (!m) return;
  const on = !(m.reactions?.[emoji] ?? []).includes(editor.user.id);
  session(editor).writer.apply(threadId, ops.setReaction(messageId, emoji, editor.user.id, on));
}

export function setResolved(editor: Editor, threadId: string, resolved: boolean) {
  session(editor).writer.apply(threadId, ops.setResolved(resolved));
}

export function deleteThread(editor: Editor, threadId: string) {
  session(editor).writer.remove(threadId);
  if (session(editor).ui.getState().openId === threadId) setUi(editor, { openId: null });
}

export function detachThread(editor: Editor, threadId: string, at: Point) {
  session(editor).writer.apply(threadId, ops.detach(at));
}

export function canDeleteThread(editor: Editor, t: StoredThread): boolean {
  return editor.can('editor') || (editor.can('commenter') && t.messages[0]?.authorId === editor.user.id);
}

/** Pans (and if needed zooms) so the thread's pin sits in the visible part of the canvas, then opens it. */
export function focusThread(editor: Editor, t: StoredThread) {
  const el = t.elementId ? editor.getElement(t.elementId) : undefined;
  const p = threadPoint(t, el);
  const cam = editor.getCamera();
  const vp = editor.getViewportSize();
  const zoom = Math.min(1.5, Math.max(0.75, cam.zoom));
  // The dock covers the right side of the canvas: center the pin in what's left.
  const visibleW = editor.getDock() ? Math.max(320, vp.width - 384) : vp.width;
  const sx = visibleW / 2 - 120;
  const sy = vp.height / 2 + 60;
  editor.setCamera({ x: p.x - sx / zoom, y: p.y - sy / zoom, zoom }, { animate: true });
  setUi(editor, { openId: t.id, draft: null });
}
