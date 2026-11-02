// Placement by meaning (StructurePlacement): what a structure adds — or existing items it moves —
// goes INTO something people already have (a frame, a kanban column, a cluster) or into a new
// frame / kanban, never at coordinates the caller picks. Pure over the board as the actor sees it,
// so every sink (board, preview, suggestions) and the tracker import plan with the same rules:
//   frame    on free space inside it, else below its contents; the frame grows to hold them
//   kanban   stacked at the bottom of the column (by title / id, else each card's status, else
//            the first); a card takes the column's status as a drop would (unless `keepStatus`:
//            an imported issue's status is the tracker's, so it goes to the column of its status
//            instead); the kanban grows to hold them
//   cluster  right below (or beside) its members, close enough to read as one cluster
import {
  APART_GAP,
  boardView,
  clusterBoxes,
  collectionSchema,
  groupFieldId,
  groupKeyOf,
  groupKeyValue,
  groupTitle,
  kanbanLanesTop,
  readFieldInputs,
  storedKey,
  findFreeSpot,
  frameDraft,
  itemCardHeight,
  KANBAN_LAYOUT,
  kanbanColumnAt,
  kanbanColumnLeft,
  kanbanColumnWidth,
  layoutStructure,
  LayoutError,
  placeLaidOut,
  richTextToPlain,
  rotatedBounds,
  STICKY_SIZE,
  translateDraft,
  unionRects,
  type BoardElement,
  type CardStatus,
  type ElementDraft,
  type FieldDef,
  type FieldValues,
  type KanbanElement,
  type LaidOut,
  type Point,
  type Rect,
  type StructurePlacement,
} from '@freero/shared';
import type { BoardChange, BoardView } from '../realtime/index';

/** Loose items: what a cluster is made of and what may be moved into place. */
export const LOOSE: ReadonlySet<string> = new Set(['sticky', 'card', 'shape', 'text', 'image', 'emoji', 'icon', 'embed', 'pdf', 'media', 'file']);
export const LOOSE_TYPES = LOOSE;
const PAD = 40;
const JOIN = 24;

type Fields = Record<string, unknown>;

export interface Placed extends LaidOut {
  bounds: Rect;
  /** Where each moved item now belongs (null: no frame). */
  frameOf: Map<string, string | null>;
  /** More fields a moved item takes where it lands (a kanban column's width, height and status). */
  moveExtra: Map<string, Fields>;
  /** Containers that grew to hold what came in (a frame's or a kanban's size). */
  grow: NonNullable<BoardChange['update']>;
  /** The frame or kanban made by `newFrame` / `newKanban`. */
  containerId?: string;
}

export interface PlaceContext {
  newId: () => string;
  /** Every element the result must stay clear of (not the ones that move). */
  obstacles: Rect[];
  /** Items this change moves (they are not obstacles and not "already there"). */
  travelling: ReadonlySet<string>;
  near?: Point;
  /** Cards keep their status (tracker imports): a column with another status doesn't change it. */
  keepStatus?: boolean;
  /**
   * The column a new card goes to (a column id or title) when the caller has decided it — a
   * tracker import puts an issue in the column named after its status (trackers/kanban.ts); it
   * wins over the card's status. Undefined for a card: the usual rule.
   */
  columnFor?: (id: string) => string | undefined;
  /** The columns a `newKanban` gets (default To do / Doing / Done), with the status each sets. */
  newKanbanColumns?: Array<{ title: string; status: CardStatus | null }>;
}

interface Wrapped {
  laid: LaidOut;
  frameOf: Map<string, string | null>;
  moveExtra: Map<string, Fields>;
  containerId?: string;
}

