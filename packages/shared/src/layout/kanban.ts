// A kanban's layout (docs/design/kanban-fields-and-views.md, steps 2c–2e): where every item it holds
// stands, by the same rule on every client and the server. The kanban feature applies it after
// every local change (its `arrange`), and the server after a change it writes itself (an agent
// setting a card's field, placing a card into a swimlane, changing the view: `withKanbanLayout`),
// so open boards see the cards move without anyone's client laying them out again. Pure.
import {
  KANBAN_LAYOUT,
  kanbanBoardWidth,
  kanbanColumnAt,
  kanbanColumnLeft,
  kanbanColumnWidth,
  kanbanLaneAt,
  type BoardElement,
  type CardElement,
  type CardStatus,
  type KanbanColumn,
  type KanbanElement,
  type KanbanLane,
} from '../elements';
import { plainToRichText } from '../text';
import {
  COLUMN_FIELD_ID,
  NO_GROUP,
  collectionSchema,
  groupFieldId,
  groupKeyOf,
  groupKeyValue,
  isGroupable,
  readValue,
  storedFields,
  type FieldDef,
} from '../fields';
import { boardView, savedViews, type GroupSettings, type ViewConfig } from '../views';
import { cardPasses, cardQueryValue, sortByValues, queryField } from '../query';

export type KanbanPatch = { id: string; patch: Record<string, unknown> };

/** An empty column still offers this much room to drop into; an empty swimlane this much; the "N more" line under a column this much. */
export const KANBAN_PLAN = { minBody: 180, minLaneBody: 84, moreH: 28 } as const;

const EPS = 0.01;
const centerX = (el: Pick<BoardElement, 'x' | 'w'>) => el.x + el.w / 2;
const centerY = (el: Pick<BoardElement, 'y' | 'h'>) => el.y + el.h / 2;

