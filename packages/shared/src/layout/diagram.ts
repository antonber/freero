// Diagram containers (#117) and their layers (#118); docs/design/diagrams.md. Pure planning shared by
// the web's diagram feature (its element `arrange`) and the server (`withDiagramLayout`), so a
// diagram laid out by either reads the same:
//   - membership upkeep (a member that joins goes to the person's active layer and loses an old pin,
//     one that leaves loses its pin, layer and layer lock, lines between members join),
//   - pins (a member moved by hand stays where it was put),
//   - the live layout, which reflows only when the diagram's structure changed (`laidOut`),
//   - layer locks and stacking, and the diagram's box hugging its members.
import type { BoardElement, ConnectorElement, DiagramElement, DiagramLayer, DiagramLayout, ElementType } from '../elements';
import { rotatedBounds, unionRects, type Rect } from '../geometry';
import { translateDraft } from './kit';
import { layered } from './layered';
import { tidyTree } from './tidy';
import type { ElementDraft, LaidOut, LayoutContext } from './types';

/** Diagram geometry (world units). */
export const DIAGRAM_LAYOUT = {
  /** Title band. */
  headerH: 44,
  /** Around the members. */
  pad: 32,
  minW: 360,
  minH: 240,
  /** Between neighbours in a rank / between ranks (the layered flow). */
  nodeSep: 56,
  rankSep: 72,
  /** Kept clear around a pinned or locked step when the flow is pushed past it. */
  clear: 24,
} as const;

/** The layer a member without one (or with an unknown one) is in, when the diagram has it. */
export const DEFAULT_LAYER = 'base';
export const DEFAULT_LAYER_NAME = 'Layer 1';

export const DIAGRAM_LAYOUT_NAMES: Record<DiagramLayout, string> = {
  down: 'Top to bottom',
  right: 'Left to right',
  up: 'Bottom to top',
  left: 'Right to left',
  tree: 'Tree',
  orgchart: 'Org chart',
  manual: 'Manual',
};

type El = BoardElement;
type Patch = Record<string, unknown>;
/** Elements by id (a Map, or the editor's `getElement`). */
export interface ElementLookup {
  get(id: string): BoardElement | undefined;
}

/** The diagram's layers, bottom to top (one default layer when it has none). */
export function diagramLayers(d: Pick<DiagramElement, 'layers'>): DiagramLayer[] {
  return d.layers?.length ? d.layers : [{ id: DEFAULT_LAYER, name: DEFAULT_LAYER_NAME }];
}

/** The id of the layer `member` is in (its own, else the default one, else the bottom one). */
export function memberLayerId(d: Pick<DiagramElement, 'layers'>, member: Pick<El, 'diagramLayer'>): string {
  const layers = diagramLayers(d);
  const id = member.diagramLayer;
  if (id && layers.some((l) => l.id === id)) return id;
  return layers.some((l) => l.id === DEFAULT_LAYER) ? DEFAULT_LAYER : layers[0].id;
}

/** The layer `member` is in. */
export function memberLayer(d: Pick<DiagramElement, 'layers'>, member: Pick<El, 'diagramLayer'>): DiagramLayer {
  const id = memberLayerId(d, member);
  return diagramLayers(d).find((l) => l.id === id)!;
}

/** The member of diagram `d` that `el` is or sits in (through frames), or null. */
export function unitOf(d: Pick<El, 'id'>, el: El | undefined, byId: ElementLookup): El | null {
  let cur = el;
  for (let depth = 0; cur && depth < 16; depth++) {
    if (cur.frameId === d.id) return cur;
    if (!cur.frameId || cur.id === d.id) return null;
    cur = byId.get(cur.frameId);
  }
  return null;
}

/** The diagram `el` is (or sits) in, through frames, or null. */
export function diagramAround(el: El | undefined, byId: ElementLookup): DiagramElement | null {
  let cur = el?.frameId ? byId.get(el.frameId) : undefined;
  for (let depth = 0; cur && depth < 16; depth++) {
    if (cur.type === 'diagram') return cur as DiagramElement;
    cur = cur.frameId ? byId.get(cur.frameId) : undefined;
  }
  return null;
}

