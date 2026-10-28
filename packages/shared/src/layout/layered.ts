// Layered ("Sugiyama") graph layout, dependency-free so the same function runs in the browser and
// on the server (@freero/shared has no dependencies; dagre would have bound the layout to one
// side). Steps: break cycles (reverse DFS back edges) → rank by longest path → dummy nodes on
// long edges → order each rank by barycenter sweeps, keeping the order with the fewest crossings
// → place each rank's nodes at the mean of their neighbours under minimum spacing (isotonic
// regression, so the result is the least-squares best for that order).

export interface LNode {
  id: string;
  w: number;
  h: number;
}
export interface LEdge {
  from: string;
  to: string;
}
export interface LayeredOptions {
  /** Ranks go down (TB) or right (LR). BT / RL are flipped by the caller. */
  direction: 'TB' | 'LR';
  /** Between neighbours in a rank. */
  nodeSep: number;
  /** Between ranks. */
  rankSep: number;
}
export interface LayeredResult {
  /** Top-left of every node, the whole drawing starting at (0, 0). */
  pos: Map<string, { x: number; y: number }>;
  /** Edges that were reversed to break cycles (drawn against the flow). */
  reversed: Set<number>;
  rank: Map<string, number>;
  w: number;
  h: number;
}

interface V {
  id: string;
  /** Cross-axis size (width for TB). */
  cross: number;
  /** Rank-axis size (height for TB). */
  along: number;
  dummy: boolean;
  rank: number;
  order: number;
  c: number; // cross-axis center
  up: number[]; // indices of neighbours in rank - 1
  down: number[]; // in rank + 1
}

