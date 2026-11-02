// Grouping a kanban by a field (docs/design/kanban-fields-and-views.md, step 2c): the columns are
// the values of the board view's `groupBy` (a single select — "Stage" by default —, a person or a
// checkbox field), and swimlanes the values of its `subGroupBy`. The group field's options live in
// `columns` (older clients and the server keep stacking by them) and a card's value for it is the
// column it stands in; every other field's values are stored on the cards, a swimlane's too.
//
// Switching `groupBy` is one transaction (one undo step): the old group field's values are written
// onto the cards from where they stand, its options go back into its `fields` entry, the new
// field's options become the columns (its stored values are dropped: the column says it now), and
// each card moves to the column of its value. Column settings (WIP, collapsed, card limit) are
// kept per field in the view (`groupSettings`) for when the board is grouped by it again.
import { COLUMN_FIELD_ID, boardView, collectionSchema, isGroupable, planGroupBy, savedViews, type KanbanElement } from '@freero/shared';
import type { Editor, ElementPatch } from '@engine';
import { viewEditable } from './view';

export { groupKeys, groupTitle, storedKey } from '@freero/shared';

/** Fields the board can be grouped by (and swimlanes made of). */
export const groupableFields = (k: KanbanElement) => collectionSchema(k).filter(isGroupable);

/** True when the columns are a select field's options (they can be added, renamed and deleted). */
export function columnsAreOptions(k: KanbanElement): boolean {
  const gid = boardView(k).groupBy ?? COLUMN_FIELD_ID;
  return gid === COLUMN_FIELD_ID || collectionSchema(k).find((f) => f.id === gid)?.type === 'select';
}

function editable(editor: Editor, id: string): KanbanElement | null {
  const k = editor.getElement<KanbanElement>(id);
  return k && k.type === 'kanban' && !k.locked ? k : null;
}

/** Groups the board by field `fieldId` (@freero/shared `planGroupBy`: see the header). One undo step; false when nothing changed. */
export function setGroupBy(editor: Editor, kid: string, fieldId: string): boolean {
  const k = editable(editor, kid);
  if (!k || !viewEditable(editor, k)) return false;
  const plan = planGroupBy(k, editor.getElements(), fieldId);
  if (!plan) return false;
  editor.transact(() => {
    editor.update<KanbanElement>(k.id, plan.kanban);
    if (plan.values.length) editor.updateMany(plan.values as Array<{ id: string; patch: ElementPatch }>);
    if (plan.moves.length) editor.moveBy(plan.moves);
  });
  return true;
}

/** Swimlanes by field `fieldId` (null: none). Saved for everyone (it moves the cards); one undo step with the re-stack. */
export function setSwimlanes(editor: Editor, kid: string, fieldId: string | null): boolean {
  const k = editable(editor, kid);
  if (!k || !viewEditable(editor, k)) return false;
  const view = boardView(k);
  if ((view.subGroupBy ?? null) === fieldId) return false;
  if (fieldId) {
    const f = collectionSchema(k).find((x) => x.id === fieldId);
    if (!f || !isGroupable(f) || fieldId === view.groupBy) return false;
  }
  editor.update<KanbanElement>(k.id, { ...savedViews(k, { ...view, subGroupBy: fieldId }), ...(fieldId ? {} : { lanes: null }) });
  return true;
}
