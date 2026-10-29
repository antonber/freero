// Item and comment events from a board's SAVED shared content (pure): what changed between the
// last state the deriver saw and the board now. Recompute, not patch — so however many saves a
// drag made, and however often a batch is replayed, one settled comparison yields one answer.
//
// Only what every reader of the board sees takes part (realtime's storedBoardView: no private
// layer, nothing under a hidden frame), so a draft becomes `item.created` when it is revealed into
// the shared doc, and an item hidden in a frame reads as deleted (it left what everyone sees).
import { createHash } from 'node:crypto';
import { EVENT_TEXT_MAX, isAnonymousAuthor, type BoardElement, type CommentEventData, type FreeroEventType, type ItemEventData } from '@freero/shared';

export interface ItemNow {
  fingerprint: string;
  type: string;
  text: string;
  createdBy: string;
  /** The app or token that created it for `createdBy` (KAI-168), when one did. */
  via: { id: string; name: string } | null;
  /** The frame or kanban it sits in directly (`frameId`), or null (KAI-249: webhooks scoped to one). */
  container: string | null;
}
export interface MessageNow {
  threadId: string;
  messageId: string;
  itemId: string | null;
  /** The container of the item the thread is pinned to. */
  container: string | null;
  authorId: string;
  authorName: string;
  text: string;
}
export interface BoardNow {
  items: Map<string, ItemNow>;
  /** Keyed `<threadId>:<messageId>`. */
  messages: Map<string, MessageNow>;
}
/** What is stored between two comparisons. */
export interface StoredState {
  /** Element id → [fingerprint, element type, its container (absent: none, or saved before KAI-249)]. */
  items: Record<string, [string, string] | [string, string, string]>;
  messages: string[];
}

export interface DerivedEvent {
  type: FreeroEventType;
  /** The item it is about (comments: the message's item, if any). */
  elementId: string | null;
  actor: { kind: 'user'; id: string } | { kind: 'agent'; id: string; app: string } | null;
  data: ItemEventData | CommentEventData;
}

/** Most item events one comparison reports (a pasted template of 2 000 items is not 2 000 posts). */
export const MAX_EVENTS_PER_CHANGE = 500;

export const clip = (s: string) => (s.length > EVENT_TEXT_MAX ? `${s.slice(0, EVENT_TEXT_MAX - 1)}…` : s);

/** A fingerprint of everything stored on an element (any field changing is an update). */
export function fingerprintOf(el: BoardElement): string {
  return createHash('sha1').update(JSON.stringify(el)).digest('base64url').slice(0, 16);
}

/**
 * The events between `prev` and `now`, and the state to store. No previous state (a board the
 * deriver never saw, e.g. from before events existed): a silent baseline — nothing it held before
 * is news. A board created after that starts from an empty state (its `board.created` event), so
 * its first items ARE news.
 */
export function diffBoard(prev: StoredState | null, now: BoardNow): { events: DerivedEvent[]; next: StoredState } {
  const next: StoredState = {
    items: Object.fromEntries([...now.items].map(([id, i]) => [id, i.container ? [i.fingerprint, i.type, i.container] : [i.fingerprint, i.type]])),
    messages: [...now.messages.keys()],
  };
  if (!prev) return { events: [], next };
  const events: DerivedEvent[] = [];
  const item = (id: string, i: Pick<ItemNow, 'type' | 'text' | 'container'>): ItemEventData => ({
    item: { id, type: i.type, ...(i.text ? { text: clip(i.text) } : {}), ...(i.container ? { containerId: i.container } : {}) },
  });
  for (const [id, i] of now.items) {
    const before = prev.items[id]?.[0];
    if (before === i.fingerprint) continue;
    if (before === undefined) {
      // A draft revealed anonymously from private mode (#44) was created by nobody anyone may know.
      const actor = isAnonymousAuthor(i.createdBy) ? null : i.via ? { kind: 'agent' as const, id: i.createdBy, app: i.via.name } : { kind: 'user' as const, id: i.createdBy };
      events.push({ type: 'item.created', elementId: id, actor, data: item(id, i) });
    } else events.push({ type: 'item.updated', elementId: id, actor: null, data: item(id, i) });
  }
  for (const [id, [, type, container]] of Object.entries(prev.items))
    if (!now.items.has(id)) events.push({ type: 'item.deleted', elementId: id, actor: null, data: { item: { id, type, ...(container ? { containerId: container } : {}) } } });
  const seen = new Set(prev.messages);
  for (const [key, m] of now.messages) {
    if (seen.has(key)) continue;
    events.push({
      type: 'comment.created',
      elementId: m.itemId,
      actor: { kind: 'user', id: m.authorId },
      data: { threadId: m.threadId, messageId: m.messageId, itemId: m.itemId, ...(m.container ? { containerId: m.container } : {}), text: clip(m.text) },
    });
  }
  return { events: events.slice(0, MAX_EVENTS_PER_CHANGE), next };
}
