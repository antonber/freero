// One layout per kind of structure. Each returns elements relative to its own top-left (0, 0).
import type { Anchor, CardStatus, ShapeKind, StickyColor, TableCopyContent } from '../elements';
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
import { indexMindNodes, layoutMindTree, type MindNode } from './mindtree';
import { tidyTree } from './tidy';
import { measureText } from './measure';
import {
  LAYOUT_LIMITS,
  LayoutError,
  type Direction,
  type ElementDraft,
  type GraphEdgeInput,
  type GraphGroupInput,
  type GraphNodeInput,
  type KanbanColumnInput,
  type OrgPersonInput,
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
  /** What the source calls it (`OutlineNodeInput.id`), if anything. */
  name?: string;
}

function flatten(root: OutlineNodeInput, newId: () => string): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (n: OutlineNodeInput, parent: FlatNode | null, depth: number) => {
    if (depth > LAYOUT_LIMITS.depth) throw new LayoutError(`The outline is nested deeper than ${LAYOUT_LIMITS.depth} levels`);
    if (out.length >= LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} items per structure`);
    if (!n || typeof n.text !== 'string') throw new LayoutError('Every outline item needs a text');
    const f: FlatNode = { id: newId(), text: clip(n.text.trim()), parent, kids: [], depth, ...(typeof n.id === 'string' && n.id ? { name: n.id } : {}) };
    out.push(f);
    parent?.kids.push(f);
    for (const c of n.children ?? []) walk(c, f, depth + 1);
  };
  walk(root, null, 0);
  return out;
}

/**
 * A stable key per outline item for re-layouts of edited source: its source name when it has
 * one, else its path of texts (a repeated text among siblings gets its ordinal).
 */
function outlineKeys(nodes: FlatNode[]): Map<FlatNode, string> {
  const keys = new Map<FlatNode, string>();
  const used = new Set<string>();
  for (const n of nodes) {
    const base = n.name ? `n:${n.name}` : `t:${n.parent ? keys.get(n.parent) : ''}/${n.text.toLowerCase()}`;
    let key = base;
    for (let i = 2; used.has(key); i++) key = `${base}#${i}`;
    used.add(key);
    keys.set(n, key);
  }
  return keys;
}

/**
 * A mind map, laid out by the mind-map feature's own tidy tree (`layoutMindTree`, shared): every
 * node gets a band as tall as its subtree; sibling bands stack and center on their parent. Four
 * or more first-level branches grow on both sides (alternating), fewer grow to the right.
 */
export function layoutMindmap(rootIn: OutlineNodeInput, ctx: LayoutContext): LaidOut {
  const nodes = flatten(rootIn, ctx.newId);
  const root = nodes[0];
  const size = new Map(nodes.map((n) => [n, mindNodeSize(n.text, n === root)]));
  const both = root.kids.length >= 4;
  // Sibling order is encoded the way the mind-map feature reads it: by position, then creation.
  const tree: MindNode[] = nodes.map((n, i) => ({
    id: n.id,
    parentId: n.parent?.id ?? null,
    x: 0,
    y: i,
    ...size.get(n)!,
    createdAt: i,
    ...(n === root ? { direction: both ? ('both' as const) : ('right' as const) } : {}),
  }));
  const placed = layoutMindTree(indexMindNodes(tree), root.id, { rebalance: both });
  const pos = new Map(nodes.map((n) => [n, placed.get(n.id) ?? { x: 0, y: 0 }]));
  const keyOf = outlineKeys(nodes);
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
  return withKeys(finish(elements), new Map(nodes.map((n) => [n.id, keyOf.get(n)!])));
}

/** An outline as a tree of boxes (an org chart), top-down unless told otherwise. */
export function layoutTree(rootIn: OutlineNodeInput, direction: Direction, ctx: LayoutContext): LaidOut {
  const nodes = flatten(rootIn, () => '');
  // Node ids are the items' stable keys, so the graph's keys (n:<id>, e:…) survive edits.
  const keys = outlineKeys(nodes);
  for (const n of nodes) n.id = keys.get(n)!;
  return layoutGraph(
    nodes.map((n) => ({ id: n.id, text: n.text, shape: n.depth === 0 ? 'roundRect' : 'rect' })),
    nodes.flatMap((n) => (n.parent ? [{ from: n.parent.id, to: n.id, arrow: 'none' as const }] : [])),
    direction,
    [],
    ctx,
  );
}

