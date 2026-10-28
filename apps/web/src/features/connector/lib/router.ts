// Orthogonal obstacle-avoiding router for elbow lines: A* over a sparse grid whose lines are the
// keep-out edges of the items in the way (each item grown by the stub margin), so routes run
// exactly one margin clear of them. Pure and deterministic: the same board gives the same route
// on every client (ties are broken by insertion order, never by timing).
import type { Point, Rect } from '@engine';

export interface RouteAroundInput {
  /** End of the start stub (one margin out from the start item), and where the line arrives. */
  from: Point;
  to: Point;
  /** Direction the start stub travels (null: free end, any direction). */
  leave: Point | null;
  /** Direction the line must travel INTO the end stub (null: free end). */
  arrive: Point | null;
  /** Clearance kept around every box (world units). */
  margin: number;
  /** The connected items' boxes: never crossed either. */
  ends: Rect[];
  /** Other items' boxes to go around. */
  obstacles: Rect[];
}

/** Cost of one bend, in world units of length: a bend is worth a short detour. */
const BEND = 40;
/** Grids bigger than this aren't searched (callers cap the obstacles long before). */
const MAX_NODES = 40_000;

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const dirIndex = (v: Point): number => (Math.abs(v.x) >= Math.abs(v.y) ? (v.x >= 0 ? 0 : 2) : v.y >= 0 ? 1 : 3);

function sortedUnique(values: number[]): number[] {
  const s = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > 1e-6) out.push(v);
  return out;
}

/** Index of the grid line at `v` (it is one; the nearest guards against merged duplicates). */
function indexOf(lines: number[], v: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid] < v - 1e-6) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const strictlyInside = (r: Rect, p: Point) => p.x > r.x + 1e-6 && p.x < r.x + r.w - 1e-6 && p.y > r.y + 1e-6 && p.y < r.y + r.h - 1e-6;

/** Min-heap of [priority, sequence, state]: equal priorities pop in insertion order. */
class Heap {
  private items: Array<[number, number, number]> = [];
  private seq = 0;
  get size() {
    return this.items.length;
  }
  push(priority: number, state: number) {
    const a = this.items;
    a.push([priority, this.seq++, state]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0][2];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/**
 * The bends of the shortest, least-bent orthogonal path from `from` to `to` that keeps `margin`
 * clear of every box: [from, …bends, to], or null when there is none (callers keep their route).
 */
export function routeAround(input: RouteAroundInput): Point[] | null {
  const { from, to, margin } = input;
  // Keep-outs: open interiors of the grown boxes. One that swallows an end of the search (an item
  // hugging the start item) can't be avoided, so it is left out.
  const keep = [...input.ends, ...input.obstacles]
    .map((r) => ({ x: r.x - margin, y: r.y - margin, w: r.w + 2 * margin, h: r.h + 2 * margin }))
    .filter((r) => !strictlyInside(r, from) && !strictlyInside(r, to));
  const xs = sortedUnique([from.x, to.x, (from.x + to.x) / 2, ...keep.flatMap((r) => [r.x, r.x + r.w])]);
  const ys = sortedUnique([from.y, to.y, (from.y + to.y) / 2, ...keep.flatMap((r) => [r.y, r.y + r.h])]);
  const nx = xs.length;
  const ny = ys.length;
  if (nx * ny > MAX_NODES) return null;

  // Rasterise the keep-outs: their edges are grid lines, so a node or a grid segment is either
  // inside one or not — no geometry in the search loop.
  const nodeBlocked = new Uint8Array(nx * ny);
  const hBlocked = new Uint8Array(nx * ny); // segment (i, j) → (i + 1, j)
  const vBlocked = new Uint8Array(nx * ny); // segment (i, j) → (i, j + 1)
  for (const r of keep) {
    const i0 = indexOf(xs, r.x);
    const i1 = indexOf(xs, r.x + r.w);
    const j0 = indexOf(ys, r.y);
    const j1 = indexOf(ys, r.y + r.h);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = i * ny + j;
        const insideX = i > i0 && i < i1;
        const insideY = j > j0 && j < j1;
        if (insideX && insideY) nodeBlocked[k] = 1;
        if (insideY && i < i1) hBlocked[k] = 1;
        if (insideX && j < j1) vBlocked[k] = 1;
      }
  }

  const start = indexOf(xs, from.x) * ny + indexOf(ys, from.y);
  const goal = indexOf(xs, to.x) * ny + indexOf(ys, to.y);
  if (nodeBlocked[start] || nodeBlocked[goal]) return null;
  const gi = Math.floor(goal / ny);
  const gj = goal % ny;
  const leave = input.leave ? dirIndex(input.leave) : -1;
  const arrive = input.arrive ? dirIndex(input.arrive) : -1;

  // State = node * 4 + direction of travel into it. Start states carry the stub's direction.
  const cost = new Float64Array(nx * ny * 4).fill(Infinity);
  const prev = new Int32Array(nx * ny * 4).fill(-1);
  const closed = new Uint8Array(nx * ny * 4);
  const heap = new Heap();
  const h = (n: number) => Math.abs(xs[Math.floor(n / ny)] - xs[gi]) + Math.abs(ys[n % ny] - ys[gj]);
  const startDirs = leave >= 0 ? [leave] : [0, 1, 2, 3];
  for (const d of startDirs) {
    cost[start * 4 + d] = 0;
    heap.push(h(start), start * 4 + d);
  }
  let found = -1;
  while (heap.size) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    const node = s >> 2;
    const dir = s & 3;
    const g = cost[s];
    if (node === goal) {
      found = s;
      break;
    }
    const i = Math.floor(node / ny);
    const j = node % ny;
    for (let d = 0; d < 4; d++) {
      if (d === (dir + 2) % 4) continue; // no U-turns
      const ni = i + DX[d];
      const nj = j + DY[d];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const seg = d === 0 ? hBlocked[i * ny + j] : d === 2 ? hBlocked[ni * ny + nj] : d === 1 ? vBlocked[i * ny + j] : vBlocked[ni * ny + nj];
      const next = ni * ny + nj;
      if (seg || nodeBlocked[next]) continue;
      let ng = g + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (d !== dir ? BEND : 0);
      if (next === goal && arrive >= 0) {
        if (d === (arrive + 2) % 4) continue; // would have to double back into the end stub
        if (d !== arrive) ng += BEND;
      }
      const ns = next * 4 + d;
      if (ng < cost[ns] - 1e-9) {
        cost[ns] = ng;
        prev[ns] = s;
        heap.push(ng + h(next), ns);
      }
    }
  }
  if (found < 0) return null;

  // Walk back, keeping only the corners.
  const nodes: number[] = [];
  for (let s = found; s >= 0; s = prev[s]) nodes.push(s >> 2);
  nodes.reverse();
  const pts = nodes.map((n) => ({ x: xs[Math.floor(n / ny)], y: ys[n % ny] }));
  pts[0] = from;
  pts[pts.length - 1] = to;
  return pts;
}