const plain = (v: unknown) => (typeof v === 'string' ? richTextToPlain(v) : '').trim();
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Lays `laid` (relative to (0, 0)) out where `placement` says, on `view`. */
export function placeLaid(laid: LaidOut, placement: StructurePlacement | undefined, view: BoardView, ctx: PlaceContext): Placed {
  const p = placement ?? {};
  const given = [p.into, p.newFrame, p.newKanban].filter((v) => v !== undefined && v !== null).length;
  if (given > 1) throw new LayoutError('Give one of placement.into, placement.newFrame or placement.newKanban');
  if (p.column !== undefined && p.into === undefined) throw new LayoutError('placement.column goes with placement.into (a kanban)');
  if (p.row !== undefined && p.into === undefined) throw new LayoutError('placement.row goes with placement.into (a kanban with swimlanes)');
  if (laid.fieldsOf && Object.keys(laid.fieldsOf).length && p.into === undefined)
    throw new LayoutError('Card fields belong to a kanban: give placement.into a kanban (its fields are listed with it in the outline)');
  if (p.into !== undefined) return placeInto(laid, String(p.into), p.column === undefined ? undefined : String(p.column), p.row === undefined ? undefined : String(p.row), view, ctx);
  if (p.newFrame !== undefined) return free(inNewFrame(laid, String(p.newFrame), ctx), ctx);
  if (p.newKanban !== undefined) return free(inNewKanban(laid, String(p.newKanban), view, ctx), ctx);
  return free({ laid, frameOf: new Map(), moveExtra: new Map() }, ctx);
}

function free(w: Wrapped, ctx: PlaceContext): Placed {
  const placed = placeLaidOut(w.laid, { obstacles: ctx.obstacles, near: ctx.near, gap: APART_GAP });
  return { ...placed, frameOf: w.frameOf, moveExtra: w.moveExtra, grow: [], ...(w.containerId ? { containerId: w.containerId } : {}) };
}

// ---- new containers ----

function inNewFrame(laid: LaidOut, title: string, ctx: PlaceContext): Wrapped {
  const id = ctx.newId();
  const top = PAD + 16;
  const f = frameDraft(id, { x: 0, y: 0, w: laid.size.w + 2 * PAD, h: laid.size.h + top + PAD }, title.slice(0, 200));
  const t = translated(laid, PAD, top, id);
  return { laid: { ...laid, elements: [f, ...t.elements], moves: t.moves, size: { w: f.w, h: f.h } }, frameOf: t.frameOf, moveExtra: new Map(), containerId: id };
}

function inNewKanban(laid: LaidOut, title: string, view: BoardView, ctx: PlaceContext): Wrapped {
  const given = ctx.newKanbanColumns?.length ? ctx.newKanbanColumns : null;
  const titles = given?.map((c) => c.title) ?? ['To do', 'Doing', 'Done'];
  const laidK = layoutStructure({ kind: 'kanban', title: title.slice(0, 200) || 'Kanban', columns: titles.map((t) => ({ title: t, items: [] })) }, { newId: ctx.newId }).elements[0] as ElementDraft & KanbanElement;
  const k = given ? ({ ...laidK, columns: laidK.columns.map((c, i) => ({ ...c, status: given[i].status })) } as typeof laidK) : laidK;
  const stacked = stack({ ...k, x: 0, y: 0 } as KanbanElement, unitsOf(laid, view), undefined, [], { keepStatus: true, columnFor: ctx.columnFor });
  const frameOf = new Map<string, string | null>();
  const moveExtra = new Map<string, Fields>();
  const moves: LaidOut['moves'] = [];
  const elements: ElementDraft[] = [{ ...k, h: stacked.h } as ElementDraft];
  for (const s of stacked.placed) {
    if (s.draft) elements.push(s.draft);
    else {
      moves.push({ id: s.id, x: s.x, y: s.y });
      frameOf.set(s.id, k.id);
      moveExtra.set(s.id, sizeAndStatus(s.patch));
    }
  }
  return { laid: { ...laid, elements, moves, size: { w: k.w, h: stacked.h } }, frameOf, moveExtra, containerId: k.id };
}

// ---- into what is there ----