/** Items a kanban lays out: its direct children, except lines and nested containers. */
export function isStackable(el: BoardElement, kanbanId: string): boolean {
  return el.frameId === kanbanId && el.type !== 'connector' && el.type !== 'pen' && el.type !== 'frame' && el.type !== 'kanban' && !el.locked;
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

/** What the layout reads of a kanban, read once per element (the layout and `hidesMember` ask often). */
const contexts = new WeakMap<KanbanElement, { view: ViewConfig; schema: FieldDef[] }>();
function contextOf(k: KanbanElement) {
  let c = contexts.get(k);
  if (!c) contexts.set(k, (c = { view: boardView(k), schema: collectionSchema(k) }));
  return c;
}

/** The field the swimlanes are made of, when the board view has them. */
export function laneField(k: KanbanElement): FieldDef | null {
  const { view, schema } = contextOf(k);
  return view.subGroupBy ? (schema.find((f) => f.id === view.subGroupBy) ?? null) : null;
}

/** True for a card the kanban's saved filter leaves out: it stays in its column, folded away below the board. */
export function filteredOut(k: KanbanElement, el: BoardElement): boolean {
  if (el.type !== 'card' || el.frameId !== k.id) return false;
  const { view, schema } = contextOf(k);
  return !!view.filter && !cardPasses(k, el as CardElement, view.filter, schema);
}

/** True while `el` is beyond its column's card limit: stacked below the board, folded away. */
export function beyondLimit(k: KanbanElement, el: BoardElement): boolean {
  return isStackable(el, k.id) && !!k.columns[kanbanColumnAt(k, centerX(el))]?.limit && centerY(el) > k.y + k.h;
}

export interface KanbanPlan {
  patches: KanbanPatch[];
  /** Items per column after the layout (WIP counts: every swimlane, folded-away and filtered items too). */
  counts: number[];
}

type Placed = { el: BoardElement; key: number };

/**
 * Where everything goes. Each item stacks in the column under its center, in the order of
 * their centers top to bottom (manual order) — or, while the view is sorted, in the sort's order.
 * A task card the change moved into a column with a status takes that status; a card whose status
 * was changed where it stood (not moved) goes to the column with that status instead. Cards the
 * change didn't touch keep their status (remote edits and stale boards are never rewritten by
 * whoever happens to edit next). Colours are never written.
 *
 * Swimlanes (the view's `subGroupBy`): a card's row is its stored value. A card the change moved
 * (dropped, created there) takes the row under its center and that row's value; a card whose
 * value changed where it stood goes to the bottom of its new row. A column with a card `limit`
 * shows its first items (in each row), and cards the view's filter leaves out don't show at all:
 * both stay in their column, stacked below the board, folded away (`hidesMember`), still counted.
 * Regrouping (another `groupBy`) moves cards between columns without "dropping" them: no status is
 * written then. When a sort is cleared, the manual order kept while it lasted (`manualOrder`) is
 * restored, and the view stops keeping it.
 *
 * `previous`: what the change found, by id (null: created by it); items not in it weren't touched.
 */
export function planKanban(k: KanbanElement, all: readonly BoardElement[], previous: ReadonlyMap<string, BoardElement | null>): KanbanPlan {
  const { gap, headerH, colHeadH, laneHeadH, pad, itemGap, collapsedW } = KANBAN_LAYOUT;
  const n = k.columns.length;
  const inner = k.colW - 2 * pad;
  const items = all.filter((el) => isStackable(el, k.id));
  const patches: KanbanPatch[] = [];
  // By id too: a re-lay of every card asks for each one's patch (a scan per card was O(n²)).
  const patchOf = new Map<string, Record<string, unknown>>();
  const own = (id: string): Record<string, unknown> => {
    let p = patchOf.get(id);
    if (!p) {
      patchOf.set(id, (p = {}));
      patches.push({ id, patch: p });
    }
    return p;
  };
  const { view, schema } = contextOf(k);
  // Where the board itself was (it may have moved in the same change, carrying its items).
  const kBefore = (previous.get(k.id) as KanbanElement | null | undefined) ?? k;
  const regrouped = groupFieldId(kBefore) !== groupFieldId(k);
  const lanes = laneField(k);
  const laneKeys = lanes ? groupKeys(lanes, items.map((el) => storedKey(lanes, el)), (kBefore.lanes ?? []).map((l) => l.id)) : [''];
  const cells: Placed[][][] = laneKeys.map(() => k.columns.map(() => []));

  for (const el of items) {
    let col = kanbanColumnAt(k, centerX(el));
    let key = centerY(el);
    const prev = previous.get(el.id);
    if (el.type === 'card' && prev !== undefined && !regrouped) {
      const status = el.status ?? null;
      const movedIn = prev === null || prev.frameId !== k.id || kBefore.columns[kanbanColumnAt(kBefore, centerX(prev))]?.id !== k.columns[col]?.id;
      const statusChanged = prev !== null && prev.type === 'card' && (prev.status ?? null) !== status;
      const want: CardStatus | null = k.columns[col]?.status ?? null;
      if (want && status !== want) {
        const statusCol = status ? k.columns.findIndex((c) => c.status === status) : -1;
        if (!movedIn && statusChanged && statusCol >= 0) {
          // Status changed where the card stood (format toolbar): it moves to that column, last.
          col = statusCol;
          key = Number.POSITIVE_INFINITY;
        } else if (movedIn) {
          own(el.id).status = want;
        }
      }
    }
    let lane = 0;
    if (lanes) {
      const moved = prev === null || (prev !== undefined && (prev.frameId !== k.id || prev.x !== el.x || prev.y !== el.y));
      const at = kBefore.lanes?.[kanbanLaneAt(kBefore, centerY(el))]?.id;
      const stored = storedKey(lanes, el);
      const want = (el.type !== 'card' || moved) && at !== undefined && laneKeys.includes(at) ? at : stored;
      lane = Math.max(0, laneKeys.indexOf(want));
      if (el.type === 'card' && want !== stored) {
        // Dropped into another row: it takes that row's value (the one write the layout makes on a card's fields).
        const values = { ...((el as CardElement).values ?? {}) };
        const v = groupKeyValue(lanes, want);
        if (v === null) delete values[lanes.id];
        else values[lanes.id] = v;
        own(el.id).values = values;
      } else if (el.type === 'card' && !moved && prev && storedKey(lanes, prev) !== stored) key = Number.POSITIVE_INFINITY;
    }
    cells[lane][col].push({ el, key });
  }

  // The order within a cell: the sort's (manual order breaks ties), else manual — the kept one
  // first, while a cleared sort is being undone.
  const sort = (view.sort ?? []).filter((s) => queryField(schema, s.field)?.sortable);
  const manual = !sort.length && view.manualOrder ? new Map(view.manualOrder.map((id, i) => [id, i])) : null;
  const byKey = (a: Placed, b: Placed) => a.key - b.key || a.el.y - b.el.y || (a.el.id < b.el.id ? -1 : 1);
  const order = (list: Placed[]): Placed[] => {
    const manualSorted = [...list].sort(
      manual ? (a, b) => (manual.get(a.el.id) ?? Number.POSITIVE_INFINITY) - (manual.get(b.el.id) ?? Number.POSITIVE_INFINITY) || byKey(a, b) : byKey,
    );
    if (!sort.length) return manualSorted;
    return sortByValues(
      manualSorted,
      sort.map((s) => ({ read: (p: Placed) => (p.el.type === 'card' ? cardQueryValue(k, p.el as CardElement, s.field, schema) : null), dir: s.dir })),
    );
  };
  const filter = view.filter;
  const shows = (el: BoardElement) => el.type !== 'card' || !filter || cardPasses(k, el as CardElement, filter, schema);

  const place = (el: BoardElement, col: number, y: number): number => {
    const collapsed = !!k.columns[col].collapsed;
    // A collapsed column keeps its items stacked as usual, centered on its strip (so their
    // centers say which column they are in); they are folded away, so they don't size the board.
    const x = collapsed ? k.x + kanbanColumnLeft(k, col) + collapsedW / 2 - inner / 2 : k.x + kanbanColumnLeft(k, col) + pad;
    // Task cards take the column's width (their height follows); other items shrink to fit.
    const w = el.type === 'card' || el.w > inner ? inner : el.w;
    const h = el.type === 'card' || w === el.w ? el.h : (el.h * w) / el.w;
    const ix = el.type === 'card' || w === inner ? x : x + (inner - w) / 2;
    const patch: Record<string, unknown> = {};
    if (Math.abs(el.x - ix) > EPS) patch.x = ix;
    if (Math.abs(el.y - y) > EPS) patch.y = y;
    if (Math.abs(el.w - w) > EPS) patch.w = w;
    if (Math.abs(el.h - h) > EPS) patch.h = h;
    if (el.rotation) patch.rotation = 0;
    // Items sit on the board, never under it.
    if (el.z <= k.z) patch.z = k.z + 1 + patches.length / 1000;
    if (Object.keys(patch).length) Object.assign(own(el.id), patch);
    return h;
  };

  const counts = k.columns.map((_, col) => cells.reduce((sum, row) => sum + row[col].length, 0));
  const overflow: Placed[][] = k.columns.map(() => []);
  const laneOut: KanbanLane[] = [];
  let y0 = k.y + headerH + colHeadH;
  cells.forEach((row, lane) => {
    const top = y0 + (lanes ? laneHeadH : 0) + pad;
    let tallest = 0;
    row.forEach((list, col) => {
      const ordered = order(list);
      const shown = ordered.filter((p) => shows(p.el));
      const limit = k.columns[col].limit || Infinity;
      let y = top;
      for (const { el } of shown.slice(0, limit)) y += place(el, col, y) + itemGap;
      // Beyond the limit, then what the filter leaves out: in that order, below the board.
      overflow[col].push(...shown.slice(limit), ...ordered.filter((p) => !shows(p.el)));
      const folded = shown.length > limit || shown.length < ordered.length;
      const used = (shown.length ? y - itemGap - top : 0) + (folded ? KANBAN_PLAN.moreH : 0);
      if (!k.columns[col].collapsed) tallest = Math.max(tallest, used);
    });
    const h = lanes ? laneHeadH + Math.max(KANBAN_PLAN.minLaneBody, tallest + 2 * pad) : Math.max(KANBAN_PLAN.minBody, tallest + 2 * pad);
    if (lanes) laneOut.push({ id: laneKeys[lane], h });
    y0 += h;
  });

  const h = y0 - k.y + gap;
  // Folded away (beyond a column's limit, left out by the filter): stacked in their column below the board.
  overflow.forEach((list, col) => {
    let y = k.y + h + 4 * gap;
    for (const { el } of list) y += place(el, col, y) + itemGap;
  });

  const w = n ? kanbanBoardWidth(k) : gap;
  const self: Record<string, unknown> = {};
  if (Math.abs(k.h - h) > EPS) self.h = h;
  if (Math.abs(k.w - w) > EPS) self.w = w;
  const lanesNow = lanes ? laneOut : null;
  if (JSON.stringify(k.lanes ?? null) !== JSON.stringify(lanesNow)) self.lanes = lanesNow;
  // The manual order is back: the view no longer keeps it.
  if (manual) Object.assign(self, savedViews(k, withoutManualOrder(view)));
  if (Object.keys(self).length) patches.push({ id: k.id, patch: self });
  return { patches: patches.filter((p) => Object.keys(p.patch).length), counts };
}

const withoutManualOrder = ({ manualOrder: _m, ...view }: ViewConfig): ViewConfig => view;

/** The items' manual order now (ids, column by column, row by row, top to bottom): what a sort keeps while it lasts. */
export function manualOrderOf(k: KanbanElement, all: readonly BoardElement[]): string[] {
  const items = all.filter((el) => isStackable(el, k.id));
  const at = (el: BoardElement) => [kanbanColumnAt(k, centerX(el)), k.lanes?.length ? kanbanLaneAt(k, centerY(el)) : 0, centerY(el)] as const;
  return items
    .map((el) => ({ el, a: at(el) }))
    .sort((p, q) => p.a[0] - q.a[0] || p.a[1] - q.a[1] || p.a[2] - q.a[2] || (p.el.id < q.el.id ? -1 : 1))
    .map((p) => p.el.id);
}

/**
 * Moves that keep every item in its column when the columns change (added, removed, reordered,
 * collapsed, resized): each item travels by its column's change of position (center to center).
 * Items of a removed column go to `fallbackId`'s column.
 */
export function reflowMoves(
  k: KanbanElement,
  next: Pick<KanbanElement, 'colW' | 'columns'>,
  all: readonly BoardElement[],
  fallbackId: string | null,
): Array<{ id: string; dx: number; dy: number }> {
  const mid = (g: Pick<KanbanElement, 'colW' | 'columns'>, i: number) => kanbanColumnLeft(g, i) + kanbanColumnWidth(g, i) / 2;
  const out: Array<{ id: string; dx: number; dy: number }> = [];
  for (const el of all) {
    if (!isStackable(el, k.id)) continue;
    const oldIdx = kanbanColumnAt(k, centerX(el));
    const colId = k.columns[oldIdx].id;
    let newIdx = next.columns.findIndex((c) => c.id === colId);
    // A removed column's items join the fallback column (and take its status, as a drop would).
    if (newIdx < 0) newIdx = fallbackId ? next.columns.findIndex((c) => c.id === fallbackId) : -1;
    if (newIdx < 0) continue;
    const dx = mid(next, newIdx) - mid(k, oldIdx);
    if (Math.abs(dx) > EPS) out.push({ id: el.id, dx, dy: 0 });
  }
  return out;
}

// ------------------------------------------------------------------ regrouping

const NONE_COLOR = '#8A89A3';
const GROUP_COLORS = ['#8A89A3', '#2E9BF0', '#F5A524', '#1FA463', '#8B5CF6', '#E64DA6', '#14B8A6', '#E5484D'];

/** A swimlane's or column's title for group key `key` of field `f` (person names come from the people lookup when drawn). */
export function groupTitle(f: Pick<FieldDef, 'name' | 'type' | 'options'>, key: string, personName?: (id: string) => string | undefined): string {
  if (key === NO_GROUP) return `No ${f.name}`;
  if (f.type === 'checkbox') return `${f.name}: ${key === 'true' ? 'yes' : 'no'}`;
  if (f.type === 'person') return personName?.(key) ?? 'Someone';
  return f.options?.find((o) => o.id === key)?.label || 'Untitled';
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
      color: o?.color ?? (key === NO_GROUP ? NONE_COLOR : GROUP_COLORS[i % GROUP_COLORS.length]),
      ...(kept.wip ? { wip: kept.wip } : {}),
      ...(kept.collapsed ? { collapsed: true } : {}),
      ...(kept.limit ? { limit: kept.limit } : {}),
    };
  });
}

