// The event stream (KAI-150): one ordered record of what happens to boards, fed only through the
// outbox, so an event exists exactly when its change committed and none is lost to a crash.
//
//   boards   board.events    (created, renamed, moved, trashed, restored)  → recorded as they are
//   members  board.members   (added, role changed, removed)                → recorded as they are
//   realtime board.content   (a save of the shared doc)                    → the board waits to settle,
//            then its saved content is compared with what the deriver saw last: item.created /
//            item.updated / item.deleted, comment.created (derive.ts)
//
// Every recorded event raises `event.recorded` on the outbox (same transaction) for the stream's
// consumers (webhooks). Notifications and the activity feed still run on the in-process events
// (they need the live socket attribution and per-instance bursts those carry); moving them onto
// this stream is a later step (see docs/events.md).
import { randomUUID } from 'node:crypto';
import {
  formatObjectUri,
  mentionsAsNames,
  type BoardElement,
  type BoardEventData,
  type CommentMessageRecord,
  type CommentThreadRecord,
  type MemberEventData,
  type OutlineItem,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { log } from '../../platform/log';
import { type OutboxConsumer } from '../../platform/outbox';
import { getUsers } from '../auth/index';
import { BOARD_EVENTS_TOPIC, boardRecords, boardWorkspaceId, type BoardEventRecord } from '../boards/index';
import { MEMBER_EVENTS_TOPIC, type MemberEventRecord } from '../members/index';
import { outlineOfView } from '../outline/index';
import { BOARD_CONTENT_TOPIC, COMMENTS_COLLECTION, storedBoardView } from '../realtime/index';
import { diffBoard, fingerprintOf, type BoardNow, type ItemNow, type MessageNow } from './derive';
import * as repo from './repo';

export const EVENTS_CONSUMER = 'events';
const LOCK_KEY = 7_202_611_111; // arbitrary, constant across releases
/** Someone editing without pause still produces events this often. */
const MAX_WAIT_MS = 60_000;
const boardUri = (id: string) => formatObjectUri({ type: 'board', id });

function boardEvent(key: string, r: BoardEventRecord): repo.NewEvent {
  const data: BoardEventData = { title: r.title };
  if (r.from !== undefined) data.from = r.from;
  if (r.to !== undefined) data.to = r.to;
  if (r.copyOf) data.copyOf = r.copyOf;
  return { sourceKey: `outbox:${key}`, type: r.type, workspaceId: r.workspaceId, boardId: r.boardId, objectUri: boardUri(r.boardId), actor: { kind: 'user', id: r.actorId }, data, at: r.at };
}

function memberEvent(key: string, r: MemberEventRecord, workspaceId: string): repo.NewEvent {
  const data: MemberEventData = { userId: r.userId };
  if (r.role) data.role = r.role;
  if (r.type === 'member.role_changed') data.previousRole = r.previousRole;
  return {
    sourceKey: `outbox:${key}`,
    type: r.type,
    workspaceId,
    boardId: r.boardId,
    objectUri: boardUri(r.boardId),
    actor: r.actorId ? { kind: 'user', id: r.actorId } : { kind: 'system', id: null },
    data,
    at: r.at,
  };
}

/** The outbox consumer: records board and membership events, and queues saved boards for comparison. */
export const eventsConsumer: OutboxConsumer = {
  name: EVENTS_CONSUMER,
  topics: [BOARD_CONTENT_TOPIC, BOARD_EVENTS_TOPIC, MEMBER_EVENTS_TOPIC],
  lockKey: LOCK_KEY,
  batchSize: 200,
  async handle(events) {
    const saved = new Set<string>();
    for (const e of events) {
      if (e.topic === BOARD_CONTENT_TOPIC) {
        if (e.key.startsWith('board:')) saved.add(e.key.slice('board:'.length));
      } else if (e.topic === BOARD_EVENTS_TOPIC) {
        const r = e.payload as BoardEventRecord;
        // A new board starts from an empty state: its first items are news.
        if (r.type === 'board.created') await repo.startEmptyState(r.boardId);
        await repo.recordEvents([boardEvent(e.key, r)]);
      } else if (e.topic === MEMBER_EVENTS_TOPIC) {
        const r = e.payload as MemberEventRecord;
        const ws = await boardWorkspaceId(r.boardId);
        if (ws) await repo.recordEvents([memberEvent(e.key, r, ws)]);
      }
    }
    const { settleMs } = getConfig().events;
    await repo.markPending([...saved], Date.now(), settleMs, MAX_WAIT_MS);
  },
};

// ---- comparing saved content ----

/** Short plain text of each item as the outline reads it (its title and text, a connector's label). */
function itemTexts(items: OutlineItem[], edges: Array<{ id: string; label?: string }>): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: OutlineItem[]) => {
    for (const i of list) {
      const text = [i.title, i.text].filter((s): s is string => !!s && !!s.trim()).join(' — ');
      if (text && !out.has(i.id)) out.set(i.id, text.replace(/\s+/g, ' ').trim());
      // A cluster's title is a text item folded into it.
      if (i.kind === 'cluster' && i.title) out.set(i.id.slice('cluster:'.length), i.title);
      walk(i.children ?? []);
    }
  };
  walk(items);
  for (const e of edges) if (e.label) out.set(e.id, e.label);
  return out;
}

