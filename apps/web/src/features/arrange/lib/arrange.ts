// Align, distribute and tidy up: pure planning over "units" (a group moves as one box) plus the
// editor glue that applies a plan as ONE undo step.
import type { BoardElement } from '@freero/shared';
import type { Editor, Rect } from '@engine';

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** What moves as one: a lone element, or every selected member of a group. */
export interface Unit {
  ids: string[];
  box: Rect;
  /** Any member locked: the unit stays put (it may still be what others align to). */
  locked: boolean;
}

export interface Move {
  ids: string[];
  dx: number;
  dy: number;
}

const union = (rs: Rect[]): Rect => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};

/**
 * Units of a selection. Connectors are left out (attached ones follow their shapes), and so are
 * elements whose container is selected too (they travel with it).
 */
export function unitsOf(selection: BoardElement[], boxOf: (el: BoardElement) => Rect | null): Unit[] {
  const ids = new Set(selection.map((el) => el.id));
  const byKey = new Map<string, { ids: string[]; boxes: Rect[]; locked: boolean }>();
  for (const el of selection) {
    if (el.type === 'connector' || (el.frameId && ids.has(el.frameId))) continue;
    const box = boxOf(el);
    if (!box) continue;
    const key = el.groupId ? `g:${el.groupId}` : el.id;
    const u = byKey.get(key) ?? { ids: [], boxes: [], locked: false };
    u.ids.push(el.id);
    u.boxes.push(box);
    u.locked ||= !!el.locked;
    byKey.set(key, u);
  }
  return [...byKey.values()].map((u) => ({ ids: u.ids, box: union(u.boxes), locked: u.locked }));
}

/** Align every movable unit's edge/center to the selection's bounds (locked units included). */
export function planAlign(units: Unit[], edge: AlignEdge): Move[] {
  if (units.length < 2) return [];
  const b = union(units.map((u) => u.box));
  return units
    .filter((u) => !u.locked)
    .map((u) => {
      const r = u.box;
      switch (edge) {
        case 'left': return { ids: u.ids, dx: b.x - r.x, dy: 0 };
        case 'center': return { ids: u.ids, dx: b.x + b.w / 2 - (r.x + r.w / 2), dy: 0 };
        case 'right': return { ids: u.ids, dx: b.x + b.w - (r.x + r.w), dy: 0 };
        case 'top': return { ids: u.ids, dx: 0, dy: b.y - r.y };
        case 'middle': return { ids: u.ids, dx: 0, dy: b.y + b.h / 2 - (r.y + r.h / 2) };
        case 'bottom': return { ids: u.ids, dx: 0, dy: b.y + b.h - (r.y + r.h) };
      }
    })
    .filter((m) => Math.abs(m.dx) > 1e-6 || Math.abs(m.dy) > 1e-6);
}

/**
 * Equal gaps between consecutive units along the axis, keeping the first and last where they are.
 * Locked units take no part (they stay put and don't count). Needs 3+ movable units.
 */
export function planDistribute(units: Unit[], axis: DistributeAxis): Move[] {
  const free = units.filter((u) => !u.locked);
  if (free.length < 3) return [];
  const h = axis === 'horizontal';
  const start = (r: Rect) => (h ? r.x : r.y);
  const size = (r: Rect) => (h ? r.w : r.h);
  const sorted = [...free].sort((a, b) => start(a.box) + size(a.box) / 2 - (start(b.box) + size(b.box) / 2));
  const first = Math.min(...sorted.map((u) => start(u.box)));
  const last = Math.max(...sorted.map((u) => start(u.box) + size(u.box)));
  const total = sorted.reduce((s, u) => s + size(u.box), 0);
  const gap = (last - first - total) / (sorted.length - 1);
  const out: Move[] = [];
  let at = first;
  for (const u of sorted) {
    const d = at - start(u.box);
    if (Math.abs(d) > 1e-6) out.push({ ids: u.ids, dx: h ? d : 0, dy: h ? 0 : d });
    at += size(u.box) + gap;
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Tidy up: lay the movable units out in a neat grid from the selection's top-left, in reading
 * order. The current layout picks the column count (a messy row stays a row, a rough grid keeps
 * its columns); columns are as wide as their widest unit, rows as tall as their tallest, with one
 * even gap scaled to the items.
 */
export function planTidy(units: Unit[]): Move[] {
  const free = units.filter((u) => !u.locked);
  if (free.length < 2) return [];
  // Rows of the current layout: a unit joins a row when it starts above the row's first middle.
  const byTop = [...free].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const rows: Unit[][] = [];
  for (const u of byTop) {
    const row = rows[rows.length - 1];
    if (row && u.box.y < row[0].box.y + row[0].box.h / 2) row.push(u);
    else rows.push([u]);
  }
  for (const row of rows) row.sort((a, b) => a.box.x - b.box.x);
  // Keep the layout's column count when it already reads as a grid (every row but the last full),
  // else a square-ish grid. One row stays a row; one column stays a column.
  const widest = Math.max(...rows.map((r) => r.length));
  const gridLike = rows.length === 1 || widest === 1 || free.length >= (rows.length - 1) * widest + 1;
  const cols = gridLike ? widest : Math.ceil(Math.sqrt(free.length));
  const ordered = rows.flat();
  const grid: Unit[][] = [];
  for (let i = 0; i < ordered.length; i += cols) grid.push(ordered.slice(i, i + cols));
  const gap = Math.round(Math.min(64, Math.max(12, median(free.map((u) => Math.min(u.box.w, u.box.h))) * 0.12)));
  const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...grid.map((r) => r[c]?.box.w ?? 0)));
  const rowH = grid.map((r) => Math.max(...r.map((u) => u.box.h)));
  const origin = union(free.map((u) => u.box));
  const out: Move[] = [];
  let y = origin.y;
  grid.forEach((row, ri) => {
    let x = origin.x;
    row.forEach((u, ci) => {
      const dx = x - u.box.x;
      const dy = y - u.box.y;
      if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) out.push({ ids: u.ids, dx, dy });
      x += colW[ci] + gap;
    });
    y += rowH[ri] + gap;
  });
  return out;
}

// ---------------------------------------------------------------- editor glue
export function selectedUnits(editor: Editor): Unit[] {
  const sel = editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el);
  return unitsOf(sel, (el) => editor.getBounds([el.id]));
}

/** Movable units in the selection (what align/tidy need at least two of, distribute three). */
export const movableCount = (editor: Editor) => selectedUnits(editor).filter((u) => !u.locked).length;

/** Applies a plan as one undo step (never merged with a quick next action). */
export function applyMoves(editor: Editor, moves: Move[]) {
  if (!moves.length) return;
  editor.beginGesture();
  try {
    editor.moveBy(moves.flatMap((m) => m.ids.map((id) => ({ id, dx: m.dx, dy: m.dy }))));
  } finally {
    editor.endGesture();
  }
}
