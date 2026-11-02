// Rows of a sheet as a NEW kanban with typed fields (step 3e: "Convert to kanban" on a free-form
// table; docs/design/kanban-fields-and-views.md). Pure: the kanban feature's `kanban.createFromRows`
// creates what this lays out, so the table never writes kanban elements itself, and any later
// writer that turns rows into a kanban (an agent tool, a CSV into a new kanban) can use the same
// rules. Geometry is the shared kanban structure's (`layoutKanban`): column titles like "Done" set
// their cards' status, as a drop there would.
import { COLUMN_FIELD_ID, COLUMN_FIELD_NAME, FIELD_LIMITS, FIELD_TYPES, fieldNameProblem, readFieldInputs, storedFields, type FieldDef, type FieldOption, type FieldType, type FieldValues } from '../fields';
import { OPTION_COLORS, labelKey } from '../fieldText';
import { isISODate } from './timeline';
import { layoutKanban } from './structures';
import type { KanbanElement } from '../elements';
import { LayoutError, type CardInput, type ElementDraft, type LaidOut, type LayoutContext } from './types';

/** What a new kanban is made of: columns, fields by name, and cards with their values by field name. */
export interface KanbanRowsInput {
  title?: string;
  /** The column field's name (the default "Stage" when it can't name a field, e.g. "Status"). */
  columnsName?: string;
  /** The columns, in order (at most 40). `color`: #rrggbb, else the kanban's palette. */
  columns: Array<{ title: string; color?: string }>;
  /** The other fields, in order: names unique and not a card's own field's; options by label. */
  fields: Array<{ name: string; type: FieldType; options?: Array<{ label: string; color?: string }> }>;
  /** Field names (or built-in ids like `$due`) the cards show; default: the short fields, then assignee, due date, tags. */
  show?: string[];
  cards: Array<{
    /** Index into `columns`. */
    column: number;
    text: string;
    description?: string;
    assigneeId?: string | null;
    dueDate?: string | null;
    startDate?: string | null;
    estimate?: string | null;
    link?: string | null;
    /** By field name: a select by label, a multi-select by labels, other types as stored (fields.ts). A value that doesn't fit is left out. */
    values?: Record<string, unknown>;
  }>;
}

const HEX = /^#[0-9a-f]{6}$/i;
const SHORT: readonly FieldType[] = ['select', 'multiselect', 'number', 'date', 'checkbox', 'person'];

function options(raw: unknown, ctx: LayoutContext): FieldOption[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new LayoutError('A field’s options are a list of { label, color? }');
  const out: FieldOption[] = [];
  const seen = new Set<string>();
  for (const o of raw) {
    const label = typeof o?.label === 'string' ? o.label.trim().slice(0, FIELD_LIMITS.label) : '';
    if (!label || seen.has(labelKey(label))) continue;
    seen.add(labelKey(label));
    out.push({ id: ctx.newId(), label, color: typeof o.color === 'string' && HEX.test(o.color) ? o.color : OPTION_COLORS[(out.length + 1) % OPTION_COLORS.length] });
    if (out.length >= FIELD_LIMITS.options) break;
  }
  return out;
}

/**
 * The kanban and its cards, laid out from (0, 0): `elements[0]` is the kanban (its fields and a
 * board view showing the short fields), then the cards column by column in the order given.
 * Throws a LayoutError for input it can't make a kanban of (no columns, a field name that can't
 * be one, a card in a column that isn't there).
 */
export function layoutKanbanRows(input: KanbanRowsInput, ctx: LayoutContext): LaidOut {
  if (!input || typeof input !== 'object' || !Array.isArray(input.columns) || !Array.isArray(input.fields) || !Array.isArray(input.cards))
    throw new LayoutError('Rows for a kanban need columns, fields and cards');
  const name = typeof input.columnsName === 'string' && !fieldNameProblem([], input.columnsName) ? input.columnsName.trim() : COLUMN_FIELD_NAME;
  const schema: FieldDef[] = [{ id: COLUMN_FIELD_ID, name, type: 'select' }];
  if (input.fields.length > FIELD_LIMITS.fields) throw new LayoutError(`At most ${FIELD_LIMITS.fields} fields`);
  for (const f of input.fields) {
    if (!f || typeof f.name !== 'string' || !FIELD_TYPES.includes(f.type)) throw new LayoutError('Every field needs a name and a type');
    const problem = fieldNameProblem(schema, f.name);
    if (problem) throw new LayoutError(problem);
    const def: FieldDef = { id: ctx.newId(), name: f.name.trim(), type: f.type };
    if (f.type === 'select' || f.type === 'multiselect') def.options = options(f.options, ctx);
    schema.push(def);
  }
  const custom = schema.slice(1);

  const items: CardInput[][] = input.columns.map(() => []);
  const order: number[][] = input.columns.map(() => []);
  input.cards.forEach((c, i) => {
    if (!c || !Number.isInteger(c.column) || !items[c.column]) throw new LayoutError(`Card ${i + 1} is in a column that isn’t there`);
    items[c.column].push({ text: typeof c.text === 'string' ? c.text : '', description: typeof c.description === 'string' ? c.description : '', dueDate: c.dueDate ?? null, link: c.link ?? null });
    order[c.column].push(i);
  });
  const laid = layoutKanban(input.title, input.columns.map((c, i) => ({ title: typeof c?.title === 'string' ? c.title : '', items: items[i] })), ctx);
  const [board, ...drafts] = laid.elements;
  const byDraft = order.flat();

  const showRefs = input.show ?? [...custom.filter((f) => SHORT.includes(f.type)).slice(0, 4).map((f) => f.name), '$assignee', '$due', '$tags'];
  const show = showRefs.flatMap((ref) => (ref.startsWith('$') ? [ref] : custom.filter((f) => f.name.toLowerCase() === ref.toLowerCase()).map((f) => f.id)));
  const columns = (board as unknown as KanbanElement).columns.map((col, i) => {
    const color = input.columns[i]?.color;
    return typeof color === 'string' && HEX.test(color) ? { ...col, color } : col;
  });
  const kanban: ElementDraft = {
    ...(board as unknown as KanbanElement),
    columns,
    fields: storedFields(schema),
    views: [{ id: 'board', name: 'Board', layout: 'board' as const, card: { show, density: 'comfortable' as const, color: 'group' } }],
    activeView: 'board',
    colorCards: true,
  };

  const cards = drafts.map((d, j) => {
    const c = input.cards[byDraft[j]];
    const values: FieldValues = {};
    for (const [key, raw] of Object.entries(c.values ?? {})) {
      const read = readFieldInputs(custom, { [key]: raw });
      if ('values' in read) for (const { field, value } of read.values) if (value !== null) values[field.id] = value;
    }
    const estimate = typeof c.estimate === 'string' ? c.estimate.trim().slice(0, 12) : '';
    return {
      ...d,
      ...(typeof c.assigneeId === 'string' && c.assigneeId ? { assigneeId: c.assigneeId } : {}),
      ...(isISODate(c.startDate) ? { startDate: c.startDate } : {}),
      ...(estimate ? { estimate } : {}),
      ...(Object.keys(values).length ? { values } : {}),
    };
  });
  return { ...laid, elements: [kanban, ...cards] };
}
