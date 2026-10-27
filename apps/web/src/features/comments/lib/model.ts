// Pure comment logic: the keyed record layout of the `comments` collection (one small record
// per key — see CommentRecord in @freero/shared), assembling records into threads, pin
// geometry, activity/unread and list filtering.
import type {
  BoardElement,
  CommentMessage,
  CommentMessageRecord,
  CommentReactionRecord,
  CommentRecord,
  CommentStatusRecord,
  CommentThread,
  CommentThreadRecord,
} from '@freero/shared';
import type { Point } from '@engine';

export const MESSAGE_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅'] as const;

// ---------------------------------------------------------------------------
// Storage layout
// ---------------------------------------------------------------------------
export const keys = {
  thread: (threadId: string) => `t:${threadId}`,
  status: (threadId: string) => `s:${threadId}`,
  message: (threadId: string, messageId: string) => `m:${threadId}:${messageId}`,
  reaction: (threadId: string, messageId: string, userId: string, emoji: string) => `r:${threadId}:${messageId}:${userId}:${emoji}`,
  deleted: (threadId: string, messageId?: string) => (messageId ? `x:${threadId}:${messageId}` : `x:${threadId}`),
};

const isRecord = (v: unknown): v is CommentRecord => !!v && typeof v === 'object' && typeof (v as { kind?: unknown }).kind === 'string';

const threadOf = (r: CommentRecord) => (r.kind === 'thread' ? r.id : r.threadId);

/** Keys of every live record of a thread (what deleting the thread removes). */
export function threadKeys(entries: Array<[string, unknown]>, threadId: string): string[] {
  return entries.filter(([, v]) => isRecord(v) && v.kind !== 'deleted' && threadOf(v) === threadId).map(([k]) => k);
}

/** Keys of a message's reactions (removed with the message). */
export function reactionKeys(entries: Array<[string, unknown]>, threadId: string, messageId: string): string[] {
  return entries
    .filter(([, v]) => isRecord(v) && v.kind === 'reaction' && v.threadId === threadId && v.messageId === messageId)
    .map(([k]) => k);
}

const emojiRank = (e: string) => {
  const i = (MESSAGE_REACTIONS as readonly string[]).indexOf(e);
  return i < 0 ? MESSAGE_REACTIONS.length : i;
};

/**
 * Builds the read model from the collection's records. Deleted threads/messages (tombstoned)
 * stay hidden even if a concurrent write re-created one of their records. Threads without a
 * visible message are dropped. Output is independent of map iteration order, so every replica
 * renders the same thing.
 */