const withKeys = (laid: LaidOut, keys: Map<string, string>): LaidOut => ({ ...laid, keys: Object.fromEntries(keys) });

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
  const keys = new Map<string, string>();
  for (const n of nodes) keys.set(elementId.get(n.id)!, `n:${n.id}`);
  for (const g of groups) keys.set(frameIds.get(g.id)!, `g:${g.id}`);
  const pairCount = new Map<string, number>();
  for (const e of edges) {
    const a = rects.get(e.from)!;
    const b = rects.get(e.to)!;
    const [sa, sb] = e.from === e.to ? (['right', 'top'] as [Side, Side]) : anchorsBetween(a, b, tb);
    const pair = `${e.from}>${e.to}`;
    const k = (pairCount.get(pair) ?? 0) + 1;
    pairCount.set(pair, k);
    const id = ctx.newId();
    keys.set(id, `e:${pair}#${k}`);
    elements.push(
      connector(
        id,
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
  return withKeys(finish(elements), keys);
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
  const keys = new Map<string, string>();
  const keyed = (key: string) => {
    const id = ctx.newId();
    keys.set(id, key);
    return id;
  };
  if (d.title) elements.push(textBox(keyed('title'), 0, 0, Math.max(300, cx(parts.length - 1) + 200), clip(d.title), { size: 24, bold: true }));
  const boxes = parts.map((p, i) => {
    const r = { x: cx(i) - boxW[i] / 2, y: titleH, w: boxW[i], h: BOX_H };
    const id = keyed(`p:${p.id}`);
    elements.push(shape(id, p.actor ? 'roundRect' : 'rect', r, clip(p.label), { fill: '#ECE9FB' }));
    return { id, r };
  });
  let y = titleH + BOX_H + 48;
  let messages = 0;
  let notes = 0;
  for (const s of d.steps) {
    if (s.kind === 'message') {
      const mid = keyed(`m:${++messages}`);
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
        elements.push(connector(mid, { point: { x: cx(a), y } }, { point: { x: cx(a), y: y + 32 } }, { ...style, routing: 'curved', waypoints: [{ x: cx(a) + 64, y: y + 16 }] }));
        y += 80;
      } else {
        elements.push(connector(mid, { point: { x: cx(a), y } }, { point: { x: cx(b), y } }, style));
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
      elements.push({ ...sticky(keyed(`note:${++notes}`), left, y - 8, clip(s.text), 'yellow'), w: Math.round(w), h: Math.round(h) } as ElementDraft);
      y += h + 24;
    }
  }
  const bottom = y + 16;
  // Lifelines go right after the boxes, so messages and notes draw over them.
  const lifelines = boxes.map((b, i) =>
    connector(keyed(`l:${parts[i].id}`), { id: b.id, anchor: 'bottom', rect: b.r }, { point: { x: cx(i), y: bottom } }, {
      routing: 'straight',
      stroke: SOFT_LINE,
      strokeStyle: 'dashed',
      endCap: 'none',
    }),
  );
  const firstStep = (d.title ? 1 : 0) + boxes.length;
  elements.splice(firstStep, 0, ...lifelines);
  return withKeys(finish(elements), keys);
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

// ---------------------------------------------------------------------------------------------
// Kanban boards: the kanban feature's geometry (features/kanban/lib/layout.ts), cards stacked in
// their columns the way its arrange pass stacks them, so nothing jumps when it first lays out.

const KANBAN = { header: 52, colHead: 44, gap: 12, pad: 10, itemGap: 10, minBody: 180, colW: 280 };
/** Column header accents (the kanban feature's palette); status columns keep their own. */
export const KANBAN_COLUMN_COLORS = ['#8A89A3', '#2E9BF0', '#F5A524', '#1FA463', '#8B5CF6', '#E64DA6', '#14B8A6', '#E5484D'];
const STATUS_COLORS: Record<CardStatus, string> = { todo: '#8A89A3', doing: '#2E9BF0', done: '#1FA463' };
const CARD_ACCENT = '#5B3FF0';

/** The card status a column title stands for ("To do", "In progress", "Done" …), if any. */
export function columnStatus(title: string): CardStatus | null {
  const t = title.toLowerCase().trim();
  if (/^(done|complete(d)?|finished|shipped|closed|released)\b/.test(t)) return 'done';
  if (/\b(in progress|doing|wip|ongoing|in review|review|building)\b/.test(t)) return 'doing';
  if (/^(to ?-?do|backlog|next|open|planned|up next|ready)\b/.test(t)) return 'todo';
  return null;
}

/** Height a task card settles at for its title (the card feature measures it exactly on insert). */
function cardHeight(w: number, title: string): number {
  const t = measureText(title || ' ', { fontSize: 15, maxWidth: Math.max(40, w - 36), bold: true, lineHeight: 20 / 15 });
  return Math.round(13 + t.h + 10 + 24 + 12);
}

export function layoutKanban(title: string | undefined, columnsIn: KanbanColumnInput[], ctx: LayoutContext): LaidOut {
  if (!Array.isArray(columnsIn) || !columnsIn.length) throw new LayoutError('A kanban board needs at least one column');
  if (columnsIn.length > 40) throw new LayoutError('At most 40 columns per kanban board');
  for (const c of columnsIn)
    if (!c || typeof c.title !== 'string' || !Array.isArray(c.items) || c.items.some((i) => typeof i !== 'string'))
      throw new LayoutError('Every kanban column needs a title and a list of card texts');
  if (columnsIn.reduce((s, c) => s + c.items.length, 0) + 1 > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} items per structure`);
  const K = KANBAN;
  const inner = K.colW - 2 * K.pad;
  const id = ctx.newId();
  const columns = columnsIn.map((c, i) => {
    const status = columnStatus(c.title);
    return { id: ctx.newId(), title: plainToRichText(clip(c.title.trim())), status, color: status ? STATUS_COLORS[status] : KANBAN_COLUMN_COLORS[i % KANBAN_COLUMN_COLORS.length] };
  });
  const cards: ElementDraft[] = [];
  let tallest = 0;
  columnsIn.forEach((c, ci) => {
    const x = K.gap + ci * (K.colW + K.gap) + K.pad;
    let y = K.header + K.colHead + K.pad;
    for (const text of c.items) {
      const t = clip(text.trim());
      const h = cardHeight(inner, t);
      cards.push({
        id: ctx.newId(),
        type: 'card',
        x,
        y,
        w: inner,
        h,
        rotation: 0,
        frameId: id,
        title: plainToRichText(t),
        description: '',
        color: CARD_ACCENT,
        status: columns[ci].status,
        assigneeId: null,
        dueDate: null,
        tags: [],
      });
      y += h + K.itemGap;
    }
    tallest = Math.max(tallest, c.items.length ? y - K.itemGap - (K.header + K.colHead + K.pad) : 0);
  });
  const board: ElementDraft = {
    id,
    type: 'kanban',
    x: 0,
    y: 0,
    w: K.gap + columns.length * (K.colW + K.gap),
    h: K.header + K.colHead + Math.max(K.minBody, tallest + 2 * K.pad) + K.gap,
    rotation: 0,
    title: plainToRichText(clip(title?.trim() || 'Kanban')),
    columns,
    colW: K.colW,
  };
  return finish([board, ...cards]);
}

// ---------------------------------------------------------------------------------------------
// Org charts: people under their managers, as a tidy top-down tree of name / title boxes.

export function layoutOrgChart(people: OrgPersonInput[], ctx: LayoutContext): LaidOut {
  if (!Array.isArray(people) || !people.length) throw new LayoutError('An org chart needs people');
  if (people.length * 2 > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements / 2} people per org chart`);
  const byKey = new Map<string, OrgPersonInput & { key: string }>();
  const byName = new Map<string, string>();
  for (const p of people) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) throw new LayoutError('Every person needs a name');
    const key = (typeof p.id === 'string' && p.id.trim() ? p.id : p.name).trim();
    if (byKey.has(key)) throw new LayoutError(`"${key}" is listed twice`);
    byKey.set(key, { ...p, key });
    const n = p.name.trim().toLowerCase();
    if (!byName.has(n)) byName.set(n, key);
  }
  const managerOf = new Map<string, string>();
  for (const p of byKey.values()) {
    const m = typeof p.manager === 'string' ? p.manager.trim() : '';
    if (!m) continue;
    const mk = byKey.has(m) ? m : byName.get(m.toLowerCase());
    if (!mk) throw new LayoutError(`${p.name.trim()}'s manager "${m}" isn't in the list`);
    if (mk === p.key) throw new LayoutError(`${p.name.trim()} can't be their own manager`);
    managerOf.set(p.key, mk);
  }
  for (const start of byKey.keys()) {
    const seen = new Set<string>();
    for (let k: string | undefined = start; k; k = managerOf.get(k)) {
      if (seen.has(k)) throw new LayoutError(`${[...seen].map((s) => byKey.get(s)!.name.trim()).join(', ')} report to each other in a circle`);
      seen.add(k);
    }
  }
  const sizeOf = (p: OrgPersonInput) => {
    const name = measureText(clip(p.name.trim()), { fontSize: 16, maxWidth: 220, bold: true, lineHeight: 1.4 });
    const title = p.title?.trim() ? measureText(clip(p.title.trim()), { fontSize: 16, maxWidth: 220, lineHeight: 1.4 }) : { w: 0, h: 0 };
    return { w: Math.round(Math.min(280, Math.max(170, Math.max(name.w, title.w) + 48))), h: Math.round(Math.max(64, name.h + title.h + 32)) };
  };
  const units = [...byKey.values()].map((p) => ({ id: p.key, ...sizeOf(p) }));
  const edges = [...byKey.values()].filter((p) => managerOf.has(p.key)).map((p) => ({ from: managerOf.get(p.key)!, to: p.key }));
  const t = tidyTree(units, edges, { direction: 'TB', siblingGap: 32, levelGap: 64 });
  const elementId = new Map(units.map((u) => [u.id, ctx.newId()]));
  const keys = new Map<string, string>();
  const rects = new Map<string, Rect>();
  const elements: ElementDraft[] = [];
  for (const u of units) {
    const p = byKey.get(u.id)!;
    const r = { ...t.pos.get(u.id)!, w: u.w, h: u.h };
    rects.set(u.id, r);
    const html = `<b>${plainToRichText(clip(p.name.trim()))}</b>${p.title?.trim() ? `<br>${plainToRichText(clip(p.title.trim()))}` : ''}`;
    const top = !managerOf.has(u.id);
    elements.push({ ...shape(elementId.get(u.id)!, 'roundRect', r, '', { fill: top ? '#ECE9FB' : '#FFFFFF' }), text: html } as ElementDraft);
    keys.set(elementId.get(u.id)!, `n:${u.id}`);
  }
  for (const e of edges) {
    const id = ctx.newId();
    keys.set(id, `e:${e.from}>${e.to}#1`);
    elements.push(
      connector(id, { id: elementId.get(e.from)!, anchor: 'bottom', rect: rects.get(e.from)! }, { id: elementId.get(e.to)!, anchor: 'top', rect: rects.get(e.to)! }, { endCap: 'none' }),
    );
  }
  return withKeys(finish(elements), keys);
}

/**
 * Rows of "Name, Title, Manager" (comma- or tab-separated; a header row naming those columns is
 * skipped) → org-chart people. An empty or missing manager makes a top of the chart.
 */
export function parseOrgRows(text: string): OrgPersonInput[] {
  const rows = text
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.includes('\t') ? l.split('\t') : l.split(/\s*[,;|]\s*/)).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
  if (rows.length && /^name$/i.test(rows[0][0] ?? '') && rows[0].slice(1).some((c) => /title|role|manager|reports/i.test(c))) rows.shift();
  return rows.map(([name, title, manager]) => ({ name: name ?? '', ...(title ? { title } : {}), ...(manager ? { manager } : {}) }));
}

export type { ShapeKind };
