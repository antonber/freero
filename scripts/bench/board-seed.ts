// The large-board benchmark's board (#130): 10,000 mixed items laid out from a fixed seed, so every
// run measures the same board. Pure: elements as the engine stores them (the `elements` map of the
// board's Yjs doc), built with the same drafts and structure layouts the server uses.
//
// The world is a grid of blocks (BLOCK_W × BLOCK_H with a GAP of empty canvas between them, so a
// marquee can start on the canvas): frames of stickies, loose stickies, flows of shapes with text
// joined by connectors, columns of text, walls of images — plus one kanban of task cards and one
// diagram (a graph laid out in a diagram container). Row 0, columns 0–4 are always loose stickies
// (the drag scenario selects them with one marquee).
import {
  connectorDraft,
  frameDraft,
  layoutStructure,
  shapeDraft,
  stickyDraft,
  textDraft,
  type BoardElement,
  type ElementDraft,
  type ShapeKind,
  type StickyColor,
} from '@freero/shared';

export const BLOCK_W = 3000;
export const BLOCK_H = 2200;
export const GAP = 600;
export const COLS = 10;

export interface BenchBoard {
  elements: BoardElement[];
  counts: Record<string, number>;
  /** World rect of the marquee that selects the drag scenario's stickies (row 0, columns 0–4). */
  dragRegion: { x: number; y: number; w: number; h: number };
  /** World center of a dense spot to look at at 100% (a frame of stickies). */
  denseSpot: { x: number; y: number };
  /** Ids a collaborator edits in the remote scenario (loose stickies of block 0). */
  remoteIds: string[];
  bounds: { x: number; y: number; w: number; h: number };
}

const WORDS =
  'plan launch review sprint budget hiring design research roadmap metrics feedback onboarding pricing churn growth retention partner vendor contract legal security audit backlog bug release beta pilot survey interview persona journey goal risk owner deadline scope demo workshop retro ideas team customer support docs api mobile web search sync export import billing invoice report analytics funnel campaign brand content video event'.split(
    ' ',
  );
const COLORS: StickyColor[] = ['yellow', 'orange', 'coral', 'pink', 'violet', 'blue', 'cyan', 'green', 'lime', 'gray'];
const SHAPES: ShapeKind[] = ['rect', 'roundRect', 'ellipse', 'diamond'];
const FILLS = ['#FFFFFF', '#E7F0FF', '#FFF4D6', '#E5F7EC', '#FBE7F1', 'transparent'];

