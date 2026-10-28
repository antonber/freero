// A tidy tree (org charts, "Auto-layout ▸ Tree"): every parent centered over the block of its
// children, levels aligned, subtrees side by side and never overlapping. Pure and deterministic.
// Graphs that aren't trees still get one: each node hangs under the first edge that reaches it
// (input order), the other edges are ignored for placement, cycles are broken.
import type { Point } from '../geometry';

export interface TidyUnit {
  id: string;
  w: number;
  h: number;
}

export interface TidyOptions {
  /** 'TB': top-down (org chart); 'LR': left to right. */
  direction?: 'TB' | 'LR';
  /** Between neighbouring subtrees (default 32). */
  siblingGap?: number;
  /** Between levels (default 64). */
  levelGap?: number;
}

/** Top-left of every unit, the drawing starting at (0, 0), and its size. */
export function tidyTree(units: TidyUnit[], edges: Array<{ from: string; to: string }>, opts: TidyOptions = {}): { pos: Map<string, Point>; w: number; h: number } {
  const lr = opts.direction === 'LR';
  const sibGap = opts.siblingGap ?? 32;
  const lvlGap = opts.levelGap ?? 64;
  const byId = new Map(units.map((u) => [u.id, u]));
  // Along the flow ("depth") and across it ("breadth").
  const across = (u: TidyUnit) => (lr ? u.h : u.w);
  const along = (u: TidyUnit) => (lr ? u.w : u.h);

  const parent = new Map<string, string>();
  const kids = new Map<string, string[]>();
  const ancestorOf = (a: string, b: string) => {
    for (let p: string | undefined = b; p; p = parent.get(p)) if (p === a) return true;
    return false;
  };
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to || parent.has(e.to)) continue;
    if (ancestorOf(e.to, e.from)) continue; // would close a cycle
    parent.set(e.to, e.from);
    (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)!).push(e.to);
  }
  const roots = units.filter((u) => !parent.has(u.id)).map((u) => u.id);

  // Depth of each node and the deepest extent of each level, so levels line up.
  const depth = new Map<string, number>();
  const levelSize: number[] = [];
  const walk = (id: string, d: number) => {
    depth.set(id, d);
    levelSize[d] = Math.max(levelSize[d] ?? 0, along(byId.get(id)!));
    for (const k of kids.get(id) ?? []) walk(k, d + 1);
  };
  roots.forEach((r) => walk(r, 0));
  const levelStart: number[] = [];
  levelSize.reduce((at, size, d) => ((levelStart[d] = at), at + size + lvlGap), 0);

  const breadth = new Map<string, number>();
  const span = (id: string): number => {
    const ks = kids.get(id) ?? [];
    const block = ks.reduce((s, k) => s + span(k), 0) + sibGap * Math.max(0, ks.length - 1);
    const b = Math.max(across(byId.get(id)!), block);
    breadth.set(id, b);
    return b;
  };
  const pos = new Map<string, Point>();
  const place = (id: string, start: number) => {
    const u = byId.get(id)!;
    const b = breadth.get(id)!;
    const a = start + (b - across(u)) / 2;
    const d = levelStart[depth.get(id)!] + (levelSize[depth.get(id)!] - along(u)) / 2;
    pos.set(id, lr ? { x: Math.round(d), y: Math.round(a) } : { x: Math.round(a), y: Math.round(d) });
    const ks = kids.get(id) ?? [];
    const block = ks.reduce((s, k) => s + breadth.get(k)!, 0) + sibGap * Math.max(0, ks.length - 1);
    let at = start + (b - block) / 2;
    for (const k of ks) {
      place(k, at);
      at += breadth.get(k)! + sibGap;
    }
  };
  let at = 0;
  for (const r of roots) {
    span(r);
    place(r, at);
    at += breadth.get(r)! + sibGap * 2;
  }
  let w = 0;
  let h = 0;
  for (const [id, p] of pos) {
    const u = byId.get(id)!;
    w = Math.max(w, p.x + u.w);
    h = Math.max(h, p.y + u.h);
  }
  return { pos, w, h };
}
