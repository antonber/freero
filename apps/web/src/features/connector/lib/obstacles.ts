// What elbow lines route around: the boxes of other items between their ends. A coarse grid index
// is built once per board state (keyed by the engine's elements array, which is a new array after
// every change) and shared by every connector, so routing many lines on a big board stays cheap.
import type { BoardElement } from '@freero/shared';
import type { Editor, Rect } from '@engine';
import { aabb, ELBOW_MARGIN, type End } from './geometry';

/** At most this many items (the nearest) are routed around per line: big boards stay fast. */
export const MAX_OBSTACLES = 40;
/** Index cell size (world units). */
const CELL = 512;

type Defs = Pick<Editor, 'getDefinition'>;

/** Elements a connector can attach to. */
export function isConnectable(editor: Defs, el: BoardElement): boolean {
  const def = editor.getDefinition(el.type);
  return !!def && def.connectable !== false && !def.container && el.type !== 'connector' && el.type !== 'pen';
}

/**
 * Items lines go around: what they can attach to (shapes, stickies, cards…). Never lines,
 * drawings or containers (frames, kanban boards): lines run inside those.
 */
const isObstacle = (editor: Defs, el: BoardElement): boolean => isConnectable(editor, el);

interface Entry {
  id: string;
  box: Rect;
}

export class ObstacleIndex {
  private cells = new Map<string, Entry[]>();

  constructor(entries: Entry[]) {
    for (const e of entries) this.each(e.box, (key) => {
      const list = this.cells.get(key);
      if (list) list.push(e);
      else this.cells.set(key, [e]);
    });
  }

  private each(r: Rect, f: (key: string) => void) {
    const x0 = Math.floor(r.x / CELL);
    const x1 = Math.floor((r.x + r.w) / CELL);
    const y0 = Math.floor(r.y / CELL);
    const y1 = Math.floor((r.y + r.h) / CELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) f(`${x}:${y}`);
  }

  /** Entries whose box intersects `r`, in index order. */
  query(r: Rect): Entry[] {
    const seen = new Set<Entry>();
    const out: Entry[] = [];
    this.each(r, (key) => {
      for (const e of this.cells.get(key) ?? []) {
        if (seen.has(e) || !overlaps(e.box, r)) continue;
        seen.add(e);
        out.push(e);
      }
    });
    return out;
  }
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const indexes = new WeakMap<readonly BoardElement[], ObstacleIndex>();

/** The obstacle index of a board state (`editor.getElements()`), built once and cached. */
export function obstacleIndex(editor: Defs, elements: readonly BoardElement[]): ObstacleIndex {
  let index = indexes.get(elements);
  if (!index) {
    index = new ObstacleIndex(elements.filter((el) => isObstacle(editor, el)).map((el) => ({ id: el.id, box: aabb(el) })));
    indexes.set(elements, index);
  }
  return index;
}

/** Where an elbow line between two ends looks for items in its way. */
export function routeRegion(s: End, e: End): Rect {
  const boxes = [s.box ?? { x: s.p.x, y: s.p.y, w: 0, h: 0 }, e.box ?? { x: e.p.x, y: e.p.y, w: 0, h: 0 }];
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const m = 2 * ELBOW_MARGIN;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}

/**
 * Boxes an elbow line between `s` and `e` routes around: items in its region, except the two it
 * connects and anything overlapping them (an activation bar on its lifeline), nearest first and
 * at most MAX_OBSTACLES. Deterministic: ties go by id.
 */
export function obstaclesBetween(index: ObstacleIndex, s: End, e: End): Rect[] {
  const region = routeRegion(s, e);
  const ends = [s.box, e.box].filter((b): b is Rect => !!b);
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  const near = (b: Rect) => Math.abs(b.x + b.w / 2 - cx) + Math.abs(b.y + b.h / 2 - cy);
  return index
    .query(region)
    .filter((o) => !ends.some((b) => overlaps(b, o.box)))
    .sort((a, b) => near(a.box) - near(b.box) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_OBSTACLES)
    .map((o) => o.box);
}

/** The obstacles function for the live board an editor sees (inside transactions too). */
export const liveObstacles =
  (editor: Pick<Editor, 'getDefinition' | 'getElements'>) =>
  (s: End, e: End): Rect[] =>
    obstaclesBetween(obstacleIndex(editor, editor.getElements()), s, e);

/** Same boxes in the same order (renderers re-route only when this is false). */
export const sameRects = (a: Rect[], b: Rect[]) =>
  a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h);
