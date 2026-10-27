// Pure comment-thread logic: pin geometry, idempotent edit operations (so concurrent
// writers can be reconciled), activity/unread, and list filtering.
import type { BoardElement, CommentMessage, CommentThread } from '@freero/shared';
import type { Point } from '@engine';

/** Stored superset of the shared types (extra fields are optional and forward-compatible). */
export type StoredMessage = CommentMessage & { authorColor?: string };
export interface StoredThread extends CommentThread {
  messages: StoredMessage[];
  /** World point where the thread was first pinned (fallback if its element vanished unseen). */
  origin?: Point;
}

export const MESSAGE_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅'] as const;

// ---------------------------------------------------------------------------
// Pin geometry
// ---------------------------------------------------------------------------
type Geom = Pick<BoardElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>;

function rotateAround(p: Point, c: Point, deg: number): Point {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Where a new thread pins: relative to the element under the click, else the world point. */
export function anchorFor(point: Point, target: (Geom & { id: string }) | null): { x: number; y: number; elementId: string | null } {
  if (!target) return { x: point.x, y: point.y, elementId: null };
  const center = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  const local = rotateAround(point, center, -(target.rotation || 0));
  return { x: local.x - target.x, y: local.y - target.y, elementId: target.id };
}

/** World position of a thread's pin. Element-pinned threads follow their element (incl. rotation). */
export function threadPoint(t: Pick<StoredThread, 'x' | 'y' | 'elementId' | 'origin'>, el: Geom | undefined): Point {
  if (!t.elementId) return { x: t.x, y: t.y };
  if (!el) return t.origin ?? { x: t.x, y: t.y };
  const center = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  return rotateAround({ x: el.x + t.x, y: el.y + t.y }, center, el.rotation || 0);
}

// ---------------------------------------------------------------------------
// Operations. Each returns its input unchanged when it is already applied, so a pending op
// can be re-applied on top of whatever state won a concurrent write.
// ---------------------------------------------------------------------------
export type ThreadOp = (t: StoredThread) => StoredThread;

function mapMessage(t: StoredThread, id: string, fn: (m: StoredMessage) => StoredMessage): StoredThread {
  const i = t.messages.findIndex((m) => m.id === id);
  if (i < 0) return t;
  const next = fn(t.messages[i]);
  if (next === t.messages[i]) return t;
  const messages = t.messages.slice();
  messages[i] = next;
  return { ...t, messages };
}

export const ops = {
  addMessage: (msg: StoredMessage): ThreadOp => (t) =>
    t.messages.some((m) => m.id === msg.id) ? t : { ...t, messages: [...t.messages, msg].sort((a, b) => a.createdAt - b.createdAt) },

  editMessage: (id: string, text: string, editedAt: number): ThreadOp => (t) =>
    mapMessage(t, id, (m) => (m.text === text ? m : { ...m, text, editedAt })),

  deleteMessage: (id: string): ThreadOp => (t) =>
    t.messages.some((m) => m.id === id) ? { ...t, messages: t.messages.filter((m) => m.id !== id) } : t,

  setReaction: (id: string, emoji: string, userId: string, on: boolean): ThreadOp => (t) =>
    mapMessage(t, id, (m) => {
      const users = m.reactions?.[emoji] ?? [];
      if (users.includes(userId) === on) return m;
      const nextUsers = on ? [...users, userId] : users.filter((u) => u !== userId);
      const reactions = { ...(m.reactions ?? {}) };
      if (nextUsers.length) reactions[emoji] = nextUsers;
      else delete reactions[emoji];
      return { ...m, reactions };
    }),

  setResolved: (resolved: boolean): ThreadOp => (t) => (t.resolved === resolved ? t : { ...t, resolved }),

  /** The pinned element is gone: keep the thread exactly where it was, unpinned. */
  detach: (at: Point): ThreadOp => (t) => (t.elementId ? { ...t, elementId: null, x: at.x, y: at.y } : t),
};

/**
 * Re-applies this client's recent ops on top of the current stored thread. Returns the thread
 * to write, or null when the current state already reflects them (nothing to write).
 */
export function reconcile(current: StoredThread, pending: ThreadOp[]): StoredThread | null {
  const next = pending.reduce((t, op) => op(t), current);
  return JSON.stringify(next) === JSON.stringify(current) ? null : next;
}

// ---------------------------------------------------------------------------
// Activity, unread, lists
// ---------------------------------------------------------------------------
export function messageActivity(m: StoredMessage): number {
  return Math.max(m.createdAt, m.editedAt ?? 0);
}

export function latestActivity(t: StoredThread): number {
  return t.messages.reduce((acc, m) => Math.max(acc, messageActivity(m)), t.createdAt);
}

/** Unread = someone else wrote or edited something after you last looked. Your own activity never counts. */
export function isUnread(t: StoredThread, seenAt: number | undefined, myId: string): boolean {
  return t.messages.some((m) => m.authorId !== myId && messageActivity(m) > (seenAt ?? 0));
}

export type ThreadFilter = 'open' | 'resolved' | 'mine';

export function listThreads(threads: StoredThread[], filter: ThreadFilter, myId: string): StoredThread[] {
  const keep = threads.filter((t) => {
    if (!t.messages.length) return false;
    if (filter === 'open') return !t.resolved;
    if (filter === 'resolved') return t.resolved;
    return t.messages.some((m) => m.authorId === myId);
  });
  return keep.sort((a, b) => latestActivity(b) - latestActivity(a));
}

/** "just now", "5m", "3h", "2d", then a short date. */
export function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Stable fallback color for authors whose color wasn't stored. */
export function colorFor(id: string): string {
  const palette = ['#5b3ff0', '#e5484d', '#1fa463', '#f5a524', '#0091ff', '#d6409f', '#12a594', '#8e4ec6'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}
