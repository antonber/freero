// A card's field values: the schema of the kanban it is in (if any) and the one write path for
// them (`card.setValues`). The card feature never lays cards out: a new value for the field the
// kanban is grouped by ("Stage", or another select, a person or a checkbox) is a move to that
// column, which it asks the kanban to make.
import {
  builtinPatch,
  canonicalValue,
  cardValue,
  collectionSchema,
  groupFieldId,
  groupKeyOf,
  isBuiltinFieldId,
  type CardElement,
  type FieldDef,
  type KanbanElement,
} from '@freero/shared';
import type { Editor } from '@engine';

/** The kanban a card is in and that kanban's fields; null for a card outside any kanban. */
export function cardCollection(editor: Pick<Editor, 'getElement'>, card: CardElement): { kanban: KanbanElement; schema: FieldDef[] } | null {
  const k = card.frameId ? editor.getElement(card.frameId) : undefined;
  return k?.type === 'kanban' ? { kanban: k, schema: collectionSchema(k) } : null;
}

/** Writes `values` (field id → value, null clears) on card `id`, in one undo step. */
export function setValues(editor: Editor, id: string, values: Record<string, unknown>) {
  const card = editor.getElement<CardElement>(id);
  if (!card || card.type !== 'card' || card.locked) return;
  const coll = cardCollection(editor, card);
  const patch: Partial<CardElement> = {};
  const next = { ...(card.values ?? {}) };
  let changed = false;
  let column: string | null = null;
  for (const [fid, raw] of Object.entries(values)) {
    if (isBuiltinFieldId(fid)) {
      const p = builtinPatch(fid, raw);
      if (p) Object.assign(patch, p);
      continue;
    }
    const f = coll?.schema.find((x) => x.id === fid);
    const v = f ? canonicalValue(f, raw) : undefined;
    if (!f || v === undefined) continue;
    if (f.id === groupFieldId(coll!.kanban)) {
      // The column it stands in IS this value: a move ("No <field>" for none).
      const cur = cardValue(coll!.kanban, card, f);
      if (JSON.stringify(cur) !== JSON.stringify(v)) column = groupKeyOf(f, v);
      continue;
    }
    if (v === null) {
      if (Object.hasOwn(next, fid)) delete next[fid];
      else continue;
    } else if (JSON.stringify(next[fid]) === JSON.stringify(v)) continue;
    else next[fid] = v;
    changed = true;
  }
  if (changed) patch.values = next;
  // A start after the due date is refused, as card.setDates does.
  const start = 'startDate' in patch ? patch.startDate : card.startDate;
  const due = 'dueDate' in patch ? patch.dueDate : card.dueDate;
  if (start && due && start > due) {
    delete patch.startDate;
    delete patch.dueDate;
  }
  if (!Object.keys(patch).length && !column) return;
  editor.transact(() => {
    if (Object.keys(patch).length) editor.update<CardElement>(id, patch);
    if (column) editor.runCommand('kanban.moveToColumn', { id, column });
  });
}
