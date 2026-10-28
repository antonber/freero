// Comments session state: local UI (draft, open thread, filters), "seen" bookkeeping in
// localStorage, and the actions that write the `comments` collection. Each write touches only
// its own small record (see CommentRecord in @freero/shared), so concurrent writers never
// overwrite each other and nothing needs re-applying.
import { createStore, useStore, type StoreApi } from 'zustand';
import { nanoid } from 'nanoid';
import type { CommentMessageRecord, CommentRecord, CommentThread, CommentThreadRecord } from '@freero/shared';
import type { Collection, Editor, Point } from '@engine';
import { assembleThreads, keys, reactionKeys, threadKeys, threadPoint, upgradeLegacy, type ThreadFilter } from './model';

export const COLLECTION = 'comments';
export const PANEL_ID = 'comments.panel';
export const TOOL_ID = 'comments';

export interface Draft {
  x: number;
  y: number;
  elementId: string | null;
  corner: 'top-right' | null;
  origin: Point;
}

export interface CommentsUi {
  draft: Draft | null;
  openId: string | null;
  /** The open thread was opened from elsewhere (find) and must not take the keyboard focus. */
  quietId: string | null;
  showResolved: boolean;
  filter: ThreadFilter;
  /** threadId -> latest activity timestamp you've seen. */
  seen: Record<string, number>;
}

interface Session {
  ui: StoreApi<CommentsUi>;
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
      quietId: null,
      showResolved: loadJson(prefsKey, false),
      filter: 'open',
      seen: typeof localStorage === 'undefined' ? {} : loadJson(seenKey(editor), {}),
    }));
    // Another tab of yours marked something read.
    if (typeof window !== 'undefined')
      window.addEventListener('storage', (e) => {
        if (e.key === seenKey(editor)) ui.setState({ seen: loadJson(seenKey(editor), {}) });
      });
    s = { ui };
    sessions.set(editor, s);
  }
  return s;
}

export function useCommentsUi<T>(editor: Editor, sel: (s: CommentsUi) => T): T {
  return useStore(session(editor).ui, sel);
}

export function setUi(editor: Editor, patch: Partial<CommentsUi>) {
  const { ui } = session(editor);
  // Opening any other way (or closing) ends the quiet open.
  if ('openId' in patch && !('quietId' in patch) && patch.openId !== ui.getState().quietId) patch = { ...patch, quietId: null };
  ui.setState(patch);
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
// Records
// ---------------------------------------------------------------------------
const records = (editor: Editor) => editor.collection<CommentRecord>(COLLECTION);

/** Current threads (read model). */
export function getThreads(editor: Editor): CommentThread[] {
  return assembleThreads(records(editor).entries());
}

export function getThread(editor: Editor, threadId: string): CommentThread | undefined {
  return getThreads(editor).find((t) => t.id === threadId);
}

/** Keeps rewriting threads stored whole (before the keyed layout) as records. Returns a stop function. */
export function watchLegacyThreads(editor: Editor): () => void {
  const coll = records(editor);
  upgradeLegacyThreads(editor, coll);
  return coll.observe(() => upgradeLegacyThreads(editor, coll));
}

function upgradeLegacyThreads(editor: Editor, coll: Collection<CommentRecord>) {
  if (!editor.can('commenter')) return;
  const legacy = coll.entries().flatMap(([k, v]) => {
    const recs = upgradeLegacy(k, v);
    return recs ? [{ key: k, recs }] : [];
  });
  if (!legacy.length) return;
  editor.transact(() => {
    for (const { key, recs } of legacy) {
      for (const [k, v] of recs) coll.set(k, v);
      coll.delete(key);
    }
  });
}

// ---------------------------------------------------------------------------
// Actions (all writes go through these)
// ---------------------------------------------------------------------------
function newMessage(editor: Editor, threadId: string, text: string): CommentMessageRecord {
  return {
    kind: 'message',
    threadId,
    id: nanoid(10),
    authorId: editor.user.id,
    authorName: editor.user.name,
    authorColor: editor.user.color,
    text,
    // Server clock: message order and "2m ago" agree across machines with skewed clocks.
    createdAt: editor.host.serverNow(),
  };
}

export function startDraft(editor: Editor, at: { x: number; y: number; elementId: string | null; corner?: 'top-right' | null }) {
  const el = at.elementId ? editor.getElement(at.elementId) : undefined;
  const draft = { ...at, corner: at.corner ?? null };
  setUi(editor, { draft: { ...draft, origin: threadPoint(draft, el) }, openId: null });
}

/** Persists a thread only now that it has its first message. Returns the new id. */
export function submitDraft(editor: Editor, text: string): string | null {
  const draft = session(editor).ui.getState().draft;
  const body = text.trim();
  if (!draft || !body || !editor.can('commenter')) return null;
  const id = nanoid(12);
  const msg = newMessage(editor, id, body);
  const thread: CommentThreadRecord = {
    kind: 'thread',
    id,
    x: draft.x,
    y: draft.y,
    elementId: draft.elementId,
    corner: draft.corner,
    origin: draft.origin,
    createdAt: msg.createdAt,
    createdBy: editor.user.id,
  };
  const coll = records(editor);
  editor.transact(() => {
    coll.set(keys.thread(id), thread);
    coll.set(keys.message(id, msg.id), msg);
  });
  markSeen(editor, id, msg.createdAt);
  setUi(editor, { draft: null, openId: id });
  return id;
}

export function reply(editor: Editor, threadId: string, text: string) {
  const body = text.trim();
  if (!body) return;
  const msg = newMessage(editor, threadId, body);
  records(editor).set(keys.message(threadId, msg.id), msg);
}

/** Only the author edits a message, and an edit rewrites just that message's record. */
export function editMessage(editor: Editor, threadId: string, messageId: string, text: string) {
  const body = text.trim();
  const coll = records(editor);
  const cur = coll.get(keys.message(threadId, messageId));
  if (!body || cur?.kind !== 'message' || cur.authorId !== editor.user.id || cur.text === body) return;
  coll.set(keys.message(threadId, messageId), { ...cur, text: body, editedAt: editor.host.serverNow() });
}

/**
 * Find & replace in comments: rewrites `find` in YOUR messages only (an edit, like editMessage —
 * nobody's words are changed under their name), optionally just the listed messages. A message
 * the replacement would empty is left as it is. Returns how many messages changed.
 */
export function replaceInMessages(
  editor: Editor,
  find: string,
  replacement: string,
  opts: { caseSensitive?: boolean; only?: Array<{ threadId: string; messageId: string }> } = {},
): number {
  if (!find) return 0;
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.caseSensitive ? 'g' : 'gi');
  const only = opts.only && new Set(opts.only.map((m) => keys.message(m.threadId, m.messageId)));
  let changed = 0;
  editor.transact(() => {
    for (const t of getThreads(editor))
      for (const m of t.messages) {
        if (m.authorId !== editor.user.id || (only && !only.has(keys.message(t.id, m.id)))) continue;
        const next = m.text.replace(re, () => replacement);
        if (next === m.text || !next.trim()) continue;
        editMessage(editor, t.id, m.id, next);
        changed++;
      }
  });
  return changed;
}

