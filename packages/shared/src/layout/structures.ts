// One layout per kind of structure. Each returns elements relative to its own top-left (0, 0).
import type { Anchor, ShapeKind, StickyColor, TableCopyContent } from '../elements';
import { unionRects, type Rect } from '../geometry';
import { plainToRichText } from '../text';
import {
  CLUSTER_COLORS,
  connector,
  frame,
  MIND_BRANCH_COLORS,
  MIND_ROOT_COLOR,
  mindNodeSize,
  shape,
  shapeSize,
  SOFT_LINE,
  sticky,
  STICKY_GAP,
  STICKY_SIZE,
  textBox,
  translateDraft,
} from './kit';
import { layered } from './layered';
import { measureText } from './measure';
import {
  LAYOUT_LIMITS,
  LayoutError,
  type Direction,
  type ElementDraft,
  type GraphEdgeInput,
  type GraphGroupInput,
  type GraphNodeInput,
  type LaidOut,
  type LayoutContext,
  type OutlineNodeInput,
  type SequenceInput,
} from './types';

const clip = (s: string) => (s.length > LAYOUT_LIMITS.text ? s.slice(0, LAYOUT_LIMITS.text) : s);

/** Shifts everything so the drawing starts at (0, 0) and measures it. */
function finish(elements: ElementDraft[], content: LaidOut['content'] = {}, moves: LaidOut['moves'] = [], extra: Rect[] = []): LaidOut {
  const b = unionRects([...elements, ...moves.map((m) => ({ ...m, w: 0, h: 0 })), ...extra]) ?? { x: 0, y: 0, w: 0, h: 0 };
  return {
    elements: elements.map((el) => translateDraft(el, -b.x, -b.y)),
    content,
    moves: moves.map((m) => ({ id: m.id, x: m.x - b.x, y: m.y - b.y })),
    size: { w: Math.ceil(b.w), h: Math.ceil(b.h) },
  };
}

// ---------------------------------------------------------------------------------------------
// Outlines: indented text → tree; tree → mind map or boxes.

/**
 * Parses an indented list ("- item", "* item", "1. item" or plain lines; nesting by indentation)
 * into one root. Several top-level lines get the first as their root only if it is the only one;
 * otherwise they hang under an empty-titled root, which the caller names.
 */
export function parseIndentedList(text: string): OutlineNodeInput[] {
  const lines = text.split(/\r\n?|\n/).filter((l) => l.trim());
  const roots: OutlineNodeInput[] = [];
  const stack: Array<{ indent: number; node: OutlineNodeInput }> = [];
  for (const raw of lines) {
    const expanded = raw.replace(/\t/g, '  ');
    const indent = expanded.length - expanded.trimStart().length;
    const t = expanded
      .trim()
      .replace(/^(?:[-*+•]|\d+[.)])\s+/, '')
      .replace(/^#{1,6}\s+/, '');
    if (!t) continue;
    const node: OutlineNodeInput = { text: t };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) (parent.node.children ??= []).push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }
  return roots;
}

interface FlatNode {
  id: string;
  text: string;
  parent: FlatNode | null;
  kids: FlatNode[];
  depth: number;
}

