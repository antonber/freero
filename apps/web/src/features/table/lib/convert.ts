// Table ↔ kanban (step 3e, docs/design/kanban-fields-and-views.md, decision 4: the table stays a
// free-form sheet). "Convert to kanban" reads this table and hands the rows to the kanban feature
// (`kanban.createFromRows`), which makes the kanban and its cards: the table never writes kanban
// elements. "Copy as table" reads a kanban through @freero/shared (`collectionSchema`,
// `cardValue`) and makes a table of its own, a snapshot that doesn't follow the cards.
import { nanoid } from 'nanoid';
import {
  BUILTIN_FIELDS,
  builtinValue,
  cardValue,
  collectionSchema,
  fieldNameProblem,
  inferFieldType,
  isMember,
  kanbanColumnAt,
  kanbanLaneAt,
  labelKey,
  parseCheckboxText,
  parseDateText,
  parseNumberText,
  plainToRichText,
  richTextToPlain,
  splitLabels,
  type BoardElement,
  type FieldType,
  type KanbanElement,
  type KanbanRowsInput,
  type TableColumn,
  type TableColumnType,
  type TableElement,
  type Tag,
} from '@freero/shared';
import type { Editor } from '@engine';
import { displayValue, isValid, OPTION_COLORS, typeOf, valueFor, type PeopleLookup } from './columns';
import { CELLS, cellText, setCellText } from './cells';
import { fitColumnWidths, newTable } from './model';
import { fitRows } from './actions';

import { t as tr } from '../messages';
/** The dialog that converts a table (panel.tsx). Props: { id }. */
export const CONVERT_DIALOG = 'table.convert';

/** Most columns a kanban has (the shared kanban structure's limit). */
export const MAX_KANBAN_COLUMNS = 40;

// A table's select tints and the kanban option palette, pairwise (same hue), so colours survive both ways.
const KANBAN_HUES = ['#8B5CF6', '#2E9BF0', '#1FA463', '#F5A524', '#E5484D', '#E64DA6', '#8A89A3'];
const toKanbanColor = (tint: string) => KANBAN_HUES[OPTION_COLORS.indexOf(tint)];
const toTint = (hue: string, i: number) => OPTION_COLORS[KANBAN_HUES.indexOf(hue.toUpperCase())] ?? OPTION_COLORS[i % OPTION_COLORS.length];

/** Which column the kanban's columns come from and which one titles the cards (column ids). */
export interface ConvertChoice {
  columnsFrom: string;
  titleFrom: string;
}

/** What a table column becomes on the kanban, for the dialog to say. */
export interface ColumnFate {
  colId: string;
  name: string;
  /** 'columns' / 'title' (the choice), a card's own field, or a field of `type`. */
  as: 'columns' | 'title' | 'description' | 'assignee' | 'due' | 'start' | 'estimate' | 'link' | 'field';
  type?: FieldType;
}

type Get = (rowId: string, colId: string) => string;