/** Deleting the last message deletes the thread (an empty thread is never kept). */
export function deleteMessage(editor: Editor, threadId: string, messageId: string) {
  const t = getThread(editor, threadId);
  if (!t) return;
  if (t.messages.every((m) => m.id === messageId)) return deleteThread(editor, threadId);
  const coll = records(editor);
  editor.transact(() => {
    coll.delete(keys.message(threadId, messageId));
    for (const k of reactionKeys(coll.entries(), threadId, messageId)) coll.delete(k);
    // The tombstone keeps it deleted even if a concurrent edit re-creates the message record.
    coll.set(keys.deleted(threadId, messageId), { kind: 'deleted', threadId, messageId, by: editor.user.id, at: editor.host.serverNow() });
  });
}

/** One record per (message, person, emoji): toggling never touches anyone else's reaction. */
export function toggleReaction(editor: Editor, threadId: string, messageId: string, emoji: string) {
  const coll = records(editor);
  const key = keys.reaction(threadId, messageId, editor.user.id, emoji);
  if (coll.get(key)) coll.delete(key);
  else coll.set(key, { kind: 'reaction', threadId, messageId, userId: editor.user.id, emoji });
}

export function setResolved(editor: Editor, threadId: string, resolved: boolean) {
  records(editor).set(keys.status(threadId), { kind: 'status', threadId, resolved, by: editor.user.id, at: editor.host.serverNow() });
}

export function deleteThread(editor: Editor, threadId: string) {
  const coll = records(editor);
  editor.transact(() => {
    for (const k of threadKeys(coll.entries(), threadId)) coll.delete(k);
    // Hides replies (or a detach) written concurrently by someone who hadn't seen the delete yet.
    coll.set(keys.deleted(threadId), { kind: 'deleted', threadId, by: editor.user.id, at: editor.host.serverNow() });
  });
  if (session(editor).ui.getState().openId === threadId) setUi(editor, { openId: null });
}

/** The pinned element is gone: keep the thread exactly where it was, unpinned. */
export function detachThread(editor: Editor, threadId: string, at: Point) {
  const coll = records(editor);
  const cur = coll.get(keys.thread(threadId));
  if (cur?.kind !== 'thread' || !cur.elementId) return;
  coll.set(keys.thread(threadId), { ...cur, elementId: null, corner: null, x: at.x, y: at.y });
}

export function canDeleteThread(editor: Editor, t: CommentThread): boolean {
  return editor.can('editor') || (editor.can('commenter') && t.createdBy === editor.user.id);
}

/**
 * Pans (and if needed zooms) so the thread's pin sits in the visible part of the canvas, then opens
 * it. `quiet`: the thread card doesn't take the keyboard focus (the opener keeps it).
 */
export function focusThread(editor: Editor, t: CommentThread, opts: { quiet?: boolean } = {}) {
  const el = t.elementId ? editor.getElement(t.elementId) : undefined;
  const cam = editor.getCamera();
  const zoom = Math.min(1.5, Math.max(0.75, cam.zoom));
  const p = threadPoint(t, el, zoom);
  // Center the pin in the board area the chrome (dock, toolbar…) leaves free, nudged left/up so
  // the thread card that opens beside it fits too.
  const area = editor.getSafeArea();
  const sx = area.x + area.w / 2 - 120;
  const sy = area.y + area.h / 2 + 60;
  editor.setCamera({ x: p.x - sx / zoom, y: p.y - sy / zoom, zoom }, { animate: true });
  setUi(editor, { openId: t.id, draft: null, quietId: opts.quiet ? t.id : null });
}
