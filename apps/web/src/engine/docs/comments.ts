// Comments on a doc's blocks (KAI-162): the SAME records as on boards (@freero/shared CommentRecord,
// one small record per key, so concurrent replies, reactions and resolves merge), with a thread's
// `elementId` naming the block it is on. The server's commenter rules, @mention notifications, the
// account purge's rename and data exports therefore treat doc comments exactly like board comments.
import type { CommentMessageRecord, CommentRecord, CommentStatusRecord, CommentThreadRecord, CommentTombstone } from '@freero/shared';

// The read model is shared with the server (the public API's doc comments, #61).
export { docThreads, type DocThread, type DocCommentMessage } from '@freero/shared';

export interface CommentAuthor {
  id: string;
  name: string;
  color: string;
}

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Records of a new thread on `blockId` with its first message. */
export function newThread(blockId: string | null, author: CommentAuthor, text: string, now = Date.now()): { threadId: string; records: Record<string, CommentRecord> } {
  const threadId = rid();
  const thread: CommentThreadRecord = { kind: 'thread', id: threadId, x: 0, y: 0, elementId: blockId, createdAt: now, createdBy: author.id };
  return { threadId, records: { [`t:${threadId}`]: thread, ...reply(threadId, author, text, now) } };
}

/** A reply's record. */
export function reply(threadId: string, author: CommentAuthor, text: string, now = Date.now()): Record<string, CommentRecord> {
  const id = rid();
  const message: CommentMessageRecord = { kind: 'message', threadId, id, authorId: author.id, authorName: author.name, authorColor: author.color, text, createdAt: now };
  return { [`m:${threadId}:${id}`]: message };
}

/** Resolving / reopening: anyone who may comment (attributed). */
export function setResolved(threadId: string, resolved: boolean, by: string, now = Date.now()): Record<string, CommentRecord> {
  const r: CommentStatusRecord = { kind: 'status', threadId, resolved, by, at: now };
  return { [`s:${threadId}`]: r };
}

/** Deleting a thread (its creator) or one message (its author): a tombstone, never removed. */
export function deleteRecord(threadId: string, by: string, messageId?: string, now = Date.now()): Record<string, CommentRecord> {
  const r: CommentTombstone = { kind: 'deleted', threadId, ...(messageId ? { messageId } : {}), by, at: now };
  return { [messageId ? `x:${threadId}:${messageId}` : `x:${threadId}`]: r };
}
