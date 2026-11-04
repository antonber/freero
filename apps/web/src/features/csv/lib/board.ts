// The board side of CSV (KAI-136): which stickies and cards a CSV holds, and putting imported rows
// on the board through the shared structure layout, in ONE transaction (one undo step). A kanban's
// cards carry their fields both ways (step 2f): exported by field name, and an import onto a new
// kanban makes its columns from one CSV column and a typed field of each other one.
import {
  COLUMN_FIELD_ID,
  COLUMN_FIELD_NAME,
  OPTION_COLORS,
  cardValue,
  collectionSchema,
  fieldNameProblem,
  fieldValueFromText,
  fieldValueToText,
  layoutStructure,
  richTextToPlain,
  splitLabels,
  storedFields,
  withOptions,
  type BoardElement,
  type CardElement,
  type FieldDef,
  type FieldValues,
  type ItemInput,
  type KanbanElement,
  type StickyElement,
  type Tag,
} from '@freero/shared';
import { nanoid } from 'nanoid';
import type { Editor, NewElement } from '@engine';
import type { FieldColumn, ImportedRow, ItemRow } from './csv';

import { t } from '../messages';
type Item = StickyElement | CardElement;
const isItem = (el: BoardElement | undefined): el is Item => el?.type === 'sticky' || el?.type === 'card';

/** The stickies and cards to export: the selection's (frames bring their contents), else the whole board; in reading order. */
export function itemsToExport(editor: Editor): Item[] {
  const sel = editor.getSelection();
  const all = editor.getElements();
  const picked = sel.length ? new Set(sel) : null;
  // A selected frame / kanban brings what is inside it (at any depth).
  for (let grew = !!picked; grew && picked; ) {
    grew = false;
    for (const el of all)
      if (!picked.has(el.id) && el.frameId && picked.has(el.frameId)) {
        picked.add(el.id);
        grew = true;
      }
  }
  return all
    .filter((el): el is Item => isItem(el) && (!picked || picked.has(el.id)))
    .sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x);
}

/** A kanban card's field values as text, by field name (Stage is the column it stands in). */
function fieldTexts(k: KanbanElement, card: CardElement, names: ReadonlyMap<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of collectionSchema(k)) out[f.name] = fieldValueToText(f, cardValue(k, card, f), (id) => names.get(id));
  return out;
}

/** Rows for the CSV: tag and frame names, assignees by name (`names`: user id → name), a kanban card's fields. */
export function toRows(editor: Editor, items: Item[], names: ReadonlyMap<string, string>): ItemRow[] {
  const tags = new Map(editor.collection<Tag>('tags').entries());
  const frameTitle = (id: string | null | undefined) => {
    const f = id ? editor.getElement(id) : undefined;
    if (!f) return '';
    if (f.type === 'frame') return f.title;
    if (f.type === 'kanban' || f.type === 'swimlane') return richTextToPlain(f.title);
    return '';
  };
  return items.map((el) => {
    const k = el.type === 'card' && el.frameId ? editor.getElement<KanbanElement>(el.frameId) : undefined;
    return {
      type: el.type,
      text: richTextToPlain(el.type === 'card' ? el.title : el.text),
      description: el.type === 'card' ? richTextToPlain(el.description) : '',
      color: el.color,
      tags: (el.tags ?? []).map((id) => tags.get(id)?.name).filter((n): n is string => !!n),
      status: el.type === 'card' ? (el.status ?? '') : '',
      assignee: el.type === 'card' && el.assigneeId ? (names.get(el.assigneeId) ?? '') : '',
      due: el.type === 'card' ? (el.dueDate ?? '') : '',
      frame: frameTitle(el.frameId),
      ...(el.type === 'card' && el.back ? { back: richTextToPlain(el.back.title) } : {}),
      ...(k?.type === 'kanban' && el.type === 'card' ? { fields: fieldTexts(k, el, names) } : {}),
    };
  });
}

/**
 * Lays the rows out (a grid, or a kanban by status) on a free spot of the board and creates them,
 * tags included, as one undo step. Returns the ids of what was created.
 */
export function placeRows(editor: Editor, rows: ImportedRow[], layout: 'grid' | 'kanban', title: string): string[] {
  const items: ItemInput[] = rows.map((r) => r.item);
  const laid = layoutStructure({ kind: 'items', items, layout, title }, { newId: () => nanoid(10) });
  // Items come after the kanban (when there is one), in row order.
  return create(editor, laid, rows, layout === 'kanban' ? 1 : 0);
}

function create(editor: Editor, laid: { elements: unknown[]; size: { w: number; h: number } }, rows: ImportedRow[], offset: number, order?: number[]): string[] {
  const spot = editor.findFreeSpot(laid.size);
  const created = laid.elements.map((d) => {
    const e = d as { x: number; y: number };
    return { ...e, x: e.x + spot.x, y: e.y + spot.y } as unknown as NewElement;
  });
  let ids: string[] = [];
  editor.transact(() => {
    ids = editor.createMany(created);
    // `order[i]`: the row element i + offset stands for (a kanban lays rows out column by column).
    const rowOf = (i: number) => rows[order ? order[i] : i];
    const tagged = ids.slice(offset).flatMap((id, i) => (rowOf(i)?.tagNames.length ? [{ id, names: rowOf(i).tagNames }] : []));
    if (tagged.length) editor.runCommand('tags.applyNames', { items: tagged });
  });
  return ids;
}