function placeInto(laid: LaidOut, into: string, column: string | undefined, row: string | undefined, view: BoardView, ctx: PlaceContext): Placed {
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  let target: BoardElement | undefined;
  let col = column;
  let lane = row;
  // `<kanbanId>:<columnId>` (a column), `<kanbanId>:<columnId>:<rowId>` (a swimlane cell).
  const colRef = /^([^:]+):([^:]+)(?::(.+))?$/.exec(into);
  if (into.startsWith('cluster:')) target = byId.get(into.slice('cluster:'.length));
  else if (colRef && byId.get(colRef[1])?.type === 'kanban') {
    target = byId.get(colRef[1]);
    col = col ?? colRef[2];
    lane = lane ?? colRef[3];
  } else target = byId.get(into);
  if (!target) throw new LayoutError(`No item ${into} on this board (use an id from the outline: a frame, a kanban, a kanban column or a cluster)`);
  if (target.locked && (target.type === 'frame' || target.type === 'kanban')) throw new LayoutError(`That ${target.type} is locked`);
  if (col !== undefined && target.type !== 'kanban') throw new LayoutError(`placement.column is for a kanban; that item is a ${target.type}`);
  if (lane !== undefined && target.type !== 'kanban') throw new LayoutError(`placement.row is for a kanban; that item is a ${target.type}`);
  if (laid.fieldsOf && Object.keys(laid.fieldsOf).length && target.type !== 'kanban') throw new LayoutError(`Card fields belong to a kanban; that item is a ${target.type}`);
  if (target.type === 'kanban') return intoKanban(laid, target as KanbanElement, col, lane, view, ctx);
  if (target.type === 'frame') return intoFrame(laid, target, view, ctx);
  if (!LOOSE.has(target.type)) throw new LayoutError(`Items go into a frame, a kanban or a cluster; that item is a ${target.type}`);
  if (laid.parts?.some((pt) => pt.titleId)) throw new LayoutError('That cluster has its title already: leave the title out');
  return intoCluster(laid, target, view, ctx);
}

interface Unit {
  id: string;
  type: string;
  draft?: ElementDraft;
  el?: BoardElement;
  status: CardStatus | null;
  /** A new card's fields, read against the kanban it goes into (stored values, without the column field's). */
  values?: FieldValues;
  /** Its value for the field the kanban is grouped by, as a column id. */
  groupKey?: string;
}

/** What goes into a kanban: the new top-level stickies and cards and the moved items, in input order. */
function unitsOf(laid: LaidOut, view: BoardView): Unit[] {
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  const drafts = new Map(laid.elements.filter((e) => !e.frameId).map((e) => [e.id, e]));
  const order = laid.parts?.flatMap((pt) => pt.ids) ?? [...drafts.keys(), ...laid.moves.map((m) => m.id)];
  const extra = [...drafts.keys()].filter((id) => !order.includes(id));
  if (laid.elements.some((e) => e.frameId) || extra.length) throw new LayoutError('Only sticky notes and cards go into a kanban column (leave out titles, frames and diagrams)');
  return order.map((id) => {
    const d = drafts.get(id);
    const el = d ? undefined : byId.get(id);
    const type = (d ?? el)?.type ?? '';
    if (type !== 'sticky' && type !== 'card') throw new LayoutError(`Only sticky notes and cards go into a kanban column (${id} is a ${type || 'missing item'})`);
    const status = type === 'card' ? (((d ?? el) as { status?: CardStatus | null }).status ?? null) : null;
    return { id, type, ...(d ? { draft: d } : { el }), status };
  });
}

interface Stacked {
  placed: Array<{ id: string; x: number; y: number; draft?: ElementDraft; patch: Fields }>;
  h: number;
}

/** What a moved item takes from its column besides the position. */
const sizeAndStatus = ({ x: _x, y: _y, frameId: _f, ...rest }: Fields): Fields => rest;

function columnIndex(k: KanbanElement, column: string): number {
  const want = norm(column);
  const i = k.columns.findIndex((c) => c.id === column || norm(plain(c.title)) === want);
  if (i < 0) throw new LayoutError(`No column "${column.slice(0, 80)}" in that kanban; its columns: ${k.columns.map((c) => plain(c.title) || c.id).join(', ')}`);
  return i;
}

/** The column an element's center is over (the kanban's own rule). */
function columnOf(k: KanbanElement, el: { x: number; w: number }): number {
  return kanbanColumnAt(k, el.x + el.w / 2);
}

/** The swimlane field of `k` and its rows (as laid out now), when it has swimlanes. */
function lanesOf(k: KanbanElement): { field: FieldDef; rows: NonNullable<KanbanElement['lanes']> } | null {
  const id = boardView(k).subGroupBy;
  const field = id ? collectionSchema(k).find((f) => f.id === id) : undefined;
  return field && k.lanes?.length ? { field, rows: k.lanes } : null;
}

/** A swimlane row of `k` named by its id or its title ("No Team", an option's label). */
function rowIndex(k: KanbanElement, lanes: NonNullable<ReturnType<typeof lanesOf>>, row: string): number {
  const want = norm(row);
  const i = lanes.rows.findIndex((r) => r.id === row || norm(groupTitle(lanes.field, r.id)) === want);
  if (i < 0) throw new LayoutError(`No row "${row.slice(0, 80)}" in that kanban; its rows: ${lanes.rows.map((r) => groupTitle(lanes.field, r.id)).join(', ')}`);
  return i;
}