/** The columns' names: the header row's texts (else "Column 2"), made unique. */
export function columnNames(el: Pick<TableElement, 'rows' | 'cols' | 'header'>, get: Get): string[] {
  const seen = new Set<string>();
  return el.cols.map((c, i) => {
    const base = (el.header && el.rows[0] ? richTextToPlain(get(el.rows[0].id, c.id)).replace(/\s+/g, ' ').trim().slice(0, 50) : '') || `Column ${i + 1}`;
    let name = base;
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

/** Body rows that hold something (the header row and empty rows are no cards). */
const bodyRows = (el: Pick<TableElement, 'rows' | 'cols' | 'header'>, get: Get) =>
  el.rows.slice(el.header ? 1 : 0).filter((r) => el.cols.some((c) => richTextToPlain(get(r.id, c.id)).trim()));

/** A cell as words (selects their label, people their name, numbers and dates as read). */
const words = (col: TableColumn, raw: string, people?: PeopleLookup) => (typeOf(col) === 'checkbox' ? (raw === 'true' ? 'Yes' : '') : displayValue(col, raw, people).trim());

/**
 * The choice the dialog starts with: columns from the column the board view groups by, else the
 * first select column, else the first column whose words read as a few repeating labels; titles
 * from the first text column that isn't that one.
 */
export function defaultChoice(el: TableElement, get: Get): ConvertChoice | null {
  if (el.cols.length < 2) return null;
  const rows = bodyRows(el, get);
  const select = el.cols.find((c) => c.id === el.groupBy && typeOf(c) === 'select') ?? el.cols.find((c) => typeOf(c) === 'select');
  const labels = el.cols.find((c) => typeOf(c) === 'text' && rows.length > 1 && inferFieldType(rows.map((r) => richTextToPlain(get(r.id, c.id)))) === 'select');
  const columnsFrom = (select ?? labels ?? el.cols[1]).id;
  const titleFrom = (el.cols.find((c) => c.id !== columnsFrom && typeOf(c) === 'text') ?? el.cols.find((c) => c.id !== columnsFrom)!).id;
  return { columnsFrom, titleFrom };
}

/** A card's own field a column of this name fills (when its values fit it). */
const BUILTIN_BY_NAME: Record<string, ColumnFate['as']> = { description: 'description', assignee: 'assignee', due: 'due', 'due date': 'due', start: 'start', 'start date': 'start', estimate: 'estimate', link: 'link' };

const isUrl = (t: string) => /^(https?:\/\/[^\s/]|mailto:|tel:)\S*$/i.test(t);

interface Read {
  type: FieldType;
  /** Per body row: the value as `layoutKanbanRows` takes it (labels for selects), or null. */
  values: unknown[];
  options?: Array<{ label: string; color?: string }>;
}

/**
 * A column's cells as a kanban field: a typed column keeps its type (select options and their
 * colours too); a text column's type is read from its words (fieldText.ts `inferFieldType`). A
 * typed column holding text it can't read becomes a text field, so nothing typed is lost.
 */
function readColumn(col: TableColumn, raws: string[], people?: PeopleLookup): Read {
  const plain = raws.map((r) => richTextToPlain(r).replace(/\n+$/, '').trim());
  const asText = (): Read => ({ type: 'text', values: raws.map((r) => (typeOf(col) === 'person' && r ? (people?.name(r) ?? richTextToPlain(r)) : words(col, r, people)) || null) });
  switch (typeOf(col)) {
    case 'number':
      return raws.every((r) => isValid(col, r)) ? { type: 'number', values: raws.map((r) => (r ? Number(r) : null)) } : asText();
    case 'date':
      return raws.every((r) => isValid(col, r)) ? { type: 'date', values: raws.map((r) => r || null) } : asText();
    case 'checkbox':
      return { type: 'checkbox', values: raws.map((r) => (r === 'true' ? true : null)) };
    case 'person':
      return raws.every((r) => !r || !!people?.name(r)) ? { type: 'person', values: raws.map((r) => r || null) } : asText();
    case 'select': {
      const options = [...(col.options ?? []).map((o) => ({ label: o.label, color: toKanbanColor(o.color) })), ...plain.filter(Boolean).map((label) => ({ label }))];
      return { type: 'select', values: plain.map((t) => t || null), options };
    }
    case 'text': {
      const filled = plain.filter(Boolean);
      const type = filled.length < 2 ? inferFieldType(filled, { choices: false, dayFirst: false }) : inferFieldType(filled, { dayFirst: false });
      const values = plain.map((t): unknown => {
        if (!t) return null;
        if (type === 'number') return parseNumberText(t);
        if (type === 'date') return parseDateText(t, { dayFirst: false });
        if (type === 'checkbox') return parseCheckboxText(t) ? true : null;
        if (type === 'multiselect') return splitLabels(t);
        return t;
      });
      const labels = type === 'select' ? filled : type === 'multiselect' ? filled.flatMap(splitLabels) : [];
      return { type, values, ...(labels.length ? { options: labels.map((label) => ({ label })) } : {}) };
    }
  }
}

/**
 * The kanban a table makes with `choice`: a column per value of the columns column (a select's
 * options in their order, then values it doesn't list, a "No …" column first when some rows have
 * none), a card per row that holds anything, titled from the title column, and every other column
 * a field — or the card's own description, assignee, due / start date, estimate or link when it is
 * named so and its values fit. A reason instead when the table can't make one.
 */
export function tableToKanbanRows(
  el: TableElement,
  get: Get,
  choice: ConvertChoice,
  people?: PeopleLookup,
): { rows: KanbanRowsInput; fates: ColumnFate[] } | { error: string } {
  const by = el.cols.find((c) => c.id === choice.columnsFrom);
  const titleCol = el.cols.find((c) => c.id === choice.titleFrom);
  if (!by || !titleCol || by === titleCol) return { error: tr('pickAColumnForThe') };
  const names = columnNames(el, get);
  const nameOf = (c: TableColumn) => names[el.cols.indexOf(c)];
  const rows = bodyRows(el, get);

  // Columns: the values of `by`.
  const columns: Array<{ title: string; color?: string }> = [];
  const index = new Map<string, number>();
  const add = (title: string, color?: string) => {
    const key = labelKey(title);
    if (!index.has(key)) {
      index.set(key, columns.length);
      columns.push({ title: title.slice(0, 100), ...(color ? { color } : {}) });
    }
    return index.get(key)!;
  };
  const columnWords = rows.map((r) => words(by, get(r.id, by.id), people));
  if (columnWords.some((w) => !w)) add(`No ${nameOf(by)}`);
  if (typeOf(by) === 'select') for (const o of by.options ?? []) add(o.label, toKanbanColor(o.color));
  const columnOf = columnWords.map((w) => (w ? add(w) : 0));
  if (columns.length > MAX_KANBAN_COLUMNS)
    return { error: `“${nameOf(by)}” has ${columns.length} different values; a kanban has at most ${MAX_KANBAN_COLUMNS} columns. Pick another column.` };

  const fates: ColumnFate[] = [];
  const fields: KanbanRowsInput['fields'] = [];
  const cards: KanbanRowsInput['cards'] = rows.map((r, i) => ({ column: columnOf[i], text: words(titleCol, get(r.id, titleCol.id), people) }));
  const taken = [{ id: 'stage', name: nameOf(by), type: 'select' as const }];
  for (const col of el.cols) {
    const name = nameOf(col);
    if (col === by || col === titleCol) {
      fates.push({ colId: col.id, name, as: col === by ? 'columns' : 'title' });
      continue;
    }
    const raws = rows.map((r) => get(r.id, col.id));
    const read = readColumn(col, raws, people);
    const builtin = BUILTIN_BY_NAME[name.toLowerCase()];
    const texts = raws.map((r) => words(col, r, people));
    const fits =
      builtin === 'description' || builtin === 'estimate'
        ? true
        : builtin === 'assignee'
          ? read.type === 'person'
          : builtin === 'due' || builtin === 'start'
            ? read.type === 'date'
            : builtin === 'link'
              ? texts.every((t) => !t || isUrl(t))
              : false;
    if (builtin && fits) {
      fates.push({ colId: col.id, name, as: builtin });
      cards.forEach((c, i) => {
        const v = read.values[i];
        if (builtin === 'description') c.description = texts[i];
        else if (builtin === 'estimate') c.estimate = texts[i] || null;
        else if (builtin === 'link') c.link = texts[i] || null;
        else if (builtin === 'assignee') c.assigneeId = typeof v === 'string' ? v : null;
        else if (builtin === 'due') c.dueDate = typeof v === 'string' ? v : null;
        else c.startDate = typeof v === 'string' ? v : null;
      });
      continue;
    }
    // A name a card's own field has ("Status", "Tags") stays, marked as a field.
    let fieldName = fieldNameProblem([], name) ? `${name} (field)` : name;
    for (let n = 2; fieldNameProblem(taken, fieldName); n++) fieldName = `${name} (field ${n})`;
    taken.push({ id: col.id, name: fieldName, type: 'select' });
    fates.push({ colId: col.id, name: fieldName, as: 'field', type: read.type });
    fields.push({ name: fieldName, type: read.type, ...(read.options ? { options: read.options } : {}) });
    cards.forEach((c, i) => {
      if (read.values[i] !== null && read.values[i] !== undefined) c.values = { ...c.values, [fieldName]: read.values[i] };
    });
  }
  return { rows: { title: tr('kanban'), columnsName: nameOf(by), columns, fields, cards }, fates };
}

/**
 * Replaces table `tableId` with the kanban `choice` makes, where the table stood (same top-left,
 * same frame): one undo step brings the table back. Returns the kanban's id.
 */
export function convertToKanban(editor: Editor, tableId: string, choice: ConvertChoice, people?: PeopleLookup): string | null {
  const el = editor.getElement<TableElement>(tableId);
  if (!el || el.type !== 'table' || el.locked) return null;
  const coll = editor.collection<string>(CELLS);
  const plan = tableToKanbanRows(el, (r, c) => cellText(coll, el.id, r, c), choice, people);
  if ('error' in plan) {
    editor.host.notify(plan.error, 'error');
    return null;
  }
  const kid = nanoid(10);
  editor.stopEditing();
  editor.transact(() => {
    editor.runCommand('kanban.createFromRows', { rows: plan.rows, at: { x: el.x, y: el.y }, id: kid, ...(el.frameId ? { frameId: el.frameId } : {}) });
    if (editor.getElement(kid)) editor.remove([el.id]);
  });
  if (!editor.getElement(kid)) return null;
  editor.select([kid]);
  return kid;
}

// ------------------------------------------------------------------ kanban → table ("Copy as table")

/** The single selected kanban, if the selection is exactly one. */
export function selectedKanban(editor: Editor): KanbanElement | null {
  const sel = editor.getSelection();
  const el = sel.length === 1 ? editor.getElement(sel[0]) : undefined;
  return el?.type === 'kanban' ? el : null;
}

interface SheetColumn {
  name: string;
  type: TableColumnType;
  options?: Array<{ label: string; color: string }>;
  /** A card's cell as the table stores it (RichText for text, canonical for typed columns). */
  cell(card: Parameters<typeof builtinValue>[0]): string;
}

/**
 * A kanban as a sheet: a row per card (column by column, top to bottom, as the board shows them),
 * the title, then every field (the column field as a select of the columns), then the card's own
 * fields that any card has. Multi-selects and tags become text ("a; b"), links text.
 */
export function kanbanSheet(k: KanbanElement, all: readonly BoardElement[], tags: ReadonlyMap<string, Tag>): { columns: SheetColumn[]; cards: Array<Parameters<typeof builtinValue>[0]> } {
  const cards = all
    .filter((el) => isMember(k, el))
    .map((c) => ({ c, col: kanbanColumnAt(k, c.x + c.w / 2), lane: kanbanLaneAt(k, c.y + c.h / 2) }))
    .sort((a, b) => a.col - b.col || a.lane - b.lane || a.c.y - b.c.y)
    .map((x) => x.c as Parameters<typeof builtinValue>[0]);
  const text = (s: string) => (s ? plainToRichText(s) : '');
  const columns: SheetColumn[] = [{ name: 'Title', type: 'text', cell: (c) => text(richTextToPlain(c.title ?? '').trim()) }];
  for (const f of collectionSchema(k)) {
    const label = (id: unknown) => f.options?.find((o) => o.id === id)?.label ?? '';
    const v = (c: Parameters<typeof builtinValue>[0]) => cardValue(k, c, f);
    switch (f.type) {
      case 'select':
        columns.push({ name: f.name, type: 'select', options: (f.options ?? []).filter((o) => o.label).map((o, i) => ({ label: o.label, color: toTint(o.color, i) })), cell: (c) => text(label(v(c))) });
        break;
      case 'multiselect':
        columns.push({ name: f.name, type: 'text', cell: (c) => { const x = v(c); return text(Array.isArray(x) ? x.map(label).filter(Boolean).join('; ') : ''); } });
        break;
      case 'person':
        columns.push({ name: f.name, type: 'person', cell: (c) => { const x = v(c); return typeof x === 'string' ? x : ''; } });
        break;
      case 'date':
        columns.push({ name: f.name, type: 'date', cell: (c) => { const x = v(c); return typeof x === 'string' ? x : ''; } });
        break;
      case 'number':
        columns.push({ name: f.name, type: 'number', cell: (c) => { const x = v(c); return typeof x === 'number' ? String(x) : ''; } });
        break;
      case 'checkbox':
        columns.push({ name: f.name, type: 'checkbox', cell: (c) => (v(c) === true ? 'true' : '') });
        break;
      default:
        columns.push({ name: f.name, type: 'text', cell: (c) => { const x = v(c); return text(typeof x === 'string' ? x : ''); } });
    }
  }
  // The card's own fields any card has (status follows the columns, so it is left out).
  const own: Array<{ id: Parameters<typeof builtinValue>[1]; type: TableColumnType; cell: (x: ReturnType<typeof builtinValue>) => string }> = [
    { id: '$assignee', type: 'person', cell: (x) => (typeof x === 'string' ? x : '') },
    { id: '$due', type: 'date', cell: (x) => (typeof x === 'string' ? x : '') },
    { id: '$start', type: 'date', cell: (x) => (typeof x === 'string' ? x : '') },
    { id: '$estimate', type: 'text', cell: (x) => text(typeof x === 'string' ? x : '') },
    { id: '$tags', type: 'text', cell: (x) => text(Array.isArray(x) ? x.map((t) => tags.get(t)?.name).filter(Boolean).join('; ') : '') },
    { id: '$link', type: 'text', cell: (x) => text(typeof x === 'string' ? x : '') },
  ];
  if (cards.some((c) => richTextToPlain(c.description ?? '').trim())) columns.splice(1, 0, { name: 'Description', type: 'text', cell: (c) => text(richTextToPlain(c.description ?? '').trim()) });
  for (const b of own)
    if (cards.some((c) => b.cell(builtinValue(c, b.id)))) columns.push({ name: BUILTIN_FIELDS.find((f) => f.id === b.id)!.name, type: b.type, cell: (c) => b.cell(builtinValue(c, b.id)) });
  return { columns, cards };
}

/**
 * "Copy as table": a new table beside kanban `kanbanId` with a row per card and a typed column per
 * field (see kanbanSheet). One undo step; the kanban and its cards are only read.
 */
export function copyKanbanAsTable(editor: Editor, kanbanId: string, people?: PeopleLookup): string | null {
  const k = editor.getElement<KanbanElement>(kanbanId);
  if (!k || k.type !== 'kanban') return null;
  const { columns, cards } = kanbanSheet(k, editor.getElements(), new Map(editor.collection<Tag>('tags').entries()));
  const grid = [columns.map((c) => c.name), ...cards.map((card) => columns.map((c) => displayValue({ id: '', w: 0, type: c.type }, c.cell(card), people)))];
  // A typed column's header also holds its type and menu buttons.
  const cols: TableColumn[] = fitColumnWidths(grid).map((w, i) => ({ id: nanoid(), w: columns[i].type === 'text' ? w : w + 40 }));
  const base = newTable({ x: 0, y: 0 }, cards.length + 1, columns.length, { colWidths: cols.map((c) => c.w) });
  const typed = base.cols.map((c, i) => ({ ...c, ...(columns[i].type === 'text' ? {} : { type: columns[i].type }), ...(columns[i].options ? { options: columns[i].options!.map((o) => ({ id: nanoid(8), ...o })) } : {}) }));
  const spot = editor.findFreeSpot({ w: base.w, h: base.h }, { near: { x: k.x + k.w + 80 + base.w / 2, y: k.y + base.h / 2 } });
  const table = { ...base, cols: typed, x: spot.x, y: spot.y, id: nanoid() };
  editor.transact(() => {
    editor.create(table, { select: true });
    columns.forEach((c, ci) => setCellText(editor, table.id, table.rows[0].id, typed[ci].id, plainToRichText(c.name)));
    cards.forEach((card, ri) =>
      columns.forEach((c, ci) => {
        const raw = c.cell(card);
        // Select cells hold their label as typed (columns.ts valueFor), like a cell someone typed.
        const v = c.type === 'select' && raw ? valueFor(typed[ci], richTextToPlain(raw)) : raw;
        if (v) setCellText(editor, table.id, table.rows[ri + 1].id, typed[ci].id, v);
      }),
    );
    const el = editor.getElement<TableElement>(table.id);
    if (el) fitRows(editor, el);
  });
  return table.id;
}