/** `images`: urls of the uploaded pictures (natural size `imageSize`), used in turn. */
export function buildBenchBoard(opts: { total?: number; images: string[]; imageSize: { w: number; h: number }; userId: string; now?: number }): BenchBoard {
  const total = opts.total ?? 10_000;
  const now = opts.now ?? 1_760_000_000_000;
  let seed = 130;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  let nextId = 0;
  const newId = () => `b${(nextId++).toString(36)}`;

  const out: BoardElement[] = [];
  const counts: Record<string, number> = {};
  let z = 0;
  const full = () => out.length >= total;
  const add = (d: ElementDraft) => {
    if (full()) return false;
    const el = { ...d, z: d.type === 'frame' ? 0 : ++z, createdBy: opts.userId, createdAt: now, updatedAt: now } as BoardElement;
    out.push(el);
    counts[el.type] = (counts[el.type] ?? 0) + 1;
    return true;
  };
  const origin = (i: number) => ({ x: (i % COLS) * (BLOCK_W + GAP), y: Math.floor(i / COLS) * (BLOCK_H + GAP) });

  const stickyGrid = (ox: number, oy: number, frameId: string | null, ids?: string[]) => {
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 12; c++) {
        const id = newId();
        if (add(stickyDraft(id, ox + 40 + c * 240, oy + 80 + r * 230, words(2 + Math.floor(rnd() * 6)), pick(COLORS), 200, frameId))) ids?.push(id);
      }
  };
  const frameBlock = (o: { x: number; y: number }, n: number) => {
    const id = newId();
    add(frameDraft(id, { x: o.x, y: o.y, w: BLOCK_W, h: BLOCK_H }, `Frame ${n + 1}: ${words(2)}`));
    stickyGrid(o.x, o.y, id);
  };
  const flowBlock = (o: { x: number; y: number }) => {
    const rects: Array<{ id: string; rect: { x: number; y: number; w: number; h: number } }> = [];
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 8; c++) {
        const id = newId();
        const rect = { x: o.x + 40 + c * 370, y: o.y + 40 + r * 310, w: 240, h: 130 };
        const fill = pick(FILLS);
        if (add(shapeDraft(id, pick(SHAPES), rect, words(1 + Math.floor(rnd() * 4)), { fill }))) rects.push({ id, rect });
      }
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      const right = i % 8 < 7 ? rects[i + 1] : undefined;
      const down = rects[i + 8];
      if (right) add(connectorDraft(newId(), { id: a.id, anchor: 'right', rect: a.rect }, { id: right.id, anchor: 'left', rect: right.rect }, { routing: rnd() < 0.5 ? 'straight' : 'elbow', label: rnd() < 0.2 ? words(1) : undefined }));
      if (down && rnd() < 0.6) add(connectorDraft(newId(), { id: a.id, anchor: 'bottom', rect: a.rect }, { id: down.id, anchor: 'top', rect: down.rect }, { routing: rnd() < 0.3 ? 'curved' : 'elbow' }));
    }
  };
  const textBlock = (o: { x: number; y: number }) => {
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 14; r++) add(textDraft(newId(), o.x + 40 + c * 740, o.y + 40 + r * 150, 680, words(6 + Math.floor(rnd() * 14)), { size: r === 0 ? 32 : 18, bold: r === 0 }));
  };
  const imageBlock = (o: { x: number; y: number }) => {
    const { w, h } = opts.imageSize;
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 5; c++) {
        const src = opts.images[(r * 5 + c) % opts.images.length];
        add({ id: newId(), type: 'image', x: o.x + 40 + c * 590, y: o.y + 40 + r * 540, w: 540, h: Math.round((540 * h) / w), rotation: 0, src, naturalW: w, naturalH: h, alt: `Picture ${r * 5 + c + 1}` } as ElementDraft);
      }
  };
  const placeStructure = (o: { x: number; y: number }, input: Parameters<typeof layoutStructure>[0]) => {
    const laid = layoutStructure(input, { newId });
    for (const d of laid.elements) {
      const moved = { ...d, x: d.x + o.x, y: d.y + o.y } as ElementDraft;
      if (moved.type === 'connector') {
        moved.start = { ...moved.start, x: moved.start.x + o.x, y: moved.start.y + o.y };
        moved.end = { ...moved.end, x: moved.end.x + o.x, y: moved.end.y + o.y };
        moved.waypoints = (moved.waypoints ?? []).map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
      }
      add(moved);
    }
  };

  // A column right of the block grid: the kanban (400 cards), the diagram below it.
  const side = { x: COLS * (BLOCK_W + GAP), y: 0 };
  const columns = ['To do', 'Doing', 'Review', 'Done'].map((title) => ({ title, items: Array.from({ length: 100 }, () => words(3 + Math.floor(rnd() * 5))) }));
  placeStructure(side, { kind: 'kanban', title: 'Delivery', columns });
  const kanbanH = out[0].h;
  const nodes = Array.from({ length: 40 }, (_, k) => ({ id: `n${k}`, text: words(2), shape: k % 7 === 0 ? ('diamond' as const) : ('rect' as const) }));
  const edges = nodes.slice(1).map((n, k) => ({ from: `n${Math.floor(k / 2)}`, to: n.id }));
  for (let k = 0; k < 11; k++) edges.push({ from: `n${k}`, to: `n${39 - k}` });
  placeStructure({ x: side.x, y: kanbanH + GAP }, { kind: 'graph', nodes, edges, direction: 'TB' });

  // Blocks in a fixed pattern (the first five: loose stickies, see the header).
  const pattern = ['frame', 'stickies', 'flow', 'frame', 'text', 'stickies', 'flow', 'frame', 'images', 'flow'] as const;
  const remoteIds: string[] = [];
  let frames = 0;
  for (let i = 0; !full(); i++) {
    const o = origin(i);
    if (i < 5) stickyGrid(o.x, o.y, null, i === 0 ? remoteIds : undefined);
    else {
      const kind = pattern[i % pattern.length];
      if (kind === 'frame') frameBlock(o, frames++);
      else if (kind === 'stickies') stickyGrid(o.x, o.y, null);
      else if (kind === 'flow') flowBlock(o);
      else if (kind === 'text') textBlock(o);
      else imageBlock(o);
    }
  }

  const xs = out.map((e) => e.x);
  const ys = out.map((e) => e.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...out.map((e) => e.x + e.w));
  const y1 = Math.max(...out.map((e) => e.y + e.h));
  const dense = origin(7);
  return {
    elements: out,
    counts,
    dragRegion: { x: -GAP / 2, y: -GAP / 2, w: 5 * (BLOCK_W + GAP), h: BLOCK_H + GAP },
    denseSpot: { x: dense.x + BLOCK_W / 2, y: dense.y + BLOCK_H / 2 },
    remoteIds: remoteIds.slice(0, 50),
    bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
  };
}