export function assembleThreads(entries: Array<[string, unknown]>): CommentThread[] {
  const metas: CommentThreadRecord[] = [];
  const status = new Map<string, CommentStatusRecord>();
  const messages = new Map<string, CommentMessageRecord[]>();
  const reactions = new Map<string, CommentReactionRecord[]>();
  const deleted = new Set<string>();
  for (const [, v] of entries) {
    if (!isRecord(v)) continue;
    switch (v.kind) {
      case 'thread':
        metas.push(v);
        break;
      case 'status':
        status.set(v.threadId, v);
        break;
      case 'message': {
        const list = messages.get(v.threadId);
        if (list) list.push(v);
        else messages.set(v.threadId, [v]);
        break;
      }
      case 'reaction': {
        const k = `${v.threadId}:${v.messageId}`;
        const list = reactions.get(k);
        if (list) list.push(v);
        else reactions.set(k, [v]);
        break;
      }
      case 'deleted':
        deleted.add(v.messageId ? `${v.threadId}:${v.messageId}` : v.threadId);
        break;
    }
  }
  const out: CommentThread[] = [];
  for (const meta of metas) {
    if (deleted.has(meta.id)) continue;
    const msgs: CommentMessage[] = (messages.get(meta.id) ?? [])
      .filter((m) => !deleted.has(`${meta.id}:${m.id}`))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      .map((m) => {
        const byEmoji: Record<string, string[]> = {};
        const rs = (reactions.get(`${meta.id}:${m.id}`) ?? []).slice().sort((a, b) => emojiRank(a.emoji) - emojiRank(b.emoji) || (a.emoji < b.emoji ? -1 : a.emoji > b.emoji ? 1 : 0) || (a.userId < b.userId ? -1 : 1));
        for (const r of rs) (byEmoji[r.emoji] ??= []).push(r.userId);
        return {
          id: m.id,
          authorId: m.authorId,
          authorName: m.authorName,
          authorColor: m.authorColor,
          text: m.text,
          createdAt: m.createdAt,
          editedAt: m.editedAt,
          reactions: byEmoji,
        };
      });
    if (!msgs.length) continue;
    out.push({
      id: meta.id,
      x: meta.x,
      y: meta.y,
      elementId: meta.elementId ?? null,
      corner: meta.corner ?? null,
      origin: meta.origin,
      resolved: status.get(meta.id)?.resolved ?? false,
      messages: msgs,
      createdAt: meta.createdAt,
      createdBy: meta.createdBy,
    });
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/**
 * Boards written before the keyed layout stored each thread whole under its id. Returns the
 * records that replace such a value (null when `value` isn't one). Converting is idempotent, so
 * two clients upgrading the same thread at once write identical records.
 */
export function upgradeLegacy(key: string, value: unknown): Array<[string, CommentRecord]> | null {
  const t = value as {
    id?: string; x?: number; y?: number; elementId?: string | null; origin?: Point; resolved?: boolean; createdAt?: number;
    messages?: Array<{ id: string; authorId: string; authorName: string; authorColor?: string; text: string; createdAt: number; editedAt?: number; reactions?: Record<string, string[]> }>;
  };
  if (isRecord(value) || !t || typeof t !== 'object' || !Array.isArray(t.messages)) return null;
  const id = t.id ?? key;
  const first = t.messages[0];
  const out: Array<[string, CommentRecord]> = [
    [keys.thread(id), { kind: 'thread', id, x: t.x ?? 0, y: t.y ?? 0, elementId: t.elementId ?? null, origin: t.origin, createdAt: t.createdAt ?? first?.createdAt ?? 0, createdBy: first?.authorId ?? '' }],
  ];
  if (t.resolved) out.push([keys.status(id), { kind: 'status', threadId: id, resolved: true, by: '', at: t.createdAt ?? 0 }]);
  for (const m of t.messages) {
    const { reactions, ...rest } = m;
    out.push([keys.message(id, m.id), { kind: 'message', threadId: id, ...rest }]);
    for (const [emoji, users] of Object.entries(reactions ?? {}))
      for (const userId of users) out.push([keys.reaction(id, m.id, userId, emoji), { kind: 'reaction', threadId: id, messageId: m.id, userId, emoji }]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pin geometry
// ---------------------------------------------------------------------------
type Geom = Pick<BoardElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>;

/** Screen px between an element's corner and a corner pin's tail (clear of the resize handle). */
export const CORNER_GAP = 9;

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

/**
 * World position of a thread's pin tail. Element-pinned threads follow their element (incl.
 * rotation); corner pins sit CORNER_GAP screen px diagonally outside the corner (pass the zoom),
 * so the bubble never covers the element's content or its handles.
 */
export function threadPoint(
  t: { x: number; y: number; elementId?: string | null; corner?: 'top-right' | null; origin?: Point },
  el: Geom | undefined,
  zoom = 1,
): Point {
  if (!t.elementId) return { x: t.x, y: t.y };
  if (!el) return t.origin ?? { x: t.x, y: t.y };
  const local = t.corner === 'top-right' ? { x: el.w + CORNER_GAP / zoom, y: -CORNER_GAP / zoom } : { x: t.x, y: t.y };
  const center = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  return rotateAround({ x: el.x + local.x, y: el.y + local.y }, center, el.rotation || 0);
}

// ---------------------------------------------------------------------------
// Activity, unread, lists
// ---------------------------------------------------------------------------
export function messageActivity(m: CommentMessage): number {
  return Math.max(m.createdAt, m.editedAt ?? 0);
}

export function latestActivity(t: CommentThread): number {
  return t.messages.reduce((acc, m) => Math.max(acc, messageActivity(m)), t.createdAt);
}

/** Unread = someone else wrote or edited something after you last looked. Your own activity never counts. */
export function isUnread(t: CommentThread, seenAt: number | undefined, myId: string): boolean {
  return t.messages.some((m) => m.authorId !== myId && messageActivity(m) > (seenAt ?? 0));
}

export type ThreadFilter = 'open' | 'resolved' | 'mine';

export function listThreads(threads: CommentThread[], filter: ThreadFilter, myId: string): CommentThread[] {
  const keep = threads.filter((t) => {
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