function flatten(root: OutlineNodeInput, newId: () => string): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (n: OutlineNodeInput, parent: FlatNode | null, depth: number) => {
    if (depth > LAYOUT_LIMITS.depth) throw new LayoutError(`The outline is nested deeper than ${LAYOUT_LIMITS.depth} levels`);
    if (out.length >= LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} items per structure`);
    if (!n || typeof n.text !== 'string') throw new LayoutError('Every outline item needs a text');
    const f: FlatNode = { id: newId(), text: clip(n.text.trim()), parent, kids: [], depth };
    out.push(f);
    parent?.kids.push(f);
    for (const c of n.children ?? []) walk(c, f, depth + 1);
  };
  walk(root, null, 0);
  return out;
}

const ROOT_GAP = 72;
const LEVEL_GAP = 48;
const SIBLING_GAP = 14;

/**
 * A mind map, laid out like the mind-map feature's tidy tree: every node gets a band as tall as
 * its subtree; sibling bands stack and center on their parent. Four or more first-level branches
 * grow on both sides (alternating), fewer grow to the right.
 */
export function layoutMindmap(rootIn: OutlineNodeInput, ctx: LayoutContext): LaidOut {
  const nodes = flatten(rootIn, ctx.newId);
  const root = nodes[0];
  const size = new Map(nodes.map((n) => [n, mindNodeSize(n.text, n === root)]));
  const pos = new Map<FlatNode, { x: number; y: number }>();
  const extent = new Map<FlatNode, number>();
  const ext = (n: FlatNode): number => {
    const hit = extent.get(n);
    if (hit !== undefined) return hit;
    const block = n.kids.reduce((s, k) => s + ext(k), 0) + SIBLING_GAP * Math.max(0, n.kids.length - 1);
    const e = Math.max(size.get(n)!.h, block);
    extent.set(n, e);
    return e;
  };
  const place = (n: FlatNode, kids: FlatNode[], side: 'right' | 'left', gap: number) => {
    const p = pos.get(n)!;
    const s = size.get(n)!;
    const block = kids.reduce((acc, k) => acc + ext(k), 0) + SIBLING_GAP * Math.max(0, kids.length - 1);
    let top = p.y + s.h / 2 - block / 2;
    for (const k of kids) {
      const ks = size.get(k)!;
      const e = ext(k);
      pos.set(k, { x: Math.round(side === 'right' ? p.x + s.w + gap : p.x - gap - ks.w), y: Math.round(top + (e - ks.h) / 2) });
      place(k, k.kids, side, LEVEL_GAP);
      top += e + SIBLING_GAP;
    }
  };
  pos.set(root, { x: 0, y: 0 });
  const both = root.kids.length >= 4;
  if (both) {
    place(root, root.kids.filter((_, i) => i % 2 === 0), 'right', ROOT_GAP);
    place(root, root.kids.filter((_, i) => i % 2 === 1), 'left', ROOT_GAP);
  } else place(root, root.kids, 'right', ROOT_GAP);
  const colorOf = new Map<FlatNode, string>([[root, MIND_ROOT_COLOR]]);
  root.kids.forEach((k, i) => colorOf.set(k, MIND_BRANCH_COLORS[i % MIND_BRANCH_COLORS.length]));
  const elements: ElementDraft[] = nodes.map((n) => {
    let c = n;
    while (c.parent && c.parent !== root) c = c.parent;
    const p = pos.get(n)!;
    const s = size.get(n)!;
    return {
      id: n.id,
      type: 'mindmap',
      x: p.x,
      y: p.y,
      w: s.w,
      h: s.h,
      rotation: 0,
      text: plainToRichText(n.text),
      parentId: n.parent?.id ?? null,
      rootId: root.id,
      color: colorOf.get(c) ?? MIND_ROOT_COLOR,
      collapsed: false,
      ...(n === root ? { direction: both ? ('both' as const) : ('right' as const) } : {}),
    };
  });
  return finish(elements);
}

/** An outline as a tree of boxes (an org chart), top-down unless told otherwise. */
export function layoutTree(rootIn: OutlineNodeInput, direction: Direction, ctx: LayoutContext): LaidOut {
  let k = 0;
  const nodes = flatten(rootIn, () => `n${k++}`);
  return layoutGraph(
    nodes.map((n) => ({ id: n.id, text: n.text, shape: n.depth === 0 ? 'roundRect' : 'rect' })),
    nodes.flatMap((n) => (n.parent ? [{ from: n.parent.id, to: n.id, arrow: 'none' as const }] : [])),
    direction,
    [],
    ctx,
  );
}

// ---------------------------------------------------------------------------------------------
// Lists and clusters → stickies.

function grid(count: number, cell: { w: number; h: number }, cols = Math.max(1, Math.ceil(Math.sqrt(count)))) {
  return {
    cols,
    at: (i: number) => ({ x: (i % cols) * (cell.w + STICKY_GAP), y: Math.floor(i / cols) * (cell.h + STICKY_GAP) }),
    w: Math.min(count, cols) * (cell.w + STICKY_GAP) - STICKY_GAP,
    h: Math.ceil(count / cols) * (cell.h + STICKY_GAP) - STICKY_GAP,
  };
}

export function layoutStickies(items: string[], title: string | undefined, color: StickyColor, ctx: LayoutContext): LaidOut {
  if (items.length > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} items per structure`);
  return layoutClusters([{ title, color, items }], ctx);
}

