// Size limits for huge boards: a scope (one frame or container), pages (a cursor over the items
// in outline order) and a token budget (keeps the shallowest, most recently changed items and
// says what it left out). Works on a full outline from buildOutline; pure.
import { edgeLine, estimateTokens, itemLines } from './markdown';
import type { BoardOutline, OutlineEdge, OutlineItem, OutlineThread } from './types';

export interface OutlineSelection {
  /** Only this item (a frame, cluster, kanban, mind-map root …) and what is under it. */
  scope?: string;
  /** Items + edges per page. */
  limit?: number;
  /** From a previous page's `meta.nextCursor`. */
  cursor?: string;
  /** Approximate tokens the rendered result may take (frame titles are always kept). */
  budget?: number;
  /** Render form the budget is measured in. */
  format?: 'markdown' | 'json';
  /** Last-change time per element id: under a budget, newer items win among equals. */
  updatedAt?: (id: string) => number | undefined;
}

export class OutlineSelectionError extends Error {}

interface Unit {
  item?: OutlineItem;
  edge?: OutlineEdge;
  depth: number;
  parent: number; // index of the parent unit, -1 at the top
}

const encodeCursor = (offset: number, version: string) => `${offset}.${version}`;
function decodeCursor(cursor: string): { offset: number; version: string } {
  const m = /^(\d{1,9})\.([A-Za-z0-9_-]{1,64})$/.exec(cursor);
  if (!m) throw new OutlineSelectionError('Invalid cursor');
  return { offset: Number(m[1]), version: m[2] };
}

