// What happened to comments, derived on the server from the changes it applies — the trusted
// source for notifications (mentions, replies). Only changes made through one of THIS instance's
// sockets are reported, attributed to the socket's authenticated user, so each change is reported
// exactly once across instances and never on a client's say-so.
//
// Layout of the `comments` collection: CommentRecord in @freero/shared (`m:<thread>:<message>`
// holds one message; `t:` the thread; `x:` tombstones).
import type * as Y from 'yjs';
import { mentionedUserIds } from '@freero/shared';
import { logError } from '../../platform/log';

/** The comments feature's collection. */
export const COMMENTS_COLLECTION = 'comments';

export interface CommentMessageEvent {
  boardId: string;
  /** The authenticated user whose socket wrote the message (always its author). */
  authorId: string;
  threadId: string;
  messageId: string;
  text: string;
  /** The text before this change; null when the message is new. */
  previousText: string | null;
  /** Everyone else who wrote a (not deleted) message in the thread, and its creator. */
  participantIds: string[];
}

type Listener = (e: CommentMessageEvent) => void;
const listeners = new Set<Listener>();

/** Called for every comment message written or edited through a socket on this instance. */
export function onCommentMessage(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function hasCommentListeners(): boolean {
  return listeners.size > 0;
}

interface MessageLike {
  kind: 'message';
  threadId: string;
  id: string;
  authorId: string;
  text: string;
  createdAt?: unknown;
}

/** Messages first stored this long after they were written are history, not news. */
const STALE_MS = 24 * 60 * 60 * 1000;

const isMessage = (v: unknown): v is MessageLike => {
  const m = v as Partial<MessageLike> | null;
  return !!m && m.kind === 'message' && typeof m.threadId === 'string' && typeof m.id === 'string' && typeof m.authorId === 'string' && typeof m.text === 'string';
};

/** Everyone who wrote a live message in the thread, plus whoever created it. */
function participants(comments: Y.Map<unknown>, threadId: string): Set<string> {
  const out = new Set<string>();
  const thread = comments.get(`t:${threadId}`) as { createdBy?: unknown } | undefined;
  if (typeof thread?.createdBy === 'string' && thread.createdBy) out.add(thread.createdBy);
  const prefix = `m:${threadId}:`;
  for (const [key, value] of comments.entries()) {
    if (!key.startsWith(prefix) || !isMessage(value)) continue;
    if (comments.has(`x:${threadId}:${value.id}`)) continue;
    out.add(value.authorId);
  }
  return out;
}

/**
 * The message events in one applied change of the comments map. `authorId` is the user whose
 * socket made it; a message stored under anyone else's id is not theirs and yields nothing.
 */
export function messageEvents(
  boardId: string,
  comments: Y.Map<unknown>,
  changedKeys: Map<string, { action: 'add' | 'update' | 'delete'; oldValue: unknown }>,
  authorId: string,
  now = Date.now(),
): CommentMessageEvent[] {
  const out: CommentMessageEvent[] = [];
  for (const [key, change] of changedKeys) {
    if (change.action === 'delete' || !key.startsWith('m:')) continue;
    const value = comments.get(key);
    if (!isMessage(value) || key !== `m:${value.threadId}:${value.id}` || value.authorId !== authorId) continue;
    if (comments.has(`x:${value.threadId}`) || comments.has(`x:${value.threadId}:${value.id}`)) continue;
    const before = isMessage(change.oldValue) ? change.oldValue.text : null;
    if (before === value.text) continue;
    // A "new" record of an old message: a board from before the keyed layout being upgraded.
    if (before === null && typeof value.createdAt === 'number' && value.createdAt < now - STALE_MS) continue;
    const others = participants(comments, value.threadId);
    others.delete(authorId);
    out.push({
      boardId,
      authorId,
      threadId: value.threadId,
      messageId: value.id,
      text: value.text,
      previousText: before,
      participantIds: [...others],
    });
  }
  return out;
}

export function emitCommentMessages(events: CommentMessageEvent[]): void {
  for (const e of events)
    for (const fn of listeners) {
      try {
        fn(e);
      } catch (err) {
        logError('realtime: a comment listener failed', err);
      }
    }
}

/** Every user id that appears in the board's comments: message authors and @mentioned people. */
export function commentPeople(comments: Y.Map<unknown> | ReadonlyMap<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of comments.entries()) {
    if (!key.startsWith('m:') || !isMessage(value)) continue;
    out.add(value.authorId);
    for (const id of mentionedUserIds(value.text)) out.add(id);
  }
  return out;
}