const settingsOf = (c: KanbanColumn): GroupSettings | null =>
  c.wip || c.collapsed || c.limit ? { ...(c.wip ? { wip: c.wip } : {}), ...(c.collapsed ? { collapsed: true } : {}), ...(c.limit ? { limit: c.limit } : {}) } : null;

/**
 * Grouping kanban `k` by field `fieldId` (step 2c), as one change: the old group field's values
 * written onto the cards from where each stands, its options back into its `fields` entry, the new
 * field's options as the columns (its stored values dropped: the column says it now), each card
 * moved to the column of its value, and column settings kept per field in the view. Null when
 * nothing changes (or it can't group by that field).
 */
export function planGroupBy(
  k: KanbanElement,
  all: readonly BoardElement[],
  fieldId: string,
): { kanban: Partial<KanbanElement>; values: KanbanPatch[]; moves: Array<{ id: string; dx: number; dy: number }> } | null {
  const view = boardView(k);
  const oldId = view.groupBy ?? COLUMN_FIELD_ID;
  if (fieldId === oldId) return null;
  const schema = collectionSchema(k);
  const oldF = schema.find((f) => f.id === oldId);
  const newF = schema.find((f) => f.id === fieldId);
  if (!oldF || !newF || !isGroupable(newF)) return null;
  const members = all.filter((el) => isStackable(el, k.id));

  const values: KanbanPatch[] = [];
  for (const el of members) {
    if (el.type !== 'card') continue;
    const card = el as CardElement;
    const v = k.columns.length ? groupKeyValue(oldF, k.columns[kanbanColumnAt(k, centerX(card))].id) : null;
    const next = { ...(card.values ?? {}) };
    if (v === null) delete next[oldId];
    else next[oldId] = v;
    delete next[fieldId];
    if (JSON.stringify(next) !== JSON.stringify(card.values ?? {})) values.push({ id: card.id, patch: { values: next } });
  }

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
  const mid = (i: number) => k.x + kanbanColumnLeft(nextK, i) + kanbanColumnWidth(nextK, i) / 2;
  const moves = members
    .map((el) => ({ id: el.id, dx: mid(Math.max(0, columns.findIndex((c) => c.id === keyOf.get(el.id)))) - centerX(el), dy: 0 }))
    .filter((m) => Math.abs(m.dx) > EPS);
  return {
    kanban: { columns, fields: storedFields(schema, fieldId), ...savedViews(k, nextView), ...(nextView.subGroupBy ? {} : { lanes: null }), w: kanbanBoardWidth(nextK) },
    values,
    moves,
  };
}