function findItem(items: OutlineItem[], id: string): OutlineItem | null {
  for (const i of items) {
    if (i.id === id) return i;
    const hit = i.children ? findItem(i.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

function idsUnder(item: OutlineItem, out = new Set<string>()): Set<string> {
  out.add(item.id);
  for (const c of item.children ?? []) idsUnder(c, out);
  return out;
}

const threadCost = (t: OutlineThread[]) => t.reduce((s, th) => s + estimateTokens(JSON.stringify(th)), 0);

export function selectOutline(full: BoardOutline, sel: OutlineSelection): BoardOutline {
  let items = full.items;
  let edges = full.edges;
  let comments = full.comments;
  if (sel.scope) {
    const node = findItem(full.items, sel.scope);
    if (!node) throw new OutlineSelectionError(`No item ${sel.scope} on this board`);
    const inside = idsUnder(node);
    items = [node];
    edges = edges.filter((e) => (e.from === null || inside.has(e.from)) && (e.to === null || inside.has(e.to)) && (e.from || e.to));
    comments = [];
  }

  // Outline order: items depth-first, then edges.
  const units: Unit[] = [];
  const walk = (list: OutlineItem[], depth: number, parent: number) => {
    for (const item of list) {
      const i = units.length;
      units.push({ item, depth, parent });
      if (item.children) walk(item.children, depth + 1, i);
    }
  };
  walk(items, 0, -1);
  for (const edge of edges) units.push({ edge, depth: 0, parent: -1 });

  // Page.
  let from = 0;
  let to = units.length;
  let versionChanged = false;
  if (sel.cursor) {
    const c = decodeCursor(sel.cursor);
    from = Math.min(c.offset, units.length);
    versionChanged = c.version !== full.version;
  }
  const paged = sel.limit !== undefined || sel.cursor !== undefined;
  if (sel.limit !== undefined) to = Math.min(units.length, from + Math.max(1, sel.limit));

  // Budget, inside the page.
  const chosen = new Set<number>();
  for (let i = from; i < to; i++) chosen.add(i);
  let budgetCut = false;
  if (sel.budget !== undefined) {
    budgetCut = true;
    chosen.clear();
    const json = sel.format === 'json';
    const cost = (u: Unit) =>
      u.edge
        ? estimateTokens(json ? JSON.stringify(u.edge) : edgeLine(u.edge))
        : json
          ? estimateTokens(JSON.stringify({ ...u.item!, children: undefined }))
          : estimateTokens(itemLines(u.item!, u.depth).join('\n')) + 1;
    let left = sel.budget - 120 - estimateTokens(full.board.title) - full.notes.reduce((s, n) => s + estimateTokens(n) + 2, 0);
    const take = (i: number) => {
      // A node's ancestors come with it: the tree stays whole.
      for (let a = i; a >= 0 && !chosen.has(a); a = units[a].parent) {
        chosen.add(a);
        left -= cost(units[a]);
      }
    };
    // Frame titles always stay.
    for (let i = from; i < to; i++) if (units[i].item?.kind === 'frame') take(i);
    const updated = (u: Unit) => (u.item ? (sel.updatedAt?.(u.item.id) ?? 0) : 0);
    const order = [];
    for (let i = from; i < to; i++) if (units[i].item) order.push(i);
    order.sort((a, b) => units[a].depth - units[b].depth || updated(units[b]) - updated(units[a]) || a - b);
    for (const i of order) {
      if (chosen.has(i)) continue;
      let need = 0;
      for (let a = i; a >= 0 && !chosen.has(a); a = units[a].parent) need += cost(units[a]);
      if (need <= left) take(i);
    }
    const chosenIds = new Set([...chosen].map((c) => units[c].item?.id));
    for (let i = from; i < to; i++) {
      const e = units[i].edge;
      if (!e) continue;
      const endsIn = (id: string | null) => id === null || chosenIds.has(id);
      const c = cost(units[i]);
      if (c <= left && endsIn(e.from) && endsIn(e.to)) {
        chosen.add(i);
        left -= c;
      }
    }
    if (comments.length && threadCost(comments) > left) comments = [];
  }

  // Rebuild the tree: chosen units, plus (on a page) the ancestors that place them as context.
  const keep = new Set(chosen);
  if (paged) for (const i of chosen) for (let a = units[i].parent; a >= 0; a = units[a].parent) keep.add(a);
  const omittedUnder = new Map<number, number>();
  let topOmitted = 0;
  if (budgetCut)
    units.forEach((u, i) => {
      if (keep.has(i)) return;
      let a = u.parent;
      while (a >= 0 && !keep.has(a)) a = units[a].parent;
      if (a >= 0) omittedUnder.set(a, (omittedUnder.get(a) ?? 0) + 1);
      else if (!u.item || u.parent < 0) topOmitted++;
    });
  const rebuild = (list: OutlineItem[]): OutlineItem[] => {
    const out: OutlineItem[] = [];
    for (const item of list) {
      const i = unitIndex.get(item)!;
      if (!keep.has(i)) continue;
      const copy: OutlineItem = { ...item };
      delete copy.children;
      delete copy.omitted;
      if (item.children) {
        const kids = rebuild(item.children);
        if (kids.length) copy.children = kids;
      }
      const om = omittedUnder.get(i);
      if (om) copy.omitted = om;
      if (paged && !chosen.has(i)) copy.context = true;
      out.push(copy);
    }
    return out;
  };
  const unitIndex = new Map<OutlineItem, number>();
  units.forEach((u, i) => u.item && unitIndex.set(u.item, i));
  const outItems = rebuild(items);
  const outEdges = units.flatMap((u, i) => (u.edge && keep.has(i) ? [u.edge] : []));

  const total = units.length;
  const truncated = chosen.size < total;
  const meta: BoardOutline['meta'] = {
    itemCount: full.meta.itemCount,
    edgeCount: full.meta.edgeCount,
    returned: chosen.size,
    truncated,
    omitted: budgetCut ? topOmitted : 0,
  };
  if (paged && to < total) meta.nextCursor = encodeCursor(to, full.version);
  if (versionChanged) meta.versionChanged = true;
  return {
    ...full,
    items: outItems,
    edges: outEdges,
    // Board-level threads and notes come with the first page.
    comments: paged && from > 0 ? [] : comments,
    notes: paged && from > 0 ? [] : full.notes,
    meta,
  };
}