/**
 * Affinity clusters: each a titled grid of stickies; clusters sit side by side in rows (shelf
 * packing), so the whole result stays roughly as wide as it is tall.
 */
export function layoutClusters(
  clusters: Array<{ title?: string; color?: StickyColor; items: Array<string | { id: string }> }>,
  ctx: LayoutContext,
): LaidOut {
  const total = clusters.reduce((s, c) => s + c.items.length + (c.title ? 1 : 0), 0);
  if (total > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} items per structure`);
  const seen = new Set<string>();
  const blocks = clusters.map((c, ci) => {
    const color = c.color ?? CLUSTER_COLORS[ci % CLUSTER_COLORS.length];
    const sizes = c.items.map((it) => {
      if (typeof it === 'string') return { w: STICKY_SIZE, h: STICKY_SIZE };
      const ex = ctx.existing?.(it.id);
      if (!ex) throw new LayoutError(`No item ${it.id} on this board`);
      if (seen.has(it.id)) throw new LayoutError(`Item ${it.id} is in two clusters`);
      seen.add(it.id);
      return { w: ex.w, h: ex.h };
    });
    const cell = { w: Math.max(0, ...sizes.map((s) => s.w)), h: Math.max(0, ...sizes.map((s) => s.h)) };
    const g = grid(c.items.length, cell);
    const width = Math.max(g.w, c.title ? 240 : 0);
    const titleH = c.title ? measureText(clip(c.title), { fontSize: 24, maxWidth: width, bold: true }).h + 8 + 16 : 0;
    return { c, color, g, cell, sizes, w: width, h: titleH + Math.max(0, g.h), titleH };
  });
  const area = blocks.reduce((s, b) => s + b.w * b.h, 0);
  const rowLimit = Math.max(...blocks.map((b) => b.w), Math.sqrt(area) * 1.6);
  const GAP = 120;
  const elements: ElementDraft[] = [];
  const moves: LaidOut['moves'] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const b of blocks) {
    if (x > 0 && x + b.w > rowLimit) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    if (b.c.title) elements.push(textBox(ctx.newId(), x, y, b.w, clip(b.c.title), { size: 24, bold: true }));
    b.c.items.forEach((it, i) => {
      const p = b.g.at(i);
      const s = b.sizes[i];
      // Centered in its cell, so mixed sizes still line up.
      const at = { x: x + p.x + (b.cell.w - s.w) / 2, y: y + b.titleH + p.y + (b.cell.h - s.h) / 2 };
      if (typeof it === 'string') elements.push(sticky(ctx.newId(), at.x, at.y, clip(it), b.color));
      else moves.push({ id: it.id, x: Math.round(at.x), y: Math.round(at.y) });
    });
    x += b.w + GAP;
    rowH = Math.max(rowH, b.h);
  }
  const movedRects = moves.map((m) => {
    const ex = ctx.existing!(m.id)!;
    return { x: m.x, y: m.y, w: ex.w, h: ex.h };
  });
  return finish(elements, {}, moves, movedRects);
}

// ---------------------------------------------------------------------------------------------
// Graphs (and trees, Mermaid flowcharts): layered layout, groups as frames.

type Side = Exclude<Anchor, 'auto'>;

/**
 * Sides a connector leaves and enters by. Along the flow: out the far side, in the near one.
 * Against it (a loop back): out and in on the same flank, so it runs beside the forward line
 * instead of on top of it.
 */
function anchorsBetween(a: Rect, b: Rect, vertical: boolean): [Side, Side] {
  if (vertical) {
    if (b.y >= a.y + a.h) return ['bottom', 'top'];
    if (b.y + b.h <= a.y) return ['left', 'left'];
    return b.x >= a.x + a.w / 2 ? ['right', 'left'] : ['left', 'right'];
  }
  if (b.x >= a.x + a.w) return ['right', 'left'];
  if (b.x + b.w <= a.x) return ['top', 'top'];
  return b.y >= a.y + a.h / 2 ? ['bottom', 'top'] : ['top', 'bottom'];
}

export function layoutGraph(
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  direction: Direction,
  groups: GraphGroupInput[],
  ctx: LayoutContext,
): LaidOut {
  if (!nodes.length) throw new LayoutError('The diagram has no nodes');
  if (nodes.length + edges.length + groups.length > LAYOUT_LIMITS.elements)
    throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} nodes, edges and groups per structure`);
  const byId = new Map<string, GraphNodeInput>();
  for (const n of nodes) {
    if (typeof n.id !== 'string' || !n.id) throw new LayoutError('Every node needs an id');
    if (byId.has(n.id)) throw new LayoutError(`Node ${n.id} is listed twice`);
    byId.set(n.id, n);
  }
  const groupOf = new Map<string, string>();
  const gById = new Map<string, GraphGroupInput>();
  for (const g of groups) {
    if (gById.has(g.id) || byId.has(g.id)) throw new LayoutError(`Group ${g.id} reuses an id`);
    gById.set(g.id, g);
  }
  // An edge joins nodes or groups (Mermaid links to a subgraph: the connector attaches to its frame).
  for (const e of edges)
    if ((!byId.has(e.from) && !gById.has(e.from)) || (!byId.has(e.to) && !gById.has(e.to)))
      throw new LayoutError(`Edge ${e.from} → ${e.to} names a node that isn't listed`);
  for (const g of groups) {
    if (g.parent && !gById.has(g.parent)) throw new LayoutError(`Group ${g.id} sits in unknown group ${g.parent}`);
    for (const id of g.nodes) {
      if (!byId.has(id)) throw new LayoutError(`Group ${g.id} holds unknown node ${id}`);
      groupOf.set(id, g.id); // innermost declaration wins (Mermaid: the last subgraph naming it)
    }
  }
  for (const g of groups) {
    const seen = new Set<string>();
    for (let p: string | null | undefined = g.id; p; p = gById.get(p)?.parent) {
      if (seen.has(p)) throw new LayoutError(`Groups ${[...seen].join(', ')} contain each other`);
      seen.add(p);
    }
  }

  const tb = direction === 'TB' || direction === 'BT';
  const elementId = new Map<string, string>();
  for (const n of nodes) elementId.set(n.id, ctx.newId());
  const size = new Map(nodes.map((n) => [n.id, shapeSize(clip(n.text ?? ''), n.shape ?? 'rect')]));

  // Lay out each group's contents as a block, innermost first; a block is one node outside it.
  const PAD = 40;
  // The web draws a frame's title above the frame (visualOutset): only room for it between frames.
  const TITLE = 0;
  /** The groups around a node or group, innermost first. */
  const chain = (id: string): string[] => {
    const out: string[] = [];
    const first = gById.has(id) ? gById.get(id)!.parent : groupOf.get(id);
    for (let g: string | null | undefined = first; g; g = gById.get(g)?.parent) out.push(g);
    return out;
  };
  /** The unit that holds node / group `id` directly inside block `scope` (null = top level). */
  const unitIn = (id: string, scope: string | null): string | null => {
    const self = gById.has(id) ? `g:${id}` : `n:${id}`;
    const c = chain(id);
    if (scope === null) return c.length ? `g:${c[c.length - 1]}` : self;
    const i = c.indexOf(scope);
    if (i < 0) return null;
    return i === 0 ? self : `g:${c[i - 1]}`;
  };
  interface Block {
    w: number;
    h: number;
    /** Top-left of every node and group inside, relative to the block. */
    nodes: Map<string, { x: number; y: number }>;
    groups: Map<string, Rect>;
  }
  const block = (scope: string | null): Block => {
    const kidsGroups = groups.filter((g) => (g.parent ?? null) === scope);
    const sub = new Map(kidsGroups.map((g) => [g.id, block(g.id)]));
    const units: Array<{ id: string; w: number; h: number }> = [];
    for (const n of nodes) if ((groupOf.get(n.id) ?? null) === scope) units.push({ id: `n:${n.id}`, ...size.get(n.id)! });
    for (const g of kidsGroups) units.push({ id: `g:${g.id}`, w: sub.get(g.id)!.w, h: sub.get(g.id)!.h });
    const unitEdges: Array<{ from: string; to: string }> = [];
    for (const e of edges) {
      const a = unitIn(e.from, scope);
      const b = unitIn(e.to, scope);
      if (a && b && a !== b) unitEdges.push({ from: a, to: b });
    }
    const r = layered(units, unitEdges, { direction: tb ? 'TB' : 'LR', nodeSep: 56, rankSep: 72 });
    const inset = scope === null ? { x: 0, y: 0 } : { x: PAD, y: PAD + TITLE };
    const out: Block = { w: r.w + (scope === null ? 0 : 2 * PAD), h: r.h + (scope === null ? 0 : 2 * PAD + TITLE), nodes: new Map(), groups: new Map() };
    if (scope !== null) out.w = Math.max(out.w, 200);
    for (const u of units) {
      const p = r.pos.get(u.id)!;
      const at = { x: p.x + inset.x, y: p.y + inset.y };
      if (u.id.startsWith('n:')) out.nodes.set(u.id.slice(2), at);
      else {
        const gid = u.id.slice(2);
        const inner = sub.get(gid)!;
        out.groups.set(gid, { x: at.x, y: at.y, w: inner.w, h: inner.h });
        for (const [k, v] of inner.nodes) out.nodes.set(k, { x: v.x + at.x, y: v.y + at.y });
        for (const [k, v] of inner.groups) out.groups.set(k, { x: v.x + at.x, y: v.y + at.y, w: v.w, h: v.h });
      }
    }
    return out;
  };
  const top = block(null);
  // BT / RL: the same drawing mirrored along the flow.
  const flipY = direction === 'BT';
  const flipX = direction === 'RL';
  const mirror = (r: Rect): Rect => ({
    x: flipX ? top.w - r.x - r.w : r.x,
    y: flipY ? top.h - r.y - r.h : r.y,
    w: r.w,
    h: r.h,
  });

  const frameIds = new Map<string, string>();
  for (const g of groups) frameIds.set(g.id, ctx.newId());
  const elements: ElementDraft[] = [];
  // Frames first (outer before inner), so they sit beneath their contents.
  const depthOf = (g: string) => {
    let d = 0;
    for (let p = gById.get(g)?.parent; p; p = gById.get(p)?.parent) d++;
    return d;
  };
  for (const g of [...groups].sort((a, b) => depthOf(a.id) - depthOf(b.id))) {
    const r = top.groups.get(g.id);
    if (!r) continue;
    elements.push(frame(frameIds.get(g.id)!, mirror(r), clip(g.title || g.id), g.parent ? frameIds.get(g.parent) : null));
  }
  const rects = new Map<string, Rect>();
  for (const g of groups) {
    const r = top.groups.get(g.id);
    if (r) rects.set(g.id, mirror(r));
    elementId.set(g.id, frameIds.get(g.id)!);
  }
  for (const n of nodes) {
    const p = top.nodes.get(n.id)!;
    const r = mirror({ ...p, ...size.get(n.id)! });
    rects.set(n.id, r);
    const g = groupOf.get(n.id);
    elements.push(shape(elementId.get(n.id)!, n.shape ?? 'rect', r, clip(n.text ?? ''), {}, g ? frameIds.get(g) : null));
  }
  for (const e of edges) {
    const a = rects.get(e.from)!;
    const b = rects.get(e.to)!;
    const [sa, sb] = e.from === e.to ? (['right', 'top'] as [Side, Side]) : anchorsBetween(a, b, tb);
    elements.push(
      connector(
        ctx.newId(),
        { id: elementId.get(e.from)!, anchor: sa, rect: a },
        { id: elementId.get(e.to)!, anchor: sb, rect: b },
        {
          label: e.label ? clip(e.label) : undefined,
          strokeStyle: e.style === 'dashed' ? 'dashed' : 'solid',
          strokeWidth: e.style === 'thick' ? 4 : 2,
          endCap: e.arrow === 'none' ? 'none' : 'arrow',
          startCap: e.arrow === 'both' ? 'arrow' : 'none',
        },
      ),
    );
  }
  return finish(elements);
}