function stack(k: KanbanElement, units: Unit[], column: string | undefined, present: BoardElement[], opts: Pick<PlaceContext, 'keepStatus' | 'columnFor'> & { row?: string }): Stacked {
  const { pad, itemGap, headerH, colHeadH } = KANBAN_LAYOUT;
  const named = column === undefined ? -1 : columnIndex(k, column);
  const byStatus = (s: CardStatus | null) => (s ? k.columns.findIndex((c) => c.status === s) : -1);
  const lanes = lanesOf(k);
  if (opts.row !== undefined && !lanes) throw new LayoutError('That kanban has no swimlanes: leave placement.row out');
  const namedRow = lanes && opts.row !== undefined ? rowIndex(k, lanes, opts.row) : -1;
  const top = k.y + headerH + colHeadH + pad - itemGap;
  const bottoms = k.columns.map((_, i) => present.filter((el) => columnOf(k, el) === i).reduce((m, el) => Math.max(m, el.y + el.h), top));
  const inner = k.colW - 2 * pad;
  const placed: Stacked['placed'] = [];
  for (const u of units) {
    // A column the caller chose for this card (a tracker issue's status name), else the one named,
    // else its value for the grouped field, else its status's, else the first.
    const chosen = u.draft ? opts.columnFor?.(u.id) : undefined;
    const byValue = u.groupKey !== undefined ? k.columns.findIndex((c) => c.id === u.groupKey) : -1;
    if (chosen === undefined && u.groupKey !== undefined && byValue < 0 && named < 0)
      throw new LayoutError(`No column for that value of “${collectionSchema(k).find((f) => f.id === groupFieldId(k))?.name ?? 'the column field'}”; its columns: ${k.columns.map((c) => plain(c.title) || c.id).join(', ')}`);
    let ci = chosen !== undefined ? columnIndex(k, chosen) : named >= 0 ? named : byValue >= 0 ? byValue : Math.max(0, byStatus(u.status));
    // An imported issue's status is the tracker's: where it lands never changes it.
    if (chosen === undefined && opts.keepStatus && u.status && k.columns[ci].status && k.columns[ci].status !== u.status && byStatus(u.status) >= 0) ci = byStatus(u.status);
    const c = k.columns[ci];
    const src = (u.draft ?? u.el) as unknown as { title?: unknown; description?: unknown };
    const w = u.type === 'sticky' ? Math.min(STICKY_SIZE, inner) : inner;
    const h = u.type === 'sticky' ? w : itemCardHeight(w, plain(src.title), plain(src.description));
    // Centered in its column (a collapsed column is a narrow strip: its items fold away there).
    const x = Math.round(k.x + kanbanColumnLeft(k, ci) + kanbanColumnWidth(k, ci) / 2 - w / 2);
    let y = Math.round(bottoms[ci] + itemGap);
    bottoms[ci] = y + h;
    const patch: Fields = { x, y, w, h, frameId: k.id };
    const values: FieldValues = { ...(u.values ?? {}) };
    if (lanes) {
      // In its row: the one named, else the row of its value, else the first ("No <field>").
      const own = u.draft ? lanes.rows.findIndex((r) => r.id === groupKeyOf(lanes.field, (u.values ?? {})[lanes.field.id] ?? null)) : -1;
      const ri = namedRow >= 0 ? namedRow : own >= 0 ? own : u.el ? Math.max(0, lanes.rows.findIndex((r) => r.id === storedKey(lanes.field, u.el!))) : 0;
      // Centered just inside the row's bottom edge: below what is in that cell, and the layout
      // (withKanbanLayout) stacks it there and writes the row's value.
      const rowBottom = kanbanLanesTop(k) + lanes.rows.slice(0, ri + 1).reduce((sum, r) => sum + r.h, 0);
      y = Math.round(rowBottom - 2 - h / 2);
      patch.y = y;
      const v = groupKeyValue(lanes.field, lanes.rows[ri].id);
      if (v === null) delete values[lanes.field.id];
      else values[lanes.field.id] = v;
    }
    if (u.draft && (Object.keys(values).length || u.values)) patch.values = values;
    if (u.type === 'card' && c.status && !opts.keepStatus) patch.status = c.status;
    // A board that colours its cards by column gives a card placed in a column that colour.
    if (u.type === 'card' && k.colorCards && c.color) patch.color = c.color;
    placed.push({ id: u.id, x, y, patch, ...(u.draft ? { draft: { ...u.draft, ...patch } as ElementDraft } : {}) });
  }
  // Folded (collapsed) columns don't size the board.
  const need = Math.max(top, ...bottoms.filter((_, i) => !k.columns[i].collapsed)) - k.y + pad + KANBAN_LAYOUT.gap;
  return { placed, h: Math.max(k.h, Math.ceil(need)) };
}