/**
 * Whether `el`, inside diagram `d`, is folded away by a hidden layer: its own layer (or its unit's,
 * for what sits in a frame member), or — for a line — the layer of either thing it is attached to.
 */
export function hiddenByLayer(d: DiagramElement, el: El, byId: ElementLookup): boolean {
  const layers = d.layers;
  if (!layers?.some((l) => l.hidden)) return false;
  const hidden = (x: El | undefined) => {
    const unit = unitOf(d, x, byId);
    return !!unit && !!memberLayer(d, unit).hidden;
  };
  if (hidden(el)) return true;
  if (el.type === 'connector') {
    const c = el as ConnectorElement;
    for (const end of [c.start.elementId, c.end.elementId]) if (end && hidden(byId.get(end))) return true;
  }
  return false;
}

export interface DiagramStructure {
  /** Direct members, lines included. */
  members: El[];
  /** The units the layout places (direct members other than lines), in layout order. */
  units: El[];
  /** Lines joining two different units: their ids and the line. */
  edges: Array<{ from: string; to: string; line: ConnectorElement }>;
  /** Everything inside the diagram (members and what sits in them). */
  inside: El[];
}

const createdOrder = (a: El, b: El) => (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function diagramStructure(d: Pick<El, 'id'>, all: readonly El[], byId: ElementLookup = new Map(all.map((e) => [e.id, e]))): DiagramStructure {
  const members: El[] = [];
  const inside: El[] = [];
  for (const el of all) {
    if (el.id === d.id) continue;
    if (el.frameId === d.id) members.push(el);
    if (unitOf(d, el, byId)) inside.push(el);
  }
  const units = members.filter((m) => m.type !== 'connector').sort(createdOrder);
  const edges: DiagramStructure['edges'] = [];
  for (const el of all) {
    if (el.type !== 'connector') continue;
    const c = el as ConnectorElement;
    const a = c.start.elementId ? unitOf(d, byId.get(c.start.elementId), byId) : null;
    const b = c.end.elementId ? unitOf(d, byId.get(c.end.elementId), byId) : null;
    if (!a || !b || a.id === b.id || a.type === 'connector' || b.type === 'connector') continue;
    edges.push({ from: a.id, to: b.id, line: c });
  }
  return { members, units, edges, inside };
}

/** A short hash (53 bits, hex) of a string. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * What the layout depends on: the mode, every unit and its size, every edge. Positions, pins, locks,
 * layers, text and style are not in it, so moving, hiding or restyling never reflows.
 */
export function diagramSignature(layout: DiagramLayout, st: Pick<DiagramStructure, 'units' | 'edges'>): string {
  const units = st.units.map((u) => `${u.id}:${Math.round(u.w)}x${Math.round(u.h)}`).sort();
  const edges = st.edges.map((e) => `${e.from}>${e.to}`).sort();
  return `v1:${hash(`${layout}|${units.join(',')}|${edges.join(',')}`)}`;
}

export interface DiagramPlanOptions {
  /**
   * Each element the change touched, as it was before (null: created by it). Absent or empty: a
   * re-check of a merged board (nothing joined, left or was moved by hand).
   */
  previous?: ReadonlyMap<string, El | null>;
  /** The layer new members join (the person's active layer); absent: the default layer. */
  joinLayer?: string | null;
  /** Keep members' stacking in layer order (default true; the server leaves it to the clients). */
  stacking?: boolean;
  /**
   * Ids the layout itself moved earlier in the same pass (a caller that plans again after applying
   * the patches, as the engine's arrange rounds do, passes the same set): never taken for moves by
   * hand. The plan adds the ones it moves.
   */
  moved?: Set<string>;
}

const same = (a: unknown, b: unknown) => a === b || (typeof a === 'object' && typeof b === 'object' && !!a && !!b && JSON.stringify(a) === JSON.stringify(b));
const overlaps = (a: Rect, b: Rect, m: number) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
const isDiagram = (el: El | undefined): el is DiagramElement => el?.type === 'diagram';

/** Sides a line takes between two laid-out boxes: out the far side along the flow, in the near one. */
function sidesBetween(a: Rect, b: Rect, vertical: boolean): ['top' | 'bottom' | 'left' | 'right', 'top' | 'bottom' | 'left' | 'right'] {
  if (vertical) {
    if (b.y >= a.y + a.h) return ['bottom', 'top'];
    if (b.y + b.h <= a.y) return ['top', 'bottom'];
    return b.x >= a.x ? ['right', 'left'] : ['left', 'right'];
  }
  if (b.x >= a.x + a.w) return ['right', 'left'];
  if (b.x + b.w <= a.x) return ['left', 'right'];
  return b.y >= a.y ? ['bottom', 'top'] : ['top', 'bottom'];
}

/**
 * The patches that keep diagram `d` as its live layout wants it on board `all` (see the header).
 * Idempotent: null-equivalent ([]) once laid out, so it may run after every change.
 */
export function planDiagram(d: DiagramElement, all: readonly El[], opts: DiagramPlanOptions = {}): Array<{ id: string; patch: Patch }> {
  const byId = new Map(all.map((e) => [e.id, e]));
  const previous = opts.previous ?? new Map<string, El | null>();
  const patches = new Map<string, Patch>();
  const cur = (id: string): El | undefined => {
    const el = byId.get(id);
    const p = patches.get(id);
    return el && p ? ({ ...el, ...p } as El) : el;
  };
  const put = (id: string, patch: Patch) => {
    const now = cur(id) as unknown as Record<string, unknown> | undefined;
    if (!now) return;
    const out: Patch = {};
    for (const [k, v] of Object.entries(patch)) if (!same(now[k] ?? null, v ?? null)) out[k] = v;
    if (Object.keys(out).length) patches.set(id, { ...patches.get(id), ...out });
  };
  const layers = diagramLayers(d);
  const knownLayer = (id: string | null | undefined) => !!id && layers.some((l) => l.id === id);
  const { headerH, pad, minW, minH } = DIAGRAM_LAYOUT;

  // 1. Membership upkeep (only a local change says who joined or left).
  for (const [id, was] of previous) {
    const el = byId.get(id);
    if (!el || id === d.id) continue;
    const wasMember = was?.frameId === d.id;
    const isMember = el.frameId === d.id;
    if (isMember && !wasMember) {
      const join: Patch = { diagramPinned: null };
      const target = knownLayer(opts.joinLayer) ? opts.joinLayer : null;
      if (target && target !== memberLayerId(d, el)) join.diagramLayer = target;
      else if (el.diagramLayer && !knownLayer(el.diagramLayer)) join.diagramLayer = null;
      put(id, join);
    } else if (wasMember && !isMember && !diagramAround(el, byId)) {
      put(id, { diagramPinned: null, diagramLayer: null, ...(el.layerLocked ? { layerLocked: null, locked: false } : {}) });
    }
  }
  let st = diagramStructure(d, all, byId);
  const insideIds = new Set(st.inside.map((e) => e.id));
  // Lines between two things in the diagram belong to it (they copy and delete with it).
  for (const e of st.edges) if (!insideIds.has(e.line.id)) put(e.line.id, { frameId: d.id });

  // 2. Pins: a member this change moved by hand (not resized, not carried by the diagram's move).
  if (d.layout !== 'manual') {
    const dWas = previous.get(d.id);
    for (const [id, was] of previous) {
      const el = byId.get(id);
      if (!el || !was || el.frameId !== d.id || was.frameId !== d.id || el.type === 'connector' || el.diagramPinned || opts.moved?.has(id)) continue;
      const dx = el.x - was.x;
      const dy = el.y - was.y;
      if ((!dx && !dy) || el.w !== was.w || el.h !== was.h) continue;
      if (dWas && d.x - dWas.x === dx && d.y - dWas.y === dy) continue;
      put(id, { diagramPinned: true });
    }
  }

  // 3. The live layout: reflow only when the structure changed. A diagram just made adopts the
  //    drawing it arrives with (inserted from text, pasted, duplicated, made by an agent).
  st = diagramStructure(d, all.map((e) => cur(e.id)!));
  const signature = diagramSignature(d.layout, st);
  const adopt = !d.laidOut || previous.get(d.id) === null;
  if (!adopt && d.laidOut !== signature && d.layout !== 'manual' && st.units.length) for (const id of reflow(d, st, previous, cur, put)) opts.moved?.add(id);
  if (d.laidOut !== signature) put(d.id, { laidOut: signature });

  // 4. Layer locks (enforced as item locks; only the locks a layer set are lifted with it).
  const locked = new Set(layers.filter((l) => l.locked).map((l) => l.id));
  for (const el of st.inside) {
    const unit = unitOf(d, el, byId);
    const owner = unit && cur(unit.id);
    const now = cur(el.id)!;
    const should = !!owner && locked.has(memberLayerId(d, owner));
    if (should && !now.locked && !now.lockProtected) put(el.id, { locked: true, layerLocked: true });
    else if (!should && now.layerLocked) put(el.id, { layerLocked: null, ...(now.locked ? { locked: false } : {}) });
  }

  // 5. Stacking: above the diagram, layer by layer (bottom layer first).
  if (opts.stacking !== false && st.members.length) {
    const index = new Map(layers.map((l, i) => [l.id, i]));
    const members = st.members.map((m) => cur(m.id)!).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    const li = (m: El) => index.get(memberLayerId(d, m)) ?? 0;
    const inOrder = members.every((m, i) => m.z > d.z && (i === 0 || li(members[i - 1]) <= li(m)));
    if (!inOrder) {
      const sorted = [...members].sort((a, b) => li(a) - li(b) || a.z - b.z || (a.id < b.id ? -1 : 1));
      sorted.forEach((m, i) => put(m.id, { z: d.z + 1 + (i + 1) / 10_000 }));
    }
  }

  // 6. The box hugs the members (a header band above them), never smaller than its minimum.
  const boxes = st.members.filter((m) => m.type !== 'connector').map((m) => rotatedBounds(cur(m.id)!));
  const u = unionRects(boxes);
  if (u) {
    put(d.id, {
      x: Math.round(u.x - pad),
      y: Math.round(u.y - pad - headerH),
      w: Math.round(Math.max(minW, u.w + 2 * pad)),
      h: Math.round(Math.max(minH, u.h + 2 * pad + headerH)),
    });
  }
  return [...patches].map(([id, patch]) => ({ id, patch }));
}

/** Lays the diagram's units out with its mode's algorithm (see docs/design/diagrams.md, 3.). */
function reflow(
  d: DiagramElement,
  st: DiagramStructure,
  previous: ReadonlyMap<string, El | null>,
  cur: (id: string) => El | undefined,
  put: (id: string, patch: Patch) => void,
): string[] {
  const { nodeSep, rankSep, clear, headerH, pad } = DIAGRAM_LAYOUT;
  const nodes = st.units.map((u) => ({ id: u.id, w: u.w, h: u.h }));
  const edges = st.edges.map((e) => ({ from: e.from, to: e.to }));
  const mode = d.layout;
  const vertical = mode === 'down' || mode === 'up' || mode === 'orgchart';
  let r: { pos: Map<string, { x: number; y: number }>; w: number; h: number };
  if (mode === 'tree') r = tidyTree(nodes, edges, { direction: 'LR', siblingGap: 24, levelGap: rankSep });
  else if (mode === 'orgchart') r = tidyTree(nodes, edges, { direction: 'TB', siblingGap: 32, levelGap: 64 });
  else r = layered(nodes, edges, { direction: vertical ? 'TB' : 'LR', nodeSep, rankSep });
  const rect = (u: El): Rect => {
    const p = r.pos.get(u.id) ?? { x: 0, y: 0 };
    // Bottom to top / right to left: the same drawing mirrored along the flow.
    return { x: mode === 'left' ? r.w - p.x - u.w : p.x, y: mode === 'up' ? r.h - p.y - u.h : p.y, w: u.w, h: u.h };
  };
  const fixed = (u: El) => !!cur(u.id)!.diagramPinned || !!u.locked;
  const free = st.units.filter((u) => !fixed(u));
  if (!free.length) return [];
  // Keep the top-left of the free units already laid out (new ones don't drag the drawing).
  const settled = free.filter((u) => {
    const was = previous.get(u.id);
    return was === undefined || (was !== null && was.frameId === d.id);
  });
  const anchorSet = settled.length ? settled : free;
  const laidBox = unionRects(anchorSet.map(rect))!;
  const nowBox = settled.length ? unionRects(settled.map((u) => ({ x: u.x, y: u.y, w: u.w, h: u.h })))! : { x: d.x + pad, y: d.y + headerH + pad };
  const off = { x: nowBox.x - laidBox.x, y: nowBox.y - laidBox.y };
  const placed = new Map<string, Rect>();
  for (const u of free) {
    const q = rect(u);
    placed.set(u.id, { x: Math.round(q.x + off.x), y: Math.round(q.y + off.y), w: q.w, h: q.h });
  }
  // Steps people placed (pinned) or locked stay put; the flow is pushed past them across its axis.
  const blockers: Rect[] = st.units.filter(fixed).map((u) => rotatedBounds(cur(u.id)!));
  if (blockers.length) {
    const cross = (q: Rect) => (vertical ? q.x : q.y);
    const order = [...free].sort((a, b) => cross(placed.get(a.id)!) - cross(placed.get(b.id)!) || (a.id < b.id ? -1 : 1));
    const done = [...blockers];
    for (const u of order) {
      const q = { ...placed.get(u.id)! };
      for (let i = 0; i <= done.length; i++) {
        const hit = done.find((b) => overlaps(q, b, clear));
        if (!hit) break;
        if (vertical) q.x = Math.round(hit.x + hit.w + clear + 1);
        else q.y = Math.round(hit.y + hit.h + clear + 1);
      }
      placed.set(u.id, q);
      done.push(q);
    }
  }
  // Move each free unit and what travels with it (a frame's contents, stamps riding on them).
  const all = st.inside;
  const moved = new Map<string, { dx: number; dy: number }>();
  for (const u of free) {
    const q = placed.get(u.id)!;
    const dx = q.x - u.x;
    const dy = q.y - u.y;
    if (dx || dy) moved.set(u.id, { dx, dy });
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const el of all) {
      if (moved.has(el.id) || el.frameId === d.id) continue;
      const carrier = (el.frameId && moved.get(el.frameId)) || (el.attachedTo && moved.get(el.attachedTo));
      if (carrier) {
        moved.set(el.id, carrier);
        changed = true;
      }
    }
  }
  for (const [id, m] of moved) {
    const el = cur(id)!;
    const t = translateDraft(el as unknown as ElementDraft, m.dx, m.dy) as unknown as Record<string, unknown>;
    put(id, el.type === 'connector' ? { x: t.x, y: t.y, start: t.start, end: t.end, ...(t.waypoints ? { waypoints: t.waypoints } : {}) } : { x: t.x, y: t.y });
  }
  // Lines between two laid-out steps take the flow's sides and lose hand-made bends.
  const freeIds = new Set(free.map((u) => u.id));
  for (const e of st.edges) {
    const c = e.line;
    if (!freeIds.has(e.from) || !freeIds.has(e.to) || c.start.elementId !== e.from || c.end.elementId !== e.to) continue;
    const [sa, sb] = sidesBetween(placed.get(e.from)!, placed.get(e.to)!, vertical);
    const now = cur(c.id) as ConnectorElement;
    put(c.id, {
      start: { ...now.start, anchor: sa, at: null },
      end: { ...now.end, anchor: sb, at: null },
      ...(now.waypoints?.length ? { waypoints: [] } : {}),
    });
  }
  return [...moved.keys()];
}

