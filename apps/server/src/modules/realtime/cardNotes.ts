// Repair of task-card notes wiped by the card format toolbar (2026-10-27 .. the fix in 5b54a85):
// deselecting or dragging a card wrote an empty description over it, as a normal synced edit.
// The notes are still in the board's versions (board_doc_snapshots), so an operator brings them
// back with `npm run admin -- cards:restore-notes` (admin.ts).
//
// What is restored: a card that is on the board now with EMPTY notes, whose notes were non-empty
// in some version taken since `since`, gets the notes of the NEWEST such version, exactly as stored
// (rich text). A card with notes now (someone wrote them again) and a card deleted since are never
// touched, nor any field but the notes and what the wipe shrank with them: the card's height (the
// client re-measured it for the empty notes, which would clip the restored ones) and, in a kanban,
// the cards stacked below it in its column and the kanban's height, moved back down by as much.
//
// Where it is written: by the running server, never by the admin process. The admin command
// appends one outbox event per board (CARD_NOTES_TOPIC); the server's consumer (init.ts) applies it
// through changeBoard on the LIVE room, so open boards see the notes at once and a collaborator's
// next edit of the card can't silently put the empty notes back (an element is one value in the
// Yjs map: a write from a room that never saw the repair would compete with it). Without Redis an
// admin process can't reach a server's rooms; through the outbox it doesn't need to. The consumer
// re-reads the board and the versions and re-checks every card on the live board right before
// writing, so handling an event twice (or after the board changed) restores nothing twice.
import * as Y from 'yjs';
import { itemCardHeight, KANBAN_LAYOUT, richTextToPlain, type BoardElement, type CardElement, type KanbanElement } from '@freero/shared';
import { log } from '../../platform/log';
import { appendOutbox, type OutboxConsumer } from '../../platform/outbox';
import { boardRecords } from '../boards/index';
import { loadDoc, listSnapshots, loadSnapshot } from './docStore';
import { changeBoard } from './rooms';
import { viewOf, type BoardActor, type BoardChange, type BoardView } from './view';

/** The day the bug shipped (43992f6): versions before it hold nothing the wipe took. */
export const CARD_NOTES_BUG_SINCE = Date.UTC(2026, 9, 27);
export const CARD_NOTES_TOPIC = 'realtime.card_notes_restore';
export const CARD_NOTES_CONSUMER = 'card-notes-restore';

/** Who the repair is, on the board (activity: "Freero notes repair for <owner>"). */
export const NOTES_REPAIR_APP = { kind: 'app' as const, id: 'freero:restore-card-notes', name: 'Freero notes repair' };

const isEmptyNotes = (v: unknown) => !richTextToPlain(typeof v === 'string' ? v : '').trim();
const isCard = (el: BoardElement | undefined): el is CardElement => el?.type === 'card';

/** A card to give its notes back. */
export interface NotesToRestore {
  id: string;
  /** The card's title as plain text (for the operator; never the notes). */
  title: string;
  /** The notes as the version stored them (rich text). */
  description: string;
  /** The card's height and width in that version (its height fits those notes at that width). */
  h: number;
  w: number;
  /** When that version was taken (ms). */
  from: number;
  /** The card is linked to a tracker issue: the next sync writes the notes back to the issue too. */
  tracked: boolean;
}

export interface BoardVersionCards {
  at: number;
  cards: ReadonlyMap<string, BoardElement>;
}

/**
 * Pure: the cards of `now` (the board as it is) whose notes are empty, with the newest non-empty
 * notes `versions` hold for them. Cards with notes now, cards not on the board now and cards no
 * version had notes for are left out.
 */
export function findNotesToRestore(now: Iterable<BoardElement>, versions: readonly BoardVersionCards[]): NotesToRestore[] {
  const newestFirst = [...versions].sort((a, b) => b.at - a.at);
  const out: NotesToRestore[] = [];
  for (const el of now) {
    if (!isCard(el) || !isEmptyNotes(el.description)) continue;
    for (const v of newestFirst) {
      const then = v.cards.get(el.id);
      if (!isCard(then) || isEmptyNotes(then.description)) continue;
      out.push({ id: el.id, title: richTextToPlain(el.title ?? '').trim(), description: then.description, h: then.h, w: then.w, from: v.at, tracked: !!el.trackerLink });
      break;
    }
  }
  return out;
}

/** Elements of a stored state (the shared doc: what versions keep). */
function elementsOfState(state: Uint8Array): Map<string, BoardElement> {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return new Map(viewOf(doc, new Map(), { userId: '', role: 'owner' }).elements.map(({ el }) => [el.id, el]));
  } finally {
    doc.destroy();
  }
}

/**
 * The cards of a board to give their notes back, from what is SAVED now and the board's versions
 * taken since `since`. Versions are only read when some card has empty notes.
 */
export async function notesToRestoreOn(boardId: string, since = CARD_NOTES_BUG_SINCE): Promise<NotesToRestore[]> {
  const stored = await loadDoc(boardId);
  if (!stored.state) return [];
  const now = elementsOfState(stored.state);
  if (![...now.values()].some((el) => isCard(el) && isEmptyNotes(el.description))) return [];
  const versions: BoardVersionCards[] = [];
  for (const info of await listSnapshots(boardId)) {
    if (info.createdAt < since) continue;
    const state = await loadSnapshot(boardId, info.id);
    if (state) versions.push({ at: info.createdAt, cards: elementsOfState(state) });
  }
  return findNotesToRestore(now.values(), versions);
}

