// Spatial reading of a board: reading order and proximity clusters. Pure and deterministic
// (the same boxes give the same answer everywhere).
import type { Rect } from '../geometry';

/**
 * `list` in reading order: rows top to bottom (items whose vertical extents overlap the row's
 * first item share a row), left to right inside a row. Items without bounds go last, in order.
 */
export function readingOrder<T>(list: readonly T[], boundsOf: (t: T) => Rect | null): T[] {
  const placed = list.map((t, i) => ({ t, i, b: boundsOf(t) }));
  const withB = placed.filter((p) => p.b).sort((a, b) => a.b!.y - b.b!.y || a.b!.x - b.b!.x || a.i - b.i);
  const rows: Array<typeof withB> = [];
  for (const p of withB) {
    const row = rows[rows.length - 1];
    const head = row?.[0].b;
    // Same row while it starts above the middle of the row's first item.
    if (row && head && p.b!.y < head.y + head.h / 2) row.push(p);
    else rows.push([p]);
  }
  const out = rows.flatMap((r) => r.sort((a, b) => a.b!.x - b.b!.x || a.b!.y - b.b!.y || a.i - b.i)).map((p) => p.t);
  return [...out, ...placed.filter((p) => !p.b).map((p) => p.t)];
}

/** Two boxes belong together when the gap between them is at most this (world units). */
export function linkGap(a: Rect, b: Rect): number {
  const size = Math.max(Math.min(a.w, a.h), Math.min(b.w, b.h));
  return Math.max(16, Math.min(64, size * 0.3));
}

const gapBetween = (a: Rect, b: Rect) =>
  Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));

/**
 * Proximity clusters (single linkage): indices of `boxes`, grouped. Two boxes are linked when the
 * gap between them is within `linkGap`, or when `links` joins them (a connector between them).
 * Uses a spatial hash, so thousands of boxes stay cheap.
 */
export function clusterBoxes(boxes: readonly Rect[], links: ReadonlyArray<[number, number]> = []): number[][] {
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const CELL = 256;
  const grid = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    const pad = 64;
    for (let cx = Math.floor((b.x - pad) / CELL); cx <= Math.floor((b.x + b.w + pad) / CELL); cx++)
      for (let cy = Math.floor((b.y - pad) / CELL); cy <= Math.floor((b.y + b.h + pad) / CELL); cy++) {
        const k = `${cx},${cy}`;
        const cell = grid.get(k);
        if (cell) cell.push(i);
        else grid.set(k, [i]);
      }
  });
  const tried = new Set<number>();
  for (const cell of grid.values())
    for (let a = 0; a < cell.length; a++)
      for (let b = a + 1; b < cell.length; b++) {
        const i = cell[a];
        const j = cell[b];
        const key = i < j ? i * boxes.length + j : j * boxes.length + i;
        if (tried.has(key)) continue;
        tried.add(key);
        if (gapBetween(boxes[i], boxes[j]) <= linkGap(boxes[i], boxes[j])) parent[find(i)] = find(j);
      }
  // Joined by a connector: one diagram, however far apart.
  for (const [i, j] of links) parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  boxes.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()];
}
