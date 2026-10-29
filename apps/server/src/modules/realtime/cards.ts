// Who a task card is assigned to and when it is due, as the server applied it (KAI-135): the
// trusted source for assignment and due-date notifications. Like comments.ts and changes.ts, only
// changes this instance applied from one of ITS sockets, on a request it served (changeBoard), or
// by a reveal it ran are reported — each once across instances — attributed to the socket's user
// or the request's actor, never to what a client claims.
//
// Confidentiality: only the shared doc is observed. A card in someone's private layer (private
// mode) or inside a hidden frame (the editors layer) is reported when it reaches the shared doc —
// a reveal moves drafts there, attributed to the draft's author (ANONYMOUS_AUTHOR for a draft
// revealed anonymously, #44: its assignee hears of it from nobody). A card arriving in the shared doc
// because it left the editors layer (its frame was shown) is not news: it is not reported.
import type * as Y from 'yjs';
import { richTextToPlain, type ActingApp } from '@freero/shared';
import { logError } from '../../platform/log';

export interface CardAssignmentEvent {
  boardId: string;
  elementId: string;
  /** Who made the change (the socket's user, the request's actor, a revealed draft's author — ANONYMOUS_AUTHOR: nobody). */
  actorId: string;
  via?: ActingApp;
  /** The card's title as plain text ('' when deleted). */
  title: string;
  assigneeId: string | null;
  previousAssigneeId: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  dueDate: string | null;
  previousDueDate: string | null;
  /** The card is gone (deleted, or moved out of the shared doc). */
  removed: boolean;
}

type Listener = (e: CardAssignmentEvent) => void;
const listeners = new Set<Listener>();

/** Called synchronously for every card assignment / due date change applied on this instance. Keep it cheap. */
export function onCardAssignment(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const hasCardListeners = (): boolean => listeners.size > 0;

export function emitCardAssignments(events: CardAssignmentEvent[]): void {
  for (const e of events)
    for (const fn of listeners) {
      try {
        fn(e);
      } catch (err) {
        logError('realtime: a card-assignment listener failed', err);
      }
    }
}

type Obj = Record<string, unknown>;
const isCard = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v) && (v as Obj).type === 'card';
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown): string | null => {
  const s = str(v);
  return s && DATE_RE.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
};

/**
 * The card assignment / due-date changes in one applied change of the shared doc's `elements`
 * map. `actorOf(card)` names who made it; `movedIn(id)`: the element just left another doc of this
 * board (a hidden frame shown), so its arrival is not a new assignment.
 */
export function cardAssignments(
  boardId: string,
  elements: Y.Map<unknown>,
  keys: Map<string, { action: 'add' | 'update' | 'delete'; oldValue: unknown }>,
  actorOf: (card: Obj) => string | null,
  movedIn: (id: string) => boolean,
  via?: ActingApp | null,
): CardAssignmentEvent[] {
  const out: CardAssignmentEvent[] = [];
  for (const [id, k] of keys) {
    const before = k.action === 'add' ? undefined : k.oldValue;
    const after = k.action === 'delete' ? undefined : elements.get(id);
    if (!isCard(before) && !isCard(after)) continue;
    const previousAssigneeId = isCard(before) ? str(before.assigneeId) : null;
    const previousDueDate = isCard(before) ? date(before.dueDate) : null;
    const base = { boardId, elementId: id, ...(via ? { via } : {}), previousAssigneeId, previousDueDate };
    if (!isCard(after)) {
      // Gone: whoever was assigned stops getting reminders.
      if (previousAssigneeId || previousDueDate)
        out.push({ ...base, actorId: actorOf(before as Obj) ?? '', title: '', assigneeId: null, dueDate: null, removed: true });
      continue;
    }
    const assigneeId = str(after.assigneeId);
    const dueDate = date(after.dueDate);
    if (assigneeId === previousAssigneeId && dueDate === previousDueDate) continue;
    if (k.action === 'add' && movedIn(id)) continue;
    const actorId = actorOf(after);
    if (!actorId) continue;
    const title = richTextToPlain(typeof after.title === 'string' ? after.title : '').trim().slice(0, 200);
    out.push({ ...base, actorId, title, assigneeId, dueDate, removed: false });
  }
  return out;
}
