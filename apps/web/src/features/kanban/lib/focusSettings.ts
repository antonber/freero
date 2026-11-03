// Focus mode's settings (step 3a, design §7): how I arrange a kanban's cards when I open it as a
// page of its own — grouped by any field (the card's own status and assignee too), compact or
// comfortable rows, my filter and sort, the fields I want as columns. Mine alone, in any role:
// personal view state (FOCUS_KEY, kept through Host.personalViews), never the board doc, so
// nothing moves on the shared board and nobody else's focus mode changes. Steps 2b and 2c kept
// grouping and density shared on the canvas, because there they move the real cards; here they
// only arrange rows.
import {
  FOCUS_KEY,
  STATUS_OPTIONS,
  boardView,
  builtinValue,
  cardValue,
  cleanFilter,
  cleanSort,
  collectionSchema,
  groupFieldId,
  groupKeyOf,
  groupKeys,
  groupTitle,
  isGroupable,
  sortCards,
  cardPasses,
  isStackable,
  manualOrderOf,
  type CardElement,
  type FieldDef,
  type KanbanElement,
  type SortRule,
  type ViewFilter,
} from '@freero/shared';
import type { Editor } from '@engine';
import type { GridEntry } from './Grid';

export type FocusDensity = 'compact' | 'comfortable';

export interface FocusSettings {
  /** The field rows are grouped by (null: no groups). */
  groupBy: string | null;
  density: FocusDensity;
  filter: ViewFilter | null;
  sort: SortRule[];
  /** Fields shown as columns after the title; null: those the board's cards show. */
  columns: string[] | null;
}

/** Built-in fields a focus-mode list can be grouped by (a projection may: no real card moves). */
const BUILTIN_GROUPS: FieldDef[] = [
  { id: '$status', name: 'Status', type: 'select', options: STATUS_OPTIONS },
  { id: '$assignee', name: 'Assignee', type: 'person' },
];

/** Fields focus mode can group by: the kanban's single selects, people and checkboxes, then the card's status and assignee. */
export function focusGroupFields(schema: readonly FieldDef[]): FieldDef[] {
  return [...schema.filter(isGroupable), ...BUILTIN_GROUPS];
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64 && v !== '__proto__';

/**
 * My focus-mode settings for kanban `k`: what I stored (anything malformed dropped), the rest
 * from the board — grouped as the board is, its saved filter and sort — and comfortable rows on
 * phones, compact ones elsewhere.
 */
export function focusSettings(k: KanbanElement, raw: unknown, opts: { phone?: boolean } = {}): FocusSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const board = boardView(k);
  const fields = focusGroupFields(collectionSchema(k));
  const groupBy = r.groupBy === null ? null : isId(r.groupBy) && fields.some((f) => f.id === r.groupBy) ? r.groupBy : groupFieldId(k);
  return {
    groupBy,
    density: r.density === 'compact' || r.density === 'comfortable' ? r.density : opts.phone ? 'comfortable' : 'compact',
    filter: Object.hasOwn(r, 'filter') ? cleanFilter(r.filter, { personal: true }) : (board.filter ?? null),
    sort: Array.isArray(r.sort) ? cleanSort(r.sort) : (board.sort ?? []),
    columns: Array.isArray(r.columns) ? r.columns.filter(isId).slice(0, 40) : null,
  };
}

/** Changes my focus-mode settings of kanban `kid` (any role; only for me). */
export function setFocus(editor: Editor, kid: string, patch: Partial<FocusSettings>) {
  const cur = editor.getPersonalView(kid, FOCUS_KEY) ?? {};
  editor.setPersonalView(kid, FOCUS_KEY, { ...cur, ...patch });
}

/** Back to the board's arrangement (my focus-mode settings dropped). */
export const resetFocus = (editor: Editor, kid: string) => editor.setPersonalView(kid, FOCUS_KEY, null);

/** A card's value for a field focus mode groups by (the card's own status / assignee too). */
function groupValue(k: KanbanElement, card: CardElement, f: FieldDef) {
  return f.id === '$status' || f.id === '$assignee' ? builtinValue(card, f.id) : cardValue(k, card, f);
}

/**
 * The rows focus mode shows: the kanban's cards my filter keeps, in my sort (else the board's
 * order), under a header row per group when grouped — groups in the field's order, people in the
 * order the board meets them, empty groups left out. `me`: who "is me" means.
 */
export function focusEntries(k: KanbanElement, cards: readonly CardElement[], s: FocusSettings, ctx: { me: string; personName?: (id: string) => string | undefined }): { entries: GridEntry[]; shown: number } {
  const schema = collectionSchema(k);
  const order = new Map(manualOrderOf(k, cards).map((id, i) => [id, i]));
  let rows = [...cards].sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size) || (isStackable(a, k.id) ? 0 : 1) - (isStackable(b, k.id) ? 0 : 1));
  if (s.filter) rows = rows.filter((c) => cardPasses(k, c, s.filter, schema, { me: ctx.me }));
  if (s.sort.length) rows = sortCards(k, rows, s.sort, schema);
  const f = s.groupBy ? focusGroupFields(schema).find((x) => x.id === s.groupBy) : undefined;
  if (!f) return { entries: rows.map((card) => ({ kind: 'card', card })), shown: rows.length };
  const byKey = new Map<string, CardElement[]>();
  for (const c of rows) {
    const key = groupKeyOf(f, groupValue(k, c, f));
    const list = byKey.get(key) ?? [];
    list.push(c);
    byKey.set(key, list);
  }
  const entries: GridEntry[] = [];
  for (const key of groupKeys(f, byKey.keys())) {
    const list = byKey.get(key);
    if (!list?.length) continue;
    const color = f.type === 'select' ? f.options?.find((o) => o.id === key)?.color : undefined;
    entries.push({ kind: 'group', key, title: groupTitle(f, key, ctx.personName), count: list.length, ...(color ? { color } : {}) });
    for (const card of list) entries.push({ kind: 'card', card });
  }
  return { entries, shown: rows.length };
}
