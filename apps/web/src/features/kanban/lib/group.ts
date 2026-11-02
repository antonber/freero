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
import {
  COLUMN_FIELD_ID,
  NO_GROUP,
  boardView,
  collectionSchema,
  groupKeyOf,
  groupKeyValue,
  isGroupable,
  kanbanColumnAt,
  plainToRichText,
  readValue,
  savedViews,
  storedFields,
  type BoardElement,
  type CardElement,
  type FieldDef,
  type GroupSettings,
  type KanbanColumn,
  type KanbanElement,
  type ViewConfig,
} from '@freero/shared';
import type { Editor, ElementPatch } from '@engine';
import { COLUMN_COLORS } from './constants';
import { boardWidth, colLeft, colWidth, isStackable } from './layout';

const NONE_COLOR = '#8A89A3';

/** A swimlane's or column's title for group key `key` of field `f` (person names come from the people lookup when drawn). */
export function groupTitle(f: Pick<FieldDef, 'name' | 'type' | 'options'>, key: string, personName?: (id: string) => string | undefined): string {
  if (key === NO_GROUP) return `No ${f.name}`;
  if (f.type === 'checkbox') return `${f.name}: ${key === 'true' ? 'yes' : 'no'}`;
  if (f.type === 'person') return personName?.(key) ?? 'Someone';
  return f.options?.find((o) => o.id === key)?.label || 'Untitled';
}

/** The group key card `el` has for field `f` from its stored value (non-cards: none). */
export const storedKey = (f: FieldDef, el: BoardElement): string => (el.type === 'card' ? groupKeyOf(f, readValue(f, (el as CardElement).values?.[f.id])) : NO_GROUP);

/**
 * The groups of field `f`, in order: "No <field>" first (select and person fields), then a select's
 * options, the people that `keys` name (in the order met, after those of `keep`), or unchecked /
 * checked.
 */
export function groupKeys(f: FieldDef, keys: Iterable<string>, keep: readonly string[] = []): string[] {
  if (f.type === 'checkbox') return ['false', 'true'];
  if (f.type === 'person') {
    const people = new Set<string>();
    const present = new Set(keys);
    for (const id of keep) if (id !== NO_GROUP && present.has(id)) people.add(id);
    for (const id of present) if (id !== NO_GROUP) people.add(id);
    return [NO_GROUP, ...people];
  }
  return [...(f.id === COLUMN_FIELD_ID ? [] : [NO_GROUP]), ...(f.options ?? []).map((o) => o.id)];
}

/** Field `f`'s groups as columns, with the settings the view kept for them. */
function columnsFor(f: FieldDef, keys: string[], settings: Record<string, GroupSettings>): KanbanColumn[] {
  return keys.map((key, i) => {
    const o = f.type === 'select' ? f.options?.find((x) => x.id === key) : undefined;
    const kept = settings[key] ?? {};
    return {
      id: key,
      title: plainToRichText(f.type === 'person' && key !== NO_GROUP ? '' : groupTitle(f, key)),
      status: o?.status ?? null,
      color: o?.color ?? (key === NO_GROUP ? NONE_COLOR : COLUMN_COLORS[i % COLUMN_COLORS.length]),
      ...(kept.wip ? { wip: kept.wip } : {}),
      ...(kept.collapsed ? { collapsed: true } : {}),
      ...(kept.limit ? { limit: kept.limit } : {}),
    };
  });
}

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

const settingsOf = (c: KanbanColumn): GroupSettings | null =>
  c.wip || c.collapsed || c.limit ? { ...(c.wip ? { wip: c.wip } : {}), ...(c.collapsed ? { collapsed: true } : {}), ...(c.limit ? { limit: c.limit } : {}) } : null;

/** Groups the board by field `fieldId` (see the header). One undo step; false when nothing changed. */
export function setGroupBy(editor: Editor, kid: string, fieldId: string): boolean {
  const k = editable(editor, kid);
  if (!k) return false;
  const view = boardView(k);
  const oldId = view.groupBy ?? COLUMN_FIELD_ID;
  if (fieldId === oldId) return false;
  const schema = collectionSchema(k);
  const oldF = schema.find((f) => f.id === oldId);
  const newF = schema.find((f) => f.id === fieldId);
  if (!oldF || !newF || !isGroupable(newF)) return false;
  const all = editor.getElements();
  const members = all.filter((el) => isStackable(el, k.id));

  // The old group field's values, from where each card stands; the new one's are its column now.
  const valuePatches: Array<{ id: string; patch: ElementPatch }> = [];
  for (const el of members) {
    if (el.type !== 'card') continue;
    const card = el as CardElement;
    const v = k.columns.length ? groupKeyValue(oldF, k.columns[kanbanColumnAt(k, card.x + card.w / 2)].id) : null;
    const values = { ...(card.values ?? {}) };
    if (v === null) delete values[oldId];
    else values[oldId] = v;
    delete values[fieldId];
    if (JSON.stringify(values) !== JSON.stringify(card.values ?? {})) valuePatches.push({ id: card.id, patch: { values } as ElementPatch });
  }

  // Column settings: the old field's kept in the view, the new field's (if it had any) back on its columns.
  const groupSettings = { ...(view.groupSettings ?? {}) };
  const parked = Object.fromEntries(k.columns.flatMap((c) => (settingsOf(c) ? [[c.id, settingsOf(c)!]] : [])));
  if (Object.keys(parked).length) groupSettings[oldId] = parked;
  else delete groupSettings[oldId];
  const restored = groupSettings[fieldId] ?? {};
  delete groupSettings[fieldId];

  const keyOf = new Map(members.map((el) => [el.id, storedKey(newF, el)]));
  const columns = columnsFor(newF, groupKeys(newF, keyOf.values()), restored);
  const nextView: ViewConfig = { ...view, groupBy: fieldId, subGroupBy: view.subGroupBy === fieldId ? null : view.subGroupBy, groupSettings };
  const nextK = { ...k, columns };
  const mid = (i: number) => k.x + colLeft(nextK, i) + colWidth(nextK, i) / 2;
  // Each card goes to the column of its value (other items to the first column), keeping its height.
  const moves = members.map((el) => {
    const i = Math.max(0, columns.findIndex((c) => c.id === keyOf.get(el.id)));
    return { id: el.id, dx: mid(i) - (el.x + el.w / 2), dy: 0 };
  });
  editor.transact(() => {
    editor.update<KanbanElement>(k.id, {
      columns,
      fields: storedFields(schema, fieldId),
      ...savedViews(k, nextView),
      ...(nextView.subGroupBy ? {} : { lanes: null }),
      w: boardWidth(nextK),
    });
    if (valuePatches.length) editor.updateMany(valuePatches);
    if (moves.some((m) => Math.abs(m.dx) > 0.01)) editor.moveBy(moves);
  });
  return true;
}

/** Swimlanes by field `fieldId` (null: none). Saved for everyone (it moves the cards); one undo step with the re-stack. */
export function setSwimlanes(editor: Editor, kid: string, fieldId: string | null): boolean {
  const k = editable(editor, kid);
  if (!k) return false;
  const view = boardView(k);
  if ((view.subGroupBy ?? null) === fieldId) return false;
  if (fieldId) {
    const f = collectionSchema(k).find((x) => x.id === fieldId);
    if (!f || !isGroupable(f) || fieldId === view.groupBy) return false;
  }
  editor.update<KanbanElement>(k.id, { ...savedViews(k, { ...view, subGroupBy: fieldId }), ...(fieldId ? {} : { lanes: null }) });
  return true;
}