/** A change as the server writes it (realtime's BoardChange, structurally). */
interface DiagramChange {
  create?: ReadonlyArray<{ id: string } & Record<string, unknown>>;
  update?: ReadonlyArray<{ id: string; patch: Record<string, unknown> }>;
  remove?: readonly string[];
}

/**
 * `change` laid out as open boards' diagrams would lay it out after the same change made there:
 * steps added to (or removed from, resized in) a diagram reflow it, a moved one is pinned, a new
 * diagram adopts its drawing. The layout's patches are merged into the change's own entries.
 */
export function withDiagramLayout<C extends DiagramChange>(before: readonly El[], change: C): C {
  const now = new Map(before.map((el) => [el.id, el]));
  const was = new Map(now);
  const previous = new Map<string, El | null>();
  for (const d of change.create ?? []) {
    now.set(d.id, { z: 0, ...d } as unknown as El);
    previous.set(d.id, null);
  }
  for (const u of change.update ?? []) {
    const el = now.get(u.id);
    if (!el) continue;
    if (!previous.has(u.id)) previous.set(u.id, was.get(u.id) ?? null);
    now.set(u.id, { ...el, ...u.patch } as El);
  }
  for (const id of change.remove ?? []) {
    if (!previous.has(id) && was.has(id)) previous.set(id, was.get(id)!);
    now.delete(id);
  }
  const touched = new Set<string>();
  for (const [id, prev] of previous) {
    const el = now.get(id);
    if (isDiagram(el)) touched.add(id);
    for (const around of [diagramAround(prev ?? undefined, was), diagramAround(el, now)]) if (around && now.has(around.id)) touched.add(around.id);
  }
  if (!touched.size) return change;
  const extra = new Map<string, Patch>();
  for (const id of touched) {
    const after = [...now.values()];
    const d = now.get(id) as DiagramElement;
    for (const p of planDiagram(d, after, { previous, stacking: false })) {
      extra.set(p.id, { ...extra.get(p.id), ...p.patch });
      now.set(p.id, { ...now.get(p.id)!, ...p.patch } as El);
    }
  }
  if (!extra.size) return change;
  const create = (change.create ?? []).map((d) => (extra.has(d.id) ? { ...d, ...extra.get(d.id) } : d));
  const created = new Set(create.map((d) => d.id));
  const update = (change.update ?? []).map((u) => (extra.has(u.id) ? { id: u.id, patch: { ...u.patch, ...extra.get(u.id) } } : u));
  const updated = new Set(update.map((u) => u.id));
  const more = [...extra].filter(([id]) => !created.has(id) && !updated.has(id) && now.has(id)).map(([id, patch]) => ({ id, patch }));
  return { ...change, ...(change.create ? { create } : {}), update: [...update, ...more] };
}