export function layered(nodes: LNode[], edges: LEdge[], opts: LayeredOptions): LayeredResult {
  const tb = opts.direction === 'TB';
  const index = new Map<string, number>();
  const vs: V[] = nodes.map((n, i) => {
    index.set(n.id, i);
    return { id: n.id, cross: tb ? n.w : n.h, along: tb ? n.h : n.w, dummy: false, rank: 0, order: 0, c: 0, up: [], down: [] };
  });
  const n = vs.length;

  // 1. Cycles: reverse the back edges of a DFS (in input order, so the result is stable).
  const out: number[][] = vs.map(() => []);
  const valid: Array<{ a: number; b: number; i: number }> = [];
  edges.forEach((e, i) => {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) return;
    valid.push({ a, b, i });
    out[a].push(valid.length - 1);
  });
  const reversed = new Set<number>();
  const state = new Uint8Array(n); // 0 new, 1 on stack, 2 done
  const flip = new Set<number>();
  for (let s = 0; s < n; s++) {
    if (state[s]) continue;
    const stack: Array<[number, number]> = [[s, 0]];
    state[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, k] = top;
      if (k >= out[v].length) {
        state[v] = 2;
        stack.pop();
        continue;
      }
      top[1]++;
      const ei = out[v][k];
      const w = valid[ei].b;
      if (state[w] === 1) flip.add(ei);
      else if (!state[w]) {
        state[w] = 1;
        stack.push([w, 0]);
      }
    }
  }
  const dag: Array<{ a: number; b: number }> = [];
  const seen = new Set<string>();
  valid.forEach((e, ei) => {
    const [a, b] = flip.has(ei) ? [e.b, e.a] : [e.a, e.b];
    if (flip.has(ei)) reversed.add(e.i);
    const key = `${a}>${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    dag.push({ a, b });
  });

  // 2. Ranks: longest path from the sources, then sources pulled down next to their successors.
  const preds: number[][] = vs.map(() => []);
  const succs: number[][] = vs.map(() => []);
  for (const { a, b } of dag) {
    succs[a].push(b);
    preds[b].push(a);
  }
  const indeg = preds.map((p) => p.length);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) queue.push(i);
  const topo: number[] = [];
  while (queue.length) {
    const v = queue.shift()!;
    topo.push(v);
    for (const w of succs[v]) {
      vs[w].rank = Math.max(vs[w].rank, vs[v].rank + 1);
      if (--indeg[w] === 0) queue.push(w);
    }
  }
  for (let t = topo.length - 1; t >= 0; t--) {
    const v = topo[t];
    if (preds[v].length || !succs[v].length) continue;
    vs[v].rank = Math.min(...succs[v].map((w) => vs[w].rank)) - 1;
  }

  // 3. Dummy nodes so every edge joins neighbouring ranks.
  const DUMMY = Math.max(8, opts.nodeSep / 3);
  const link = (a: number, b: number) => {
    vs[a].down.push(b);
    vs[b].up.push(a);
  };
  for (const { a, b } of dag) {
    let prev = a;
    for (let r = vs[a].rank + 1; r < vs[b].rank; r++) {
      vs.push({ id: '', cross: DUMMY, along: 0, dummy: true, rank: r, order: 0, c: 0, up: [], down: [] });
      link(prev, vs.length - 1);
      prev = vs.length - 1;
    }
    link(prev, b);
  }
  const ranks: number[][] = [];
  for (let i = 0; i < vs.length; i++) (ranks[vs[i].rank] ??= []).push(i);
  for (let r = 0; r < ranks.length; r++) ranks[r] ??= [];

  // 4. Order: initial by a DFS from the first rank, then barycenter sweeps.
  const placed = new Set<number>();
  const initial: number[][] = ranks.map(() => []);
  const dfs = (v: number) => {
    const stack = [v];
    while (stack.length) {
      const x = stack.pop()!;
      if (placed.has(x)) continue;
      placed.add(x);
      initial[vs[x].rank].push(x);
      for (let k = vs[x].down.length - 1; k >= 0; k--) stack.push(vs[x].down[k]);
    }
  };
  for (const r of ranks) for (const v of r) if (!vs[v].up.length) dfs(v);
  for (const r of ranks) for (const v of r) dfs(v);
  let layers = initial;
  const setOrder = (ls: number[][]) => ls.forEach((l) => l.forEach((v, i) => (vs[v].order = i)));
  setOrder(layers);
  let best = layers.map((l) => [...l]);
  let bestCross = crossings(layers, vs);
  for (let iter = 0; iter < 16 && bestCross > 0; iter++) {
    const downward = iter % 2 === 0;
    const next = layers.map((l) => [...l]);
    const seq = downward ? next.map((_, i) => i).slice(1) : next.map((_, i) => i).reverse().slice(1);
    for (const r of seq) {
      const bary = (v: number) => {
        const nb = downward ? vs[v].up : vs[v].down;
        return nb.length ? nb.reduce((s, x) => s + vs[x].order, 0) / nb.length : vs[v].order;
      };
      const keyed = next[r].map((v) => ({ v, k: bary(v) }));
      keyed.sort((a, b) => a.k - b.k || vs[a.v].order - vs[b.v].order);
      next[r] = keyed.map((x) => x.v);
      next[r].forEach((v, i) => (vs[v].order = i));
    }
    layers = next;
    const c = crossings(layers, vs);
    if (c < bestCross) {
      bestCross = c;
      best = layers.map((l) => [...l]);
    }
  }
  layers = best;
  setOrder(layers);

  // 5. Cross-axis positions: packed, then pulled toward neighbours under spacing constraints.
  for (const l of layers) {
    let at = 0;
    for (const v of l) {
      vs[v].c = at + vs[v].cross / 2;
      at += vs[v].cross + opts.nodeSep;
    }
    const mid = (at - opts.nodeSep) / 2;
    for (const v of l) vs[v].c -= mid;
  }
  for (let iter = 0; iter < 24; iter++) {
    const pass = iter % 3; // 0 down, 1 up, 2 both
    const order = pass === 1 ? [...layers.keys()].reverse() : [...layers.keys()];
    for (const r of order) {
      const l = layers[r];
      if (!l.length) continue;
      const want = l.map((v) => {
        const nb = pass === 0 ? vs[v].up : pass === 1 ? vs[v].down : [...vs[v].up, ...vs[v].down];
        return nb.length ? nb.reduce((s, x) => s + vs[x].c, 0) / nb.length : vs[v].c;
      });
      const weights = l.map((v) => (vs[v].dummy ? 0.6 : 1));
      const gaps = l.slice(1).map((v, i) => (vs[l[i]].cross + vs[v].cross) / 2 + opts.nodeSep);
      const c = spacedFit(want, weights, gaps);
      l.forEach((v, i) => (vs[v].c = c[i]));
    }
  }

  // 6. Rank-axis positions and top-left corners.
  const rankSize = layers.map((l) => Math.max(0, ...l.map((v) => vs[v].along)));
  const rankStart: number[] = [];
  let acc = 0;
  for (let r = 0; r < layers.length; r++) {
    rankStart[r] = acc;
    acc += rankSize[r] + opts.rankSep;
  }
  let minC = Infinity;
  let maxC = -Infinity;
  for (let i = 0; i < n; i++) {
    minC = Math.min(minC, vs[i].c - vs[i].cross / 2);
    maxC = Math.max(maxC, vs[i].c + vs[i].cross / 2);
  }
  const pos = new Map<string, { x: number; y: number }>();
  const rank = new Map<string, number>();
  let minRank = Infinity;
  for (let i = 0; i < n; i++) minRank = Math.min(minRank, vs[i].rank);
  for (let i = 0; i < n; i++) {
    const v = vs[i];
    const cross = Math.round(v.c - v.cross / 2 - minC);
    const along = Math.round(rankStart[v.rank] - (rankStart[minRank] ?? 0) + (rankSize[v.rank] - v.along) / 2);
    pos.set(v.id, tb ? { x: cross, y: along } : { x: along, y: cross });
    rank.set(v.id, v.rank);
  }
  const crossSpan = n ? Math.ceil(maxC - minC) : 0;
  const alongSpan = n ? Math.max(0, acc - opts.rankSep - (rankStart[minRank] ?? 0)) : 0;
  return { pos, reversed, rank, w: tb ? crossSpan : alongSpan, h: tb ? alongSpan : crossSpan };
}

/** Edge crossings between neighbouring ranks (inversion count per rank pair). */
function crossings(layers: number[][], vs: V[]): number {
  let total = 0;
  for (let r = 0; r + 1 < layers.length; r++) {
    const pos = new Map(layers[r + 1].map((v, i) => [v, i]));
    const ends: number[] = [];
    for (const v of layers[r]) {
      const targets = vs[v].down.map((w) => pos.get(w)!).sort((a, b) => a - b);
      ends.push(...targets);
    }
    // Count inversions with a Fenwick tree.
    const size = layers[r + 1].length + 1;
    const tree = new Array<number>(size + 1).fill(0);
    for (let i = ends.length - 1; i >= 0; i--) {
      for (let k = ends[i]; k > 0; k -= k & -k) total += tree[k];
      for (let k = ends[i] + 1; k <= size; k += k & -k) tree[k]++;
    }
  }
  return total;
}

/**
 * Positions as close as possible (weighted least squares) to `want`, keeping order and at least
 * `gaps[i]` between item i and i + 1: pool-adjacent-violators on the gap-shifted targets.
 */
export function spacedFit(want: number[], weights: number[], gaps: number[]): number[] {
  const off: number[] = [0];
  for (let i = 0; i < gaps.length; i++) off.push(off[i] + gaps[i]);
  const blocks: Array<{ sum: number; w: number; count: number }> = [];
  want.forEach((t, i) => {
    blocks.push({ sum: (t - off[i]) * weights[i], w: weights[i], count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.w <= b.sum / b.w) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, w: a.w + b.w, count: a.count + b.count });
    }
  });
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.count; k++) out.push(b.sum / b.w + off[out.length]);
  return out;
}