/** New cards' fields read against kanban `k`'s schema: stored values, and the column field's value as a column. */
function withFields(k: KanbanElement, units: Unit[], fieldsOf: LaidOut['fieldsOf']): Unit[] {
  if (!fieldsOf || !Object.keys(fieldsOf).length) return units;
  const schema = collectionSchema(k);
  const group = groupFieldId(k);
  return units.map((u) => {
    const raw = fieldsOf[u.id];
    if (!raw) return u;
    if (u.type !== 'card') throw new LayoutError('Only cards have fields');
    const read = readFieldInputs(schema, raw);
    if ('error' in read) throw new LayoutError(`fields: ${read.error}`);
    const values: FieldValues = {};
    let groupKey: string | undefined;
    for (const { field, value } of read.values) {
      if (field.id === group) groupKey = groupKeyOf(field, value);
      else if (value !== null) values[field.id] = value;
    }
    return { ...u, values, ...(groupKey !== undefined ? { groupKey } : {}) };
  });
}

function intoKanban(laid: LaidOut, k: KanbanElement, column: string | undefined, row: string | undefined, view: BoardView, ctx: PlaceContext): Placed {
  const units = withFields(k, unitsOf(laid, view), laid.fieldsOf);
  const present = view.elements.map((e) => e.el).filter((el) => el.frameId === k.id && !ctx.travelling.has(el.id) && el.type !== 'connector');
  const s = stack(k, units, column, present, { ...ctx, row });
  const elements = s.placed.flatMap((p) => (p.draft ? [p.draft] : []));
  const moved = s.placed.filter((p) => !p.draft);
  const moves = moved.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  const rects = s.placed.map((p) => ({ x: p.x, y: p.y, w: Number(p.patch.w), h: Number(p.patch.h) }));
  return {
    ...laid,
    elements,
    moves,
    size: { w: k.w, h: s.h },
    bounds: unionRects(rects) ?? { x: k.x, y: k.y, w: 0, h: 0 },
    frameOf: new Map(moved.map((p) => [p.id, k.id])),
    moveExtra: new Map(moved.map((p) => [p.id, sizeAndStatus(p.patch)])),
    grow: s.h !== k.h ? [{ id: k.id, patch: { h: s.h } }] : [],
  };
}

/** `laid` translated by (x, y), its top-level items (and the moved ones) in `frameId`. */
function translated(laid: LaidOut, x: number, y: number, frameId: string | null) {
  const elements = laid.elements.map((el) => {
    const t = translateDraft(el, x, y);
    return el.frameId ? t : ({ ...t, frameId } as ElementDraft);
  });
  const moves = laid.moves.map((m) => ({ id: m.id, x: m.x + x, y: m.y + y }));
  return { elements, moves, frameOf: new Map<string, string | null>(moves.map((m) => [m.id, frameId])) };
}

/** The frame's new bounds when `r` must fit inside it, with room around it (null: it fits). */
function grown(f: BoardElement, r: Rect): Fields | null {
  const x = Math.min(f.x, Math.floor(r.x - PAD));
  const y = Math.min(f.y, Math.floor(r.y - PAD));
  const w = Math.max(f.x + f.w, Math.ceil(r.x + r.w + PAD)) - x;
  const h = Math.max(f.y + f.h, Math.ceil(r.y + r.h + PAD)) - y;
  if (x === f.x && y === f.y && w === f.w && h === f.h) return null;
  // Only the frame's own bounds change: what is inside stays where it is.
  return { ...(x !== f.x ? { x } : {}), ...(y !== f.y ? { y } : {}), w, h };
}