// ------------------------------------------------------------------ a server's change, laid out

type DraftLike = { id: string; type?: string } & Record<string, unknown>;
export interface KanbanChange {
  create?: DraftLike[];
  update?: KanbanPatch[];
  remove?: string[];
}

/**
 * `change` (written outside the kanban feature: the public API, MCP) with every kanban it touches
 * laid out as the feature's own `arrange` would lay it out after the same change made locally: a
 * card whose grouped or swimlane value changed moves to its column / row, one placed into a cell
 * takes its row's value, one the filter now leaves out folds away. Kanbans the change creates are
 * laid out by whoever made them. The layout's patches are merged into the change's own entries.
 */
export function withKanbanLayout<C extends KanbanChange>(before: readonly BoardElement[], change: C): C {
  const now = new Map(before.map((el) => [el.id, el]));
  const was = new Map(now);
  const previous = new Map<string, BoardElement | null>();
  for (const d of change.create ?? []) {
    now.set(d.id, { z: 0, ...d } as unknown as BoardElement);
    previous.set(d.id, null);
  }
  for (const u of change.update ?? []) {
    const el = now.get(u.id);
    if (!el) continue;
    if (!previous.has(u.id)) previous.set(u.id, was.get(u.id) ?? null);
    now.set(u.id, { ...el, ...u.patch } as BoardElement);
  }
  for (const id of change.remove ?? []) now.delete(id);
  const touched = new Set<string>();
  for (const [id, prev] of previous) {
    const el = now.get(id);
    for (const fid of [prev?.frameId, el?.frameId]) if (fid && was.has(fid) && now.get(fid)?.type === 'kanban') touched.add(fid);
    if (el?.type === 'kanban' && was.has(id)) touched.add(id);
  }
  if (!touched.size) return change;
  const after = [...now.values()];
  const extra = new Map<string, Record<string, unknown>>();
  for (const kid of touched) {
    const k = now.get(kid) as KanbanElement;
    for (const p of planKanban(k, after, previous).patches) extra.set(p.id, { ...extra.get(p.id), ...p.patch });
  }
  if (!extra.size) return change;
  const create = (change.create ?? []).map((d) => (extra.has(d.id) ? { ...d, ...extra.get(d.id) } : d));
  const created = new Set(create.map((d) => d.id));
  const update = (change.update ?? []).map((u) => (extra.has(u.id) ? { id: u.id, patch: { ...u.patch, ...extra.get(u.id) } } : u));
  const updated = new Set(update.map((u) => u.id));
  for (const [id, patch] of extra) if (!created.has(id) && !updated.has(id)) update.push({ id, patch });
  return { ...change, ...(change.create ? { create } : {}), update };
}
