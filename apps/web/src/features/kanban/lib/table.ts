// The kanban's cards as a table (step 3a): its columns (the title, then fields), what each cell
// holds and how an edit is written. The table never writes a card itself: every edit is one
// `card.setValues` (the card feature's one write path for card fields, which asks the kanban to
// move a card whose grouped value changed), so a table edit and a card-details edit are the same.
import {
  BUILTIN_FIELDS,
  STATUS_OPTIONS,
  builtinValue,
  cardValue,
  isBuiltinFieldId,
  parseNumberText,
  richTextToPlain,
  valueText,
  type CardElement,
  type FieldDef,
  type FieldOption,
  type FieldType,
  type FieldValue,
  type KanbanElement,
  type Tag,
} from '@freero/shared';
import type { Editor } from '@engine';

export interface GridColumn {
  /** The field: a custom field id or a built-in one ($title first). */
  id: string;
  name: string;
  type: FieldType | 'timestamp';
  options?: readonly FieldOption[];
  /** Created / updated: shown, never edited. */
  readOnly: boolean;
  width: number;
}

const WIDTHS: Record<GridColumn['type'], number> = {
  select: 150,
  multiselect: 190,
  person: 160,
  date: 136,
  number: 104,
  text: 200,
  url: 200,
  checkbox: 96,
  timestamp: 136,
};
export const TITLE_WIDTH = 280;

/** The table's columns: the title, then `ids` (fields of `schema` or built-in ones) in order. */
export function gridColumns(ids: readonly string[], schema: readonly FieldDef[], tags: ReadonlyMap<string, Tag>): GridColumn[] {
  const out: GridColumn[] = [{ id: '$title', name: 'Title', type: 'text', readOnly: false, width: TITLE_WIDTH }];
  for (const id of ids) {
    if (id === '$title') continue;
    if (isBuiltinFieldId(id)) {
      const b = BUILTIN_FIELDS.find((f) => f.id === id)!;
      const options = id === '$status' ? STATUS_OPTIONS : id === '$tags' ? [...tags.values()].map((t) => ({ id: t.id, label: t.name, color: t.color })) : undefined;
      out.push({ id, name: b.name, type: b.type, ...(options ? { options } : {}), readOnly: !!b.readOnly, width: WIDTHS[b.type] });
      continue;
    }
    const f = schema.find((x) => x.id === id);
    if (f) out.push({ id: f.id, name: f.name, type: f.type, ...(f.options ? { options: f.options } : {}), readOnly: false, width: WIDTHS[f.type] });
  }
  return out;
}

/** What card `card` holds for column `col` of kanban `k` (null: nothing). */
export function cellValue(k: KanbanElement, card: CardElement, col: GridColumn, schema: readonly FieldDef[]): FieldValue | null {
  if (col.id === '$title') return richTextToPlain(card.title) || null;
  if (isBuiltinFieldId(col.id)) return builtinValue(card, col.id);
  const f = schema.find((x) => x.id === col.id);
  return f ? cardValue(k, card, f) : null;
}

const day = (ms: number) => {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
};

/** A cell's value in words (what a screen reader hears, and what text cells show). */
export function cellText(col: GridColumn, v: FieldValue | null, personName: (id: string) => string | undefined): string {
  if (v === null || v === undefined) return '';
  if (col.type === 'timestamp') return typeof v === 'number' ? day(v) : '';
  if (col.type === 'checkbox') return v === true ? 'Yes' : '';
  if (col.type === 'person') return typeof v === 'string' ? (personName(v) ?? 'Someone') : '';
  return valueText({ type: col.type, options: col.options as FieldOption[] | undefined }, v, personName);
}

/** The options a select / multi-select cell holds, in their order. */
export function cellOptions(col: GridColumn, v: FieldValue | null): FieldOption[] {
  const ids = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  return (col.options ?? []).filter((o) => ids.includes(o.id));
}

/**
 * Writes `raw` (what the cell's editor produced) into card `card`'s field `col`: one
 * `card.setValues`, one undo step. A number typed in words is read the way CSV and agents' words
 * are (`parseNumberText`: "1,200" too); an emptied box clears the field. Returns false when the
 * text can't be a number.
 */
export function writeCell(editor: Editor, card: CardElement, col: GridColumn, raw: FieldValue | null): boolean {
  if (col.readOnly || card.locked) return false;
  let value: unknown = raw;
  if (col.type === 'number' && typeof raw === 'string') {
    if (!raw.trim()) value = null;
    else {
      const n = parseNumberText(raw);
      if (n === null) return false;
      value = n;
    }
  }
  if (typeof value === 'string' && !value.trim() && col.id !== '$title') value = null;
  editor.runCommand('card.setValues', { id: card.id, values: { [col.id]: value } });
  return true;
}
