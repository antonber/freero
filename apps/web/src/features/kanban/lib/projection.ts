// What the list, calendar and timeline tabs write (step 3b) — always through the card feature's one
// write path for card fields (`card.setValues`: one undo step, live for everyone; a new value for
// the field the board is grouped by moves the real card, as card details do). Where a card goes is
// worked out by @freero/shared projections.ts (dates) and tabs.ts (groups); this only asks.
import {
  boardView,
  calendarMoveValues,
  cardAccent,
  collectionSchema,
  groupKeyOf,
  groupKeyValue,
  groupKeys,
  projectionGroupValue,
  spanValues,
  timelineLayout as T,
  type CardElement,
  type DaySpan,
  type FieldDef,
  type KanbanElement,
} from '@freero/shared';
import type { Editor } from '@engine';

/** Today on this device, as a day number. */
export const today = (): number => T.dayOf(T.localDay(Date.now()));

/** A card's colour in a projection: as the board colours it (by column, a field, status), else its own. */
export const accentOf = (k: KanbanElement, card: CardElement, schema: readonly FieldDef[] = collectionSchema(k)): string => cardAccent(k, card, boardView(k), schema) ?? card.color ?? '#5B3FF0';

const writable = (card: CardElement) => !card.locked;

/** Puts card `card` on day `iso` (null: no date) of a calendar placed by field `ref`; false when nothing changed. */
export function moveToDay(editor: Editor, k: KanbanElement, card: CardElement, ref: string, iso: string | null): boolean {
  if (!writable(card)) return false;
  const values = calendarMoveValues(k, card, ref, iso, collectionSchema(k));
  if (!values) return false;
  editor.runCommand('card.setValues', { id: card.id, values });
  return true;
}

/** Writes bar `span` onto card `card` (its `startRef` and `endRef` dates): one undo step. */
export function writeBar(editor: Editor, card: CardElement, startRef: string, endRef: string, span: DaySpan): void {
  if (!writable(card)) return;
  editor.runCommand('card.setValues', { id: card.id, values: spanValues(startRef, endRef, span) });
}

/**
 * Moves card `card` to the previous (-1) or next (1) group of field `f` (a grouped list: the
 * field's options in order, "No <field>" first; people the list has): one card.setValues.
 */
export function moveToGroup(editor: Editor, k: KanbanElement, card: CardElement, f: FieldDef, dir: 1 | -1, present: Iterable<string>): boolean {
  if (!writable(card)) return false;
  const cur = groupKeyOf(f, projectionGroupValue(k, card, f));
  const keys = groupKeys(f, present);
  const i = keys.indexOf(cur);
  const next = keys[i + dir];
  if (i < 0 || next === undefined) return false;
  editor.runCommand('card.setValues', { id: card.id, values: { [f.id]: groupKeyValue(f, next) } });
  return true;
}