// ---------------------------------------------------------------------------------------------
// Sequence diagrams: participants in a row, lifelines down, one row per message.

export function layoutSequence(d: SequenceInput, ctx: LayoutContext): LaidOut {
  const parts = d.participants;
  if (!parts.length) throw new LayoutError('The sequence diagram has no participants');
  if (parts.length * 2 + d.steps.length * 2 > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} elements per structure`);
  const index = new Map(parts.map((p, i) => [p.id, i]));
  for (const s of d.steps) {
    const ids = s.kind === 'message' ? [s.from, s.to] : s.over;
    for (const id of ids) if (!index.has(id)) throw new LayoutError(`Unknown participant ${id}`);
  }
  const BOX_H = 56;
  const boxW = parts.map((p) => Math.max(140, measureText(clip(p.label), { fontSize: 16, maxWidth: 260 }).w + 40));
  // Column spacing: room for the widest box and for every message label between neighbours.
  let span = Math.max(...boxW) + 60;
  for (const s of d.steps) {
    if (s.kind !== 'message' || s.from === s.to) continue;
    const cols = Math.abs(index.get(s.from)! - index.get(s.to)!);
    const need = measureText(clip(s.text), { fontSize: 14, maxWidth: 360 }).w + 56;
    span = Math.max(span, need / cols);
  }
  span = Math.min(Math.round(span), 520);
  const titleH = d.title ? 56 : 0;
  const cx = (i: number) => Math.round(Math.max(...boxW) / 2 + i * span);
  const elements: ElementDraft[] = [];
  if (d.title) elements.push(textBox(ctx.newId(), 0, 0, Math.max(300, cx(parts.length - 1) + 200), clip(d.title), { size: 24, bold: true }));
  const boxes = parts.map((p, i) => {
    const r = { x: cx(i) - boxW[i] / 2, y: titleH, w: boxW[i], h: BOX_H };
    const id = ctx.newId();
    elements.push(shape(id, p.actor ? 'roundRect' : 'rect', r, clip(p.label), { fill: '#ECE9FB' }));
    return { id, r };
  });
  let y = titleH + BOX_H + 48;
  for (const s of d.steps) {
    if (s.kind === 'message') {
      const a = index.get(s.from)!;
      const b = index.get(s.to)!;
      const style = {
        label: s.text ? clip(s.text) : undefined,
        routing: 'elbow' as const,
        strokeStyle: s.dashed ? ('dashed' as const) : ('solid' as const),
        endCap: s.arrow === 'none' ? ('none' as const) : s.arrow === 'open' ? ('arrow' as const) : s.arrow === 'cross' ? ('bar' as const) : ('triangle' as const),
      };
      if (a === b) {
        // A loop out to the right and back (curved through one waypoint).
        elements.push(connector(ctx.newId(), { point: { x: cx(a), y } }, { point: { x: cx(a), y: y + 32 } }, { ...style, routing: 'curved', waypoints: [{ x: cx(a) + 64, y: y + 16 }] }));
        y += 80;
      } else {
        elements.push(connector(ctx.newId(), { point: { x: cx(a), y } }, { point: { x: cx(b), y } }, style));
        y += 64;
      }
    } else {
      const cols = s.over.map((id) => index.get(id)!);
      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      const w = s.side === 'over' || !s.side ? Math.max(180, cx(hi) - cx(lo) + 120) : 180;
      const left = s.side === 'left' ? cx(lo) - w - 16 : s.side === 'right' ? cx(hi) + 16 : (cx(lo) + cx(hi)) / 2 - w / 2;
      const m = measureText(clip(s.text), { fontSize: 15, maxWidth: w - 24 });
      const h = Math.max(64, m.h + 32);
      elements.push({ ...sticky(ctx.newId(), left, y - 8, clip(s.text), 'yellow'), w: Math.round(w), h: Math.round(h) } as ElementDraft);
      y += h + 24;
    }
  }
  const bottom = y + 16;
  // Lifelines go right after the boxes, so messages and notes draw over them.
  const lifelines = boxes.map((b, i) =>
    connector(ctx.newId(), { id: b.id, anchor: 'bottom', rect: b.r }, { point: { x: cx(i), y: bottom } }, {
      routing: 'straight',
      stroke: SOFT_LINE,
      strokeStyle: 'dashed',
      endCap: 'none',
    }),
  );
  const firstStep = (d.title ? 1 : 0) + boxes.length;
  elements.splice(firstStep, 0, ...lifelines);
  return finish(elements);
}

// ---------------------------------------------------------------------------------------------
// Tables.

const CELL_FONT = 14;
const CELL_PAD = 8;

export function layoutTable(rowsIn: string[][], header: boolean, ctx: LayoutContext): LaidOut {
  const nCols = Math.max(0, ...rowsIn.map((r) => r.length));
  if (!rowsIn.length || !nCols) throw new LayoutError('The table has no cells');
  if (rowsIn.length * nCols > LAYOUT_LIMITS.cells) throw new LayoutError(`At most ${LAYOUT_LIMITS.cells} cells per table`);
  const rows = rowsIn.map((r) => Array.from({ length: nCols }, (_, i) => clip(String(r[i] ?? '').trim())));
  const colW = Array.from({ length: nCols }, (_, c) => {
    const widest = Math.max(...rows.map((r, ri) => measureText(r[c] || ' ', { fontSize: CELL_FONT, maxWidth: 296, bold: header && ri === 0 }).w));
    return Math.round(Math.min(320, Math.max(96, widest + 2 * CELL_PAD + 6)));
  });
  const rowH = rows.map((r, ri) =>
    Math.round(
      Math.max(
        44,
        ...r.map((t, c) => measureText(t || ' ', { fontSize: CELL_FONT, maxWidth: colW[c] - 2 * CELL_PAD - 4, bold: header && ri === 0 }).h + 2 * CELL_PAD + 4),
      ),
    ),
  );
  const id = ctx.newId();
  const cols = colW.map((w) => ({ id: ctx.newId(), w }));
  const tracks = rowH.map((h) => ({ id: ctx.newId(), h }));
  const cells: TableCopyContent = {};
  rows.forEach((r, ri) =>
    r.forEach((t, ci) => {
      if (t) cells[`${tracks[ri].id}:${cols[ci].id}`] = { t: plainToRichText(t) };
    }),
  );
  const el: ElementDraft = {
    id,
    type: 'table',
    x: 0,
    y: 0,
    w: colW.reduce((a, b) => a + b, 0),
    h: rowH.reduce((a, b) => a + b, 0),
    rotation: 0,
    rows: tracks,
    cols,
    header,
    fontSize: CELL_FONT,
  };
  return finish([el], { [id]: cells });
}

// ---------------------------------------------------------------------------------------------
// A written note (summaries): a soft rounded card with its text set from the top left, so the text
// keeps the shape's padding (a bare text box with a background has none).

export const NOTE_WIDTH = 560;
export const NOTE_BACKGROUND = '#FFF6D9';
/** Room the shape keeps around its text (its padding plus the rounded corners' inset), generous. */
const NOTE_PAD = 32;

export function layoutNote(title: string | undefined, text: string, ctx: LayoutContext): LaidOut {
  const body = (text.length > LAYOUT_LIMITS.note ? text.slice(0, LAYOUT_LIMITS.note) : text)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const head = title?.trim() ? clip(title.trim()).replace(/\s+/g, ' ') : '';
  const size = 16;
  const inner = NOTE_WIDTH - NOTE_PAD * 2;
  const titleH = head ? measureText(head, { fontSize: size, maxWidth: inner, bold: true, lineHeight: 1.4 }).h + size * 1.4 : 0;
  const bodyH = measureText(body, { fontSize: size, maxWidth: inner, lineHeight: 1.4 }).h;
  const html = (head ? `<b>${plainToRichText(head)}</b><br><br>` : '') + plainToRichText(body);
  const h = Math.ceil(titleH + bodyH + NOTE_PAD * 2);
  const card = shape(ctx.newId(), 'roundRect', { x: 0, y: 0, w: NOTE_WIDTH, h }, '', { fill: NOTE_BACKGROUND, stroke: 'transparent', fontSize: size });
  const el = { ...card, text: html, align: 'left', vAlign: 'top' } as ElementDraft;
  return finish([el]);
}

export type { ShapeKind };