/** How a laid-out structure becomes a diagram: its mode and its title. */
export interface DiagramWrap {
  layout: DiagramLayout;
  title: string;
}

/**
 * `laid` inside a new diagram (from (0, 0)): the diagram first (lowest), every top-level element its
 * member, the drawing kept (the diagram adopts it). The diagram's key is `diagram`, so a re-layout of
 * edited source (from-text's reconcile) finds it again.
 */
export function wrapInDiagram(laid: LaidOut, wrap: DiagramWrap, ctx: Pick<LayoutContext, 'newId'>): LaidOut {
  const { headerH, pad, minW, minH } = DIAGRAM_LAYOUT;
  const id = ctx.newId();
  const w = Math.max(minW, laid.size.w + 2 * pad);
  const h = Math.max(minH, laid.size.h + 2 * pad + headerH);
  const diagram = {
    id,
    type: 'diagram' as ElementType,
    x: 0,
    y: 0,
    w,
    h,
    rotation: 0,
    frameId: null,
    title: wrap.title,
    layout: wrap.layout,
  } as unknown as ElementDraft;
  const elements = laid.elements.map((el) => {
    const t = translateDraft(el, pad, pad + headerH);
    return t.frameId ? t : ({ ...t, frameId: id } as ElementDraft);
  });
  return {
    ...laid,
    elements: [diagram, ...elements],
    moves: laid.moves.map((m) => ({ id: m.id, x: m.x + pad, y: m.y + pad + headerH })),
    size: { w, h },
    keys: { ...(laid.keys ?? {}), [id]: 'diagram' },
  };
}

/** The flow mode for a structure's direction. */
export const flowLayout = (direction: 'TB' | 'BT' | 'LR' | 'RL' | undefined): DiagramLayout =>
  direction === 'LR' ? 'right' : direction === 'BT' ? 'up' : direction === 'RL' ? 'left' : 'down';
