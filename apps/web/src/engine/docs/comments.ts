// Comments on a doc's blocks (KAI-162): the SAME records as on boards (@freero/shared CommentRecord,
// one small record per key, so concurrent replies, reactions and resolves merge), with a thread's
// `elementId` naming the block it is on. The server's commenter rules, @mention notifications, the
// account purge's rename and data exports therefore treat doc comments exactly like board comments.
import type { CommentMessageRecord, CommentRecord, CommentStatusRecord, CommentThreadRecord, CommentTombstone } from '@freero/shared';

export interface DocCommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorColor?: string;
  text: string;
  createdAt: number;
  editedAt?: number;
}

export interface DocThread {
  id: string;
  /** The block it is on (null: the block is gone or the thread is on the doc as a whole). */
  blockId: string | null;
  resolved: boolean;
  createdBy: string;
  createdAt: number;
  messages: DocCommentMessage[];
}

/** Assembles the records into threads, oldest first; deleted threads and messages are gone. */
export function docThreads(entries: Array<[string, unknown]>): DocThread[] {
  const threads = new Map<string, DocThread>();
  const status = new Map<string, CommentStatusRecord>();
  const dead = new Set<string>();
  const messages: CommentMessageRecord[] = [];
  for (const [, raw] of entries) {
    const r = raw as CommentRecord | null;
    if (!r || typeof r !== 'object') continue;
    if (r.kind === 'thread' && typeof r.id === 'string')
      threads.set(r.id, { id: r.id, blockId: typeof r.elementId === 'string' && r.elementId ? r.elementId : null, resolved: false, createdBy: r.createdBy, createdAt: r.createdAt ?? 0, messages: [] });
    else if (r.kind === 'status' && typeof r.threadId === 'string') status.set(r.threadId, r);
    else if (r.kind === 'deleted' && typeof r.threadId === 'string') dead.add(r.messageId ? `${r.threadId}:${r.messageId}` : r.threadId);
    else if (r.kind === 'message' && typeof r.threadId === 'string' && typeof r.text === 'string') messages.push(r);
  }
  for (const m of messages) {
    const t = threads.get(m.threadId);
    if (!t || dead.has(`${m.threadId}:${m.id}`)) continue;
    t.messages.push({ id: m.id, authorId: m.authorId, authorName: m.authorName, authorColor: m.authorColor, text: m.text, createdAt: m.createdAt, editedAt: m.editedAt });
  }
  const out: DocThread[] = [];
  for (const t of threads.values()) {
    if (dead.has(t.id) || !t.messages.length) continue;
    t.resolved = status.get(t.id)?.resolved ?? false;
    t.messages.sort((a, b) => a.createdAt - b.createdAt);
    out.push(t);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

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