function intoFrame(laid: LaidOut, f: BoardElement, view: BoardView, ctx: PlaceContext): Placed {
  const rects = view.elements
    .map((e) => e.el)
    .filter((el) => el.frameId === f.id && !ctx.travelling.has(el.id))
    .map((el) => rotatedBounds(el));
  const size = laid.size;
  const room = { x: f.x + PAD, y: f.y + PAD, w: f.w - 2 * PAD, h: f.h - 2 * PAD };
  let at: Point = { x: room.x, y: room.y };
  if (rects.length) {
    // Far enough from what is there that it doesn't read as part of a cluster there.
    const spot = findFreeSpot(rects, size, { x: f.x + f.w / 2, y: f.y + f.h / 2 }, APART_GAP, room);
    const fits = spot.x >= room.x && spot.y >= room.y && spot.x + size.w <= room.x + room.w && spot.y + size.h <= room.y + room.h;
    // No room left: below what is there, and the frame grows.
    const content = unionRects(rects)!;
    at = fits ? spot : { x: room.x, y: content.y + content.h + APART_GAP };
  }
  const t = translated(laid, Math.round(at.x), Math.round(at.y), f.id);
  const bounds = { x: Math.round(at.x), y: Math.round(at.y), w: size.w, h: size.h };
  const g = grown(f, bounds);
  return { ...laid, elements: t.elements, moves: t.moves, bounds, frameOf: t.frameOf, moveExtra: new Map(), grow: g ? [{ id: f.id, patch: g }] : [] };
}

/** The cluster `seed` belongs to: loose items in the same container, close together (the outline's rule). */
export function clusterOf(seed: BoardElement, view: BoardView, travelling: ReadonlySet<string> = new Set()): BoardElement[] {
  const container = seed.frameId ?? null;
  const loose = view.elements
    .map((e) => e.el)
    .filter((el) => LOOSE.has(el.type) && !el.attachedTo && (el.frameId ?? null) === container && (!travelling.has(el.id) || el.id === seed.id));
  const groups = clusterBoxes(loose.map((el) => rotatedBounds(el)));
  const at = loose.findIndex((el) => el.id === seed.id);
  return (groups.find((g) => g.includes(at)) ?? [at]).map((i) => loose[i]);
}

function intoCluster(laid: LaidOut, seed: BoardElement, view: BoardView, ctx: PlaceContext): Placed {
  const members = clusterOf(seed, view, ctx.travelling);
  const ids = new Set(members.map((m) => m.id));
  const container = seed.frameId ?? null;
  const siblings = view.elements
    .map((e) => e.el)
    .filter((el) => !ids.has(el.id) && !ctx.travelling.has(el.id) && (el.frameId ?? null) === container && el.type !== 'connector')
    .map((el) => rotatedBounds(el));
  const size = laid.size;
  // Close to the cluster (it takes them in), far from everything else (no other cluster does).
  const clear = (r: Rect) => !siblings.some((o) => r.x < o.x + o.w + APART_GAP && o.x < r.x + r.w + APART_GAP && r.y < o.y + o.h + APART_GAP && o.y < r.y + r.h + APART_GAP);
  // Touching a member (single linkage), never above the title: under the lowest member, or beside
  // the outermost one, level with the top of the items under the title.
  const titleTop = Math.min(...members.filter((m) => m.type !== 'text').map((m) => m.y));
  const body = members.filter((m) => m.type !== 'text' || m.y + m.h > titleTop + 4);
  const items = body.length ? body : members;
  const lowest = items.reduce((a, m) => (m.y + m.h > a.y + a.h ? m : a));
  const rightmost = items.reduce((a, m) => (m.x + m.w > a.x + a.w ? m : a));
  const leftmost = items.reduce((a, m) => (m.x < a.x ? m : a));
  const top = Math.min(...items.map((m) => m.y));
  const sides = [
    { x: lowest.x, y: lowest.y + lowest.h + JOIN },
    { x: rightmost.x + rightmost.w + JOIN, y: top },
    { x: leftmost.x - JOIN - size.w, y: top },
  ].map((p) => ({ ...p, ...size }));
  const at = sides.find(clear) ?? sides[0];
  const t = translated(laid, Math.round(at.x), Math.round(at.y), container);
  const bounds = { x: Math.round(at.x), y: Math.round(at.y), w: size.w, h: size.h };
  const frame = container ? view.elements.find((e) => e.el.id === container)?.el : undefined;
  const g = frame?.type === 'frame' ? grown(frame, bounds) : null;
  return { ...laid, elements: t.elements, moves: t.moves, bounds, frameOf: t.frameOf, moveExtra: new Map(), grow: g && frame ? [{ id: frame.id, patch: g }] : [] };
}