/** The board's saved shared content as the deriver compares it. */
async function boardNow(boardId: string, title: string): Promise<BoardNow> {
  const view = await storedBoardView(boardId);
  if (!view) return { items: new Map(), messages: new Map() };
  const outline = await outlineOfView({ id: boardId, title }, view);
  const texts = itemTexts(outline.items, outline.edges);
  const items = new Map<string, ItemNow>();
  for (const { el } of view.elements) {
    const via = (el as BoardElement).createdVia;
    items.set(el.id, {
      fingerprint: fingerprintOf(el),
      type: el.type,
      text: texts.get(el.id) ?? '',
      createdBy: el.createdBy,
      via: via && typeof via.name === 'string' ? { id: via.id, name: via.name } : null,
    });
  }
  // Comments pinned to an item that is not in the view (inside a hidden frame) are withheld from
  // some readers of the board: they are no event. (Their records live in the editors layer since
  // KAI-234; a board saved before that keeps them in the shared doc until it is next loaded.)
  const threads = new Map<string, string | null>();
  const comments = view.collection(COMMENTS_COLLECTION);
  for (const v of comments.values()) {
    const t = v as Partial<CommentThreadRecord> | null;
    if (t?.kind === 'thread' && typeof t.id === 'string') threads.set(t.id, typeof t.elementId === 'string' && t.elementId ? t.elementId : null);
  }
  const messages = new Map<string, MessageNow>();
  for (const v of comments.values()) {
    const m = v as Partial<CommentMessageRecord> | null;
    if (m?.kind !== 'message' || typeof m.threadId !== 'string' || typeof m.id !== 'string' || typeof m.text !== 'string') continue;
    if (!threads.has(m.threadId)) continue;
    const itemId = threads.get(m.threadId) ?? null;
    if (itemId && !items.has(itemId)) continue;
    messages.set(`${m.threadId}:${m.id}`, { threadId: m.threadId, messageId: m.id, itemId, authorId: String(m.authorId ?? ''), authorName: String(m.authorName ?? ''), text: m.text });
  }
  return { items, messages };
}

/** Compares one settled board with what was seen last and records what changed. */
export async function deriveBoardEvents(boardId: string, dueAt: Date): Promise<number[]> {
  const [record] = await boardRecords([boardId]);
  if (!record) return repo.applyDerivation(boardId, dueAt, [], null);
  const prev = await repo.stateOf(boardId);
  const now = await boardNow(boardId, record.title);
  const { events, next } = diffBoard(prev, now);
  // Mentions read as the person's current name (people the board's comments show).
  const mentioned = new Set<string>();
  for (const e of events) if (e.type === 'comment.created') for (const m of (e.data as { text: string }).text.matchAll(/<@([A-Za-z0-9_-]{1,64})>/g)) mentioned.add(m[1]);
  const names = mentioned.size ? await getUsers([...mentioned]) : new Map();
  const at = Date.now();
  const rows: repo.NewEvent[] = events.map((e) => {
    const data = e.type === 'comment.created' ? { ...e.data, text: mentionsAsNames((e.data as { text: string }).text, (id) => names.get(id)?.name) } : e.data;
    return {
      sourceKey: `derive:${randomUUID()}`,
      type: e.type,
      workspaceId: record.workspaceId,
      boardId,
      objectUri: e.elementId ? formatObjectUri({ type: 'element', boardId, id: e.elementId }) : boardUri(boardId),
      actor: e.actor ? { kind: e.actor.kind, id: e.actor.id, app: e.actor.kind === 'agent' ? e.actor.app : null } : null,
      data,
      at,
    };
  });
  return repo.applyDerivation(boardId, dueAt, rows, next);
}

/** Compares every board whose saved content settled by `now` (the derive job; tests call it). Returns how many events were recorded. */
export async function deriveDueBoards(now = Date.now(), limit = 50): Promise<number> {
  let recorded = 0;
  for (const { boardId, dueAt } of await repo.duePending(now, limit)) recorded += (await deriveBoardEvents(boardId, dueAt)).length;
  return recorded;
}

/** Retention (EVENTS_RETENTION_DAYS). */
export async function pruneEvents(now = Date.now()): Promise<number> {
  const n = await repo.pruneEventsBefore(now - getConfig().events.retentionDays * 86_400_000);
  if (n) log(`events: pruned ${n} event(s) past retention`);
  return n;
}