export interface KanbanImport {
  /** The CSV column the kanban's columns are (its distinct values, in the order they first come). */
  columnsFrom: number;
  /** What each other column becomes. */
  fields: FieldColumn[];
  /** The name the Stage field gets (the column's header, unless a card's own field has it). */
  stageName?: string;
  /** A member's id by name or email, for person fields. */
  personId?(nameOrEmail: string): string | undefined;
}

/** The column a row without a value for the columns goes to. */
export const NO_STAGE = t('noStage');

/**
 * Rows onto a NEW kanban with fields: a column per distinct value of `spec.columnsFrom` (with the
 * status its title stands for, as when a kanban is made from a list of columns), a field of the
 * chosen type per other column — select options from its distinct labels — and every card with
 * its values. One undo step, like any import. Returns the kanban's id and its cards' ids.
 */
export function placeRowsOnKanban(editor: Editor, rows: ImportedRow[], spec: KanbanImport, title: string): string[] {
  const cell = (r: ImportedRow, i: number) => (r.cells[i] ?? '').trim();
  const columns: string[] = [];
  const columnOf = rows.map((r) => {
    const v = cell(r, spec.columnsFrom).slice(0, 100) || NO_STAGE;
    const i = columns.findIndex((c) => c.toLowerCase() === v.toLowerCase());
    if (i >= 0) return i;
    columns.push(v);
    return columns.length - 1;
  });

  // The fields, with select options from the labels their cells have.
  const stageName = spec.stageName?.trim() && !fieldNameProblem([], spec.stageName) ? spec.stageName.trim().slice(0, 60) : COLUMN_FIELD_NAME;
  const schema: FieldDef[] = [{ id: COLUMN_FIELD_ID, name: stageName, type: 'select' }];
  const used: Array<{ def: FieldDef; column: number }> = [];
  for (const fc of spec.fields) {
    if (fc.type === 'skip' || fieldNameProblem(schema, fc.name)) continue;
    const def: FieldDef = { id: nanoid(8), name: fc.name.trim().slice(0, 60), type: fc.type };
    if (fc.type === 'select' || fc.type === 'multiselect') {
      const labels = rows.flatMap((r) => (fc.type === 'multiselect' ? splitLabels(cell(r, fc.column)) : [cell(r, fc.column)])).filter(Boolean);
      def.options = withOptions([], labels.slice(0, 2000), () => nanoid(8), (_l, i) => OPTION_COLORS[(i + 1) % OPTION_COLORS.length]).slice(0, 200);
    }
    schema.push(def);
    used.push({ def, column: fc.column });
  }

  // Cards column by column, in row order within each (how the layout stacks them).
  const order = columns.flatMap((_, ci) => rows.flatMap((_r, i) => (columnOf[i] === ci ? [i] : [])));
  const laid = layoutStructure(
    { kind: 'kanban', title, columns: columns.map((c, ci) => ({ title: c, items: order.filter((i) => columnOf[i] === ci).map((i) => cardInput(rows[i].item)) })) },
    { newId: () => nanoid(10) },
  );
  const values = rows.map((r) => {
    const out: FieldValues = {};
    for (const { def, column } of used) {
      const v = fieldValueFromText(def, cell(r, column), { personId: spec.personId });
      if (v !== null && v !== undefined) out[def.id] = v;
    }
    return out;
  });
  const [kanban, ...cards] = laid.elements;
  // Cards show the short fields (long text and links stay in card details), at most four.
  const SHORT = new Set(['select', 'multiselect', 'number', 'date', 'checkbox', 'person']);
  const shown = [...used.filter((u) => SHORT.has(u.def.type)).slice(0, 4).map((u) => u.def.id), '$assignee', '$due', '$tags'];
  const elements = [
    { ...kanban, fields: storedFields(schema), views: [{ id: 'board', name: 'Board', layout: 'board', card: { show: shown, density: 'comfortable', color: 'own' } }], activeView: 'board' },
    ...cards.map((d, i) => {
      const row = rows[order[i]];
      const v = values[order[i]];
      return { ...d, assigneeId: row.item.assigneeId ?? null, ...(Object.keys(v).length ? { values: v } : {}) };
    }),
  ];
  return create(editor, { elements, size: laid.size }, rows, 1, order);
}

/** A row's card for the kanban layout (its column's status wins, as a drop would). */
const cardInput = (it: ItemInput) => ({ text: it.text, description: it.description ?? '', status: it.status ?? null, dueDate: it.dueDate ?? null, ...(it.link ? { link: it.link } : {}) });