/** The notes of every card as SAVED now, by card id (to report what a restore did). */
export async function savedCardNotes(boardId: string): Promise<Map<string, string>> {
  const stored = await loadDoc(boardId);
  if (!stored.state) return new Map();
  return new Map([...elementsOfState(stored.state).values()].flatMap((el) => (isCard(el) ? [[el.id, el.description ?? ''] as const] : [])));
}

/**
 * Pure: the change that gives `found` their notes back on the board as it is now (`view`): only
 * cards still there with empty notes. Each grows back to the height its notes need (the version's
 * own height when the card is as wide as then); in a kanban, what is stacked below it in its
 * column moves down by as much and the kanban grows to hold its tallest column.
 */
export function planNotesRestore(view: Pick<BoardView, 'elements'>, found: readonly NotesToRestore[]): { change: BoardChange; restored: string[] } {
  const byId = new Map(view.elements.map(({ el }) => [el.id, el]));
  const patches = new Map<string, Record<string, unknown>>();
  const patch = (id: string, p: Record<string, unknown>) => patches.set(id, { ...patches.get(id), ...p });
  const grew = new Map<string, number>();
  const restored: string[] = [];
  for (const f of found) {
    const el = byId.get(f.id);
    if (!isCard(el) || !isEmptyNotes(el.description)) continue;
    restored.push(el.id);
    patch(el.id, { description: f.description });
    const want = f.w === el.w ? f.h : itemCardHeight(el.w, richTextToPlain(el.title ?? ''), richTextToPlain(f.description));
    if (want > el.h) {
      patch(el.id, { h: want });
      grew.set(el.id, want - el.h);
    }
  }
  // Kanbans: re-stack each column that holds a card that grew (its kanban's own rule: top to bottom).
  const { gap, pad, itemGap, headerH, colHeadH } = KANBAN_LAYOUT;
  const kanbanIds = new Set([...grew.keys()].map((id) => byId.get(id)?.frameId).filter((k): k is string => !!k && byId.get(k)?.type === 'kanban'));
  for (const kid of kanbanIds) {
    const k = byId.get(kid) as KanbanElement;
    if (!Array.isArray(k.columns) || !(k.colW > 0)) continue;
    const colOf = (el: BoardElement) => Math.max(0, Math.min(k.columns.length - 1, Math.floor((el.x + el.w / 2 - k.x - gap / 2) / (k.colW + gap))));
    const stacked = [...byId.values()].filter((el) => el.frameId === kid && !el.locked && el.type !== 'connector' && el.type !== 'pen' && el.type !== 'frame' && el.type !== 'kanban');
    let tallest = 0;
    const top = k.y + headerH + colHeadH + pad;
    for (let col = 0; col < k.columns.length; col++) {
      const list = stacked.filter((el) => colOf(el) === col).sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));
      let shift = 0;
      let bottom = top - itemGap;
      for (const el of list) {
        if (shift) patch(el.id, { y: el.y + shift });
        const h = el.h + (grew.get(el.id) ?? 0);
        bottom = Math.max(bottom, el.y + shift + h);
        shift += grew.get(el.id) ?? 0;
      }
      if (list.length) tallest = Math.max(tallest, bottom - top);
    }
    const h = headerH + colHeadH + tallest + 2 * pad + gap;
    if (h > k.h) patch(kid, { h });
  }
  return { change: { update: [...patches].map(([id, p]) => ({ id, patch: p })) }, restored };
}

/**
 * Gives a board's wiped notes back on the LIVE board (the server's rooms): one change, as the
 * board's owner through NOTES_REPAIR_APP. Returns the ids restored (none: nothing to do).
 */
export async function restoreNotesOn(boardId: string, since = CARD_NOTES_BUG_SINCE): Promise<string[]> {
  const found = await notesToRestoreOn(boardId, since);
  if (!found.length) return [];
  const [record] = await boardRecords([boardId]);
  if (!record) return [];
  const actor: BoardActor = { userId: record.ownerId, role: 'owner', name: 'Freero', via: NOTES_REPAIR_APP };
  const { restored } = await changeBoard(boardId, actor, (view) => planNotesRestore(view, found));
  return restored;
}

/** Asks the running server to restore a board's notes (the admin command's --apply). */
export function requestNotesRestore(boardId: string, since = CARD_NOTES_BUG_SINCE): Promise<void> {
  return appendOutbox(CARD_NOTES_TOPIC, `board:${boardId}`, { boardId, since });
}

export const cardNotesConsumer: OutboxConsumer = {
  name: CARD_NOTES_CONSUMER,
  topics: [CARD_NOTES_TOPIC],
  lockKey: 7_202_611_131, // arbitrary, constant across releases
  batchSize: 20,
  async handle(events) {
    for (const e of events) {
      const p = (e.payload ?? {}) as { boardId?: unknown; since?: unknown };
      if (typeof p.boardId !== 'string') continue;
      const restored = await restoreNotesOn(p.boardId, typeof p.since === 'number' ? p.since : CARD_NOTES_BUG_SINCE);
      if (restored.length) log(`realtime: restored the notes of ${restored.length} card(s) on board ${p.boardId}`);
    }
  },
};
