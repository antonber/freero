// Layout archetypes: each turns one kind of spec into Kit elements. All sizes come from the
// content (measured blocks, counts), so a spec never carries coordinates. A frame is created
// first (everything after it belongs to it), which is why each archetype measures before drawing.
import { Kit, kanbanSize, rt, titled, type KanbanColumnSpec, type TreeSpec } from '../kit';
import { HEAD, INK, INK_SOFT, LINE, VIOLET } from '../palette';
import { GAP, INSET, MIN_W, NOTE, PAD, TONES, blockHeight, drawBlock, header, headerBottom, lineCount, rowHead, textHeight, toneAt } from './blocks';
import type {
  CanvasLayout,
  ClustersLayout,
  ColumnsLayout,
  FlowLayout,
  FunnelLayout,
  HubLayout,
  JourneyLayout,
  KanbanLayout,
  MatrixLayout,
  PromptsLayout,
  Section,
  SpecMeta,
  TableLayout,
  TimelineLayout,
  Tone,
  TreeLayout,
} from './types';

type Spec<L> = SpecMeta & L;

/** Opens the frame and draws the header; returns the first free y. */
function open(k: Kit, s: SpecMeta, W: number, H: number): number {
  k.frame(s.name, W, H);
  header(k, s.name, s.hint, W);
  return headerBottom(s.hint, W);
}

/** Rows of a flowing grid: items fill `cols` columns left to right (`span` columns each). */
function flowRows<T>(items: T[], cols: number, span: (t: T) => number): Array<Array<{ item: T; col: number; span: number }>> {
  const rows: Array<Array<{ item: T; col: number; span: number }>> = [];
  let col = cols;
  for (const item of items) {
    const sp = Math.min(cols, span(item));
    if (col + sp > cols) {
      rows.push([]);
      col = 0;
    }
    rows[rows.length - 1].push({ item, col, span: sp });
    col += sp;
  }
  return rows;
}

// ── 2×2 matrix ───────────────────────────────────────────────────────────────────────────────
export function matrix(k: Kit, s: Spec<MatrixLayout>): void {
  const QW = 560;
  const SIDE = 256;
  const x0 = s.axes ? PAD + 72 : PAD;
  const tones = s.quadrants.map((q, i) => toneAt(q.tone, i, ['mint', 'violet', 'sky', 'coral']));
  const mW = 2 * QW + GAP;
  const W = Math.max(MIN_W, x0 + mW + (s.side ? 32 + SIDE : 0) + PAD);
  const top = headerBottom(s.hint, W) + (s.axes ? 40 : 0);
  const heads = [0, 1].map((r) => rowHead([s.quadrants[2 * r], s.quadrants[2 * r + 1]].map((b) => ({ b, w: QW }))));
  const rowH = [0, 1].map((r) => Math.max(blockHeight(s.quadrants[2 * r], QW, { head: heads[r] }), blockHeight(s.quadrants[2 * r + 1], QW, { head: heads[r] })));
  const sideH = s.side ? blockHeight(s.side, SIDE) : 0;
  const short = sideH - (rowH[0] + GAP + rowH[1]);
  if (short > 0) rowH.forEach((_, i) => (rowH[i] += Math.ceil(short / 2)));
  const mH = rowH[0] + GAP + rowH[1];
  const H = top + mH + (s.axes ? 80 : 0) + PAD;
  open(k, s, W, H);
  s.quadrants.forEach((q, i) => {
    const x = x0 + (i % 2) * (QW + GAP);
    const y = top + (i < 2 ? 0 : rowH[0] + GAP);
    drawBlock(k, x, y, QW, rowH[i < 2 ? 0 : 1], q, tones[i], { head: heads[i < 2 ? 0 : 1] });
  });
  if (s.axes) {
    k.connector({ x: x0 - 32, y: top + mH }, { x: x0 - 32, y: top - 8 }, { routing: 'straight', stroke: LINE, strokeWidth: 3 });
    k.connector({ x: x0, y: top + mH + 32 }, { x: x0 + mW + 8, y: top + mH + 32 }, { routing: 'straight', stroke: LINE, strokeWidth: 3 });
    k.text(x0 - 64, top - 44, 320, `<b>${rt(s.axes.y)} ↑</b>`, { size: 18, h: 30 });
    k.text(x0 + mW - 312, top + mH + 44, 320, `<b>${rt(s.axes.x)} →</b>`, { size: 18, align: 'right', h: 30 });
  }
  if (s.side) drawBlock(k, x0 + mW + 32, top, SIDE, mH, s.side, toneAt(s.side.tone, 0, ['gray']));
}

// ── Columns (retro-like) ─────────────────────────────────────────────────────────────────────
export function columns(k: Kit, s: Spec<ColumnsLayout>): void {
  const n = s.columns.length;
  const colW = n <= 3 ? 420 : n === 4 ? 384 : 232;
  const W = Math.max(MIN_W, 2 * PAD + n * colW + (n - 1) * GAP);
  const x0 = (W - (n * colW + (n - 1) * GAP)) / 2;
  const top = headerBottom(s.hint, W);
  const head = rowHead(s.columns.map((b) => ({ b, w: colW })));
  const h = Math.max(...s.columns.map((c) => blockHeight(c, colW, { head })));
  open(k, s, W, top + h + PAD);
  s.columns.forEach((c, i) => drawBlock(k, x0 + i * (colW + GAP), top, colW, h, c, toneAt(c.tone, i), { head }));
}

// ── Kanban ───────────────────────────────────────────────────────────────────────────────────
const STRIP_NOTE = 140;

export function kanban(k: Kit, s: Spec<KanbanLayout>): void {
  const colW = 280;
  const cols: KanbanColumnSpec[] = s.columns.map((c, i) => {
    const t = TONES[toneAt(c.tone, i, ['gray', 'sky', 'amber', 'violet', 'mint'])];
    return { title: c.title, status: c.status ?? null, wip: c.wip, color: t.head, items: c.cards.map((card) => ({ card: card.title, desc: card.note, color: t.accent })) };
  });
  const kb = kanbanSize(colW, cols);
  const W = Math.max(MIN_W, PAD + kb.w + PAD);
  const top = headerBottom(s.hint, W);
  // The guidance runs as a strip above the board: one row of notes, whatever the column count.
  const stripH = s.side ? blockHeight(s.side, kb.w, { note: STRIP_NOTE }) : 0;
  const boardY = top + (s.side ? stripH + 24 : 0);
  open(k, s, W, boardY + kb.h + PAD);
  if (s.side) drawBlock(k, PAD, top, kb.w, stripH, s.side, toneAt(s.side.tone, 0, ['gray']), { note: STRIP_NOTE });
  k.kanban(PAD, boardY, s.board ?? s.name, colW, cols);
}

// ── Canvas of titled sections ────────────────────────────────────────────────────────────────
export function canvas(k: Kit, s: Spec<CanvasLayout>): void {
  const colW = 400;
  const W = Math.max(MIN_W, 2 * PAD + s.cols * colW + (s.cols - 1) * GAP);
  const top = headerBottom(s.hint, W);
  const rows = flowRows(s.sections, s.cols, (sec) => sec.span ?? 1);
  const width = (span: number) => span * colW + (span - 1) * GAP;
  const heads = rows.map((r) => rowHead(r.map((c) => ({ b: c.item, w: width(c.span) }))));
  const heights = rows.map((r, ri) => Math.max(...r.map((c) => blockHeight(c.item, width(c.span), { head: heads[ri] }))));
  open(k, s, W, top + heights.reduce((a, b) => a + b + GAP, 0) - GAP + PAD);
  let y = top;
  let i = 0;
  rows.forEach((r, ri) => {
    for (const c of r) drawBlock(k, PAD + c.col * (colW + GAP), y, width(c.span), heights[ri], c.item, toneAt(c.item.tone, i++), { head: heads[ri] });
    y += heights[ri] + GAP;
  });
}

// ── Timeline / phases ────────────────────────────────────────────────────────────────────────
export function timeline(k: Kit, s: Spec<TimelineLayout>): void {
  const n = s.phases.length;
  const colW = n <= 4 ? 384 : 232;
  const HEAD_H = 84;
  const W = Math.max(MIN_W, 2 * PAD + n * colW + (n - 1) * GAP);
  const x0 = (W - (n * colW + (n - 1) * GAP)) / 2;
  const top = headerBottom(s.hint, W);
  const head = rowHead(s.phases.map((b) => ({ b, w: colW })), { untitled: true });
  const h = Math.max(...s.phases.map((p) => blockHeight(p, colW, { untitled: true, head })));
  open(k, s, W, top + HEAD_H + 12 + h + PAD);
  s.phases.forEach((p, i) => {
    const x = x0 + i * (colW + GAP);
    const tone = toneAt(p.tone, i);
    k.shape('chevron', x, top, colW, HEAD_H, p.when ? titled(p.title, p.when) : `<b>${rt(p.title)}</b>`, { fill: TONES[tone].head, fontSize: 16 });
    drawBlock(k, x, top + HEAD_H + 12, colW, h, p, tone, { untitled: true, head });
  });
}

// ── Funnel / stages ──────────────────────────────────────────────────────────────────────────
export function funnel(k: Kit, s: Spec<FunnelLayout>): void {
  const n = s.stages.length;
  const BAR = 520;
  const MIN_BAR = 260;
  const secW = 2 * INSET + 4 * NOTE + 3 * GAP;
  const W = Math.max(MIN_W, PAD + BAR + 32 + secW + PAD);
  const top = headerBottom(s.hint, W);
  const heights = s.stages.map((st) => Math.max(120, blockHeight(st, secW, { untitled: true })));
  open(k, s, W, top + heights.reduce((a, b) => a + b + GAP, 0) - GAP + PAD);
  let y = top;
  s.stages.forEach((st, i) => {
    const tone = toneAt(st.tone, i, ['violet', 'sky', 'mint', 'amber', 'rose', 'coral']);
    const bw = Math.round(BAR - ((BAR - MIN_BAR) * i) / Math.max(1, n - 1));
    k.shape('roundRect', PAD + (BAR - bw) / 2, y, bw, heights[i], `<b>${rt(st.title)}</b>`, { fill: TONES[tone].head, fontSize: 26 });
    drawBlock(k, PAD + BAR + 32, y, secW, heights[i], st, tone, { untitled: true });
    y += heights[i] + GAP;
  });
}

// ── Journey: stages × rows ───────────────────────────────────────────────────────────────────
export function journey(k: Kit, s: Spec<JourneyLayout>): void {
  const n = s.stages.length;
  const LABEL = 260;
  const cellW = n <= 4 ? 280 : 232;
  const HEAD_H = 64;
  const x0 = PAD + LABEL + GAP;
  const W = Math.max(MIN_W, x0 + n * cellW + (n - 1) * GAP + PAD);
  const top = headerBottom(s.hint, W);
  const labelH = (r: JourneyLayout['rows'][number]) => textHeight(r.title, LABEL - 32, 18, true) + textHeight(r.prompt, LABEL - 32, 14);
  const rowH = s.rows.map((r) => Math.max(140, labelH(r) + 16));
  open(k, s, W, top + HEAD_H + GAP + rowH.reduce((a, b) => a + b + 16 + GAP, 0) - GAP + PAD);
  s.stages.forEach((st, i) => k.shape('chevron', x0 + i * (cellW + GAP), top, cellW, HEAD_H, `<b>${rt(st)}</b>`, { fill: i % 2 ? HEAD.violet : HEAD.sky, fontSize: 18 }));
  let y = top + HEAD_H + GAP;
  s.rows.forEach((r, ri) => {
    const t = TONES[toneAt(r.tone, ri, ['gray', 'sky', 'rose', 'coral', 'mint', 'violet'])];
    k.panel(PAD, y, W - 2 * PAD, rowH[ri] + 16, t.tint);
    const th = textHeight(r.title, LABEL - 32, 18, true);
    k.text(PAD + 16, y + 12, LABEL - 32, `<b>${rt(r.title)}</b>`, { size: 18, color: t.accent, h: th });
    k.text(PAD + 16, y + 12 + th, LABEL - 32, rt(r.prompt), { size: 14, color: INK_SOFT, h: textHeight(r.prompt, LABEL - 32, 14) });
    r.cells.forEach((cell, i) => {
      if (cell) k.sticky(x0 + i * (cellW + GAP), y + 8, cell, t.sticky, cellW, rowH[ri]);
    });
    y += rowH[ri] + 16 + GAP;
  });
}

// ── Mind map / tree ──────────────────────────────────────────────────────────────────────────
/** Width a mind-map node settles at for its text (the mindmap feature hugs text up to a cap). */
const nodeW = (text: string, root: boolean) => (root ? Math.min(352, Math.ceil(text.length * 12.5) + 52) : Math.min(292, Math.ceil(text.length * 8.8) + 32));

export function tree(k: Kit, s: Spec<TreeLayout>): void {
  const GAP_X = 72;
  const ROW = 60;
  const SIDE = 400;
  const children = s.branches.flatMap((b) => b.children ?? []);
  const cols = [
    { w: Math.max(180, nodeW(s.root, true)), h: 64 },
    { w: Math.max(...s.branches.map((b) => nodeW(b.text, false))), h: 46 },
    { w: Math.max(120, ...children.map((c) => nodeW(c, false))), h: 38 },
  ];
  const treeW = cols.reduce((a, c) => a + c.w, 0) + 2 * GAP_X;
  const W = Math.max(MIN_W, PAD + treeW + 64 + SIDE + PAD);
  const top = headerBottom(s.hint, W);
  const leaves = s.branches.reduce((n, b) => n + Math.max(1, b.children?.length ?? 0), 0);
  const treeH = leaves * ROW;
  const sideH = blockHeight(s.side, SIDE);
  open(k, s, W, top + Math.max(treeH, sideH) + PAD);
  const spec: TreeSpec = {
    text: s.root,
    color: VIOLET,
    children: s.branches.map((b, i) => ({ text: b.text, color: TONES[toneAt(b.tone, i, ['sky', 'mint', 'amber', 'rose', 'coral', 'violet'])].accent, children: (b.children ?? []).map((c) => ({ text: c })) })),
  };
  k.mindTree(PAD, top + Math.max(0, (sideH - treeH) / 2), cols, GAP_X, ROW, spec);
  drawBlock(k, W - PAD - SIDE, top, SIDE, Math.max(treeH, sideH), s.side, toneAt(s.side.tone, 0, ['gray']));
}

// ── List with prompts ────────────────────────────────────────────────────────────────────────
export function prompts(k: Kit, s: Spec<PromptsLayout>): void {
  const Q = 460;
  const NUM = 44;
  const textW = Q - NUM - 16;
  const notesW = 4 * NOTE + 3 * GAP;
  const W = Math.max(MIN_W, PAD + INSET + Q + 32 + notesW + INSET + PAD);
  const top = headerBottom(s.hint, W);
  const qH = (it: PromptsLayout['items'][number]) => textHeight(it.prompt, textW, 19, true) + (it.detail ? textHeight(it.detail, textW, 15) : 0);
  const rowH = s.items.map((it) => Math.max(NOTE, qH(it)) + 40);
  open(k, s, W, top + rowH.reduce((a, b) => a + b + GAP, 0) - GAP + PAD);
  let y = top;
  s.items.forEach((it, i) => {
    const t = TONES[toneAt(it.tone, i, ['violet', 'sky', 'mint', 'amber', 'rose', 'coral'])];
    k.panel(PAD, y, W - 2 * PAD, rowH[i], t.tint);
    k.shape('ellipse', PAD + INSET, y + 20, NUM, NUM, `<b>${i + 1}</b>`, { fill: t.head, fontSize: 18 });
    const ph = textHeight(it.prompt, textW, 19, true);
    k.text(PAD + INSET + NUM + 16, y + 20, textW, `<b>${rt(it.prompt)}</b>`, { size: 19, h: ph });
    if (it.detail) k.text(PAD + INSET + NUM + 16, y + 20 + ph, textW, rt(it.detail), { size: 15, color: INK_SOFT, h: textHeight(it.detail, textW, 15) });
    it.notes.forEach((n, j) => k.sticky(PAD + INSET + Q + 32 + j * (NOTE + GAP), y + 20, n, t.sticky));
    y += rowH[i] + GAP;
  });
}

// ── Table ────────────────────────────────────────────────────────────────────────────────────
const CELL_PAD = 24;
const rowHeight = (cells: string[], widths: number[], bold: boolean) =>
  Math.max(48, Math.max(...cells.map((c, i) => (c ? lineCount(c, widths[i] - CELL_PAD, 16, bold) : 1))) * 23 + 24);

export function table(k: Kit, s: Spec<TableLayout>): void {
  const SIDE = 360;
  const widths = s.columns.map((c) => c.w ?? 200);
  const tw = widths.reduce((a, b) => a + b, 0);
  const W = Math.max(MIN_W, PAD + tw + (s.side ? 24 + SIDE : 0) + PAD);
  const top = headerBottom(s.hint, W);
  const text = (c: TableLayout['rows'][number][number]) => (typeof c === 'string' ? c : c.t);
  const rows = [
    { h: rowHeight(s.columns.map((c) => c.title), widths, true), cells: s.columns.map((c) => c.title) },
    ...s.rows.map((r) => ({
      h: rowHeight(r.map(text), widths, false),
      cells: r.map((c) => (typeof c === 'string' ? c : { t: c.t, f: TONES[c.tone].head })),
    })),
  ];
  const th = rows.reduce((a, r) => a + r.h, 0);
  const sideH = s.side ? blockHeight(s.side, SIDE) : 0;
  open(k, s, W, top + Math.max(th, sideH) + PAD);
  k.table(PAD, top, widths, rows);
  if (s.side) drawBlock(k, PAD + tw + 24, top, SIDE, Math.max(th, sideH), s.side, toneAt(s.side.tone, 0, ['gray']));
}

// ── Frame with sticky clusters ───────────────────────────────────────────────────────────────
export function clusters(k: Kit, s: Spec<ClustersLayout>): void {
  const cols = s.cols ?? Math.min(3, s.clusters.length);
  const CW = 384;
  const CGAP = 32;
  const W = Math.max(MIN_W, 2 * PAD + cols * CW + (cols - 1) * CGAP);
  const x0 = (W - (cols * CW + (cols - 1) * CGAP)) / 2;
  const top = headerBottom(s.hint, W);
  const rows = flowRows(s.clusters, cols, () => 1);
  const heads = rows.map((r) => rowHead(r.map((c) => ({ b: c.item, w: CW }))));
  const heights = rows.map((r, ri) => Math.max(...r.map((c) => blockHeight(c.item, CW, { head: heads[ri] }))));
  open(k, s, W, top + heights.reduce((a, b) => a + b + CGAP, 0) - CGAP + PAD);
  let y = top;
  let i = 0;
  rows.forEach((r, ri) => {
    for (const c of r) drawBlock(k, x0 + c.col * (CW + CGAP), y, CW, heights[ri], c.item, toneAt(c.item.tone, i++), { look: 'outline', head: heads[ri] });
    y += heights[ri] + CGAP;
  });
}

// ── Hub: a center with sections around it ────────────────────────────────────────────────────
export function hub(k: Kit, s: Spec<HubLayout>): void {
  const CW = 400;
  const HGAP = 64;
  const gridW = 3 * CW + 2 * HGAP;
  const W = Math.max(MIN_W, 2 * PAD + gridW);
  const x0 = (W - gridW) / 2;
  const top = headerBottom(s.hint, W);
  type Side = 'left' | 'right' | 'top' | 'bottom';
  type Cell = { sec: Section; x: number; tone: Tone; side: Side | null };
  const tone = (i: number) => toneAt(s.around[i].tone, i, ['sky', 'amber', 'mint', 'coral', 'rose', 'gray', 'violet', 'sky']);
  // Left and right of the center first, then alternately above and below it.
  const above = s.around.map((_, i) => i).filter((i) => i >= 2 && i % 2 === 0);
  const below = s.around.map((_, i) => i).filter((i) => i >= 3 && i % 2 === 1);
  /** A row of up to three, centred on the grid (so two sit between its columns). */
  const spread = (idx: number[], side: Side): Cell[] => {
    const rw = idx.length * CW + (idx.length - 1) * HGAP;
    return idx.map((i, j) => ({ sec: s.around[i], x: x0 + (gridW - rw) / 2 + j * (CW + HGAP), tone: tone(i), side }));
  };
  const middle: Cell[] = [
    { sec: s.around[0], x: x0, tone: tone(0), side: 'right' },
    { sec: s.center, x: x0 + CW + HGAP, tone: toneAt(s.center.tone, 0, ['violet']), side: null },
    { sec: s.around[1], x: x0 + 2 * (CW + HGAP), tone: tone(1), side: 'left' },
  ];
  const rows = [spread(above, 'bottom'), middle, spread(below, 'top')].filter((r) => r.length);
  const heads = rows.map((r) => rowHead(r.map((c) => ({ b: c.sec, w: CW }))));
  const heights = rows.map((r, ri) => Math.max(...r.map((c) => blockHeight(c.sec, CW, { head: heads[ri] }))));
  open(k, s, W, top + heights.reduce((a, b) => a + b + HGAP, 0) - HGAP + PAD);
  const links: Array<[string, Side]> = [];
  let centerId = '';
  let y = top;
  rows.forEach((r, ri) => {
    for (const c of r) {
      const id = drawBlock(k, c.x, y, CW, heights[ri], c.sec, c.tone, { head: heads[ri], look: c.side ? 'tint' : 'strong' });
      if (c.side) links.push([id, c.side]);
      else centerId = id;
    }
    y += heights[ri] + HGAP;
  });
  const facing = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
  for (const [id, side] of links) k.connector({ id, anchor: side }, { id: centerId, anchor: facing[side] }, { routing: 'straight', stroke: LINE, strokeWidth: 3 });
}

// ── Flow of steps ────────────────────────────────────────────────────────────────────────────
export function flow(k: Kit, s: Spec<FlowLayout>): void {
  const n = s.steps.length;
  const SW = 220;
  const SH = 96;
  const GAP_X = 72;
  const rowW = n * SW + (n - 1) * GAP_X;
  const W = Math.max(MIN_W, 2 * PAD + rowW + 2 * INSET);
  const x0 = (W - rowW) / 2;
  const top = headerBottom(s.hint, W);
  const maxNotes = Math.max(...s.steps.map((st) => st.notes.length));
  const labelH = textHeight(s.notesLabel, W - 2 * PAD - 2 * INSET, 18, true);
  const laneY = top + SH + 40;
  const laneH = 20 + labelH + 12 + maxNotes * (NOTE + GAP) - GAP + INSET;
  open(k, s, W, laneY + laneH + PAD);
  k.panel(PAD, laneY, W - 2 * PAD, laneH, TONES.gray.tint);
  k.text(PAD + INSET, laneY + 20, W - 2 * PAD - 2 * INSET, `<b>${rt(s.notesLabel)}</b>`, { size: 18, color: INK, h: labelH });
  let prev: string | null = null;
  s.steps.forEach((st, i) => {
    const x = x0 + i * (SW + GAP_X);
    const t = TONES[toneAt(st.tone, i, ['violet', 'sky', 'mint', 'amber', 'rose', 'coral'])];
    const edge = st.kind === 'start' || st.kind === 'end';
    const id = k.shape('roundRect', x, top, SW, SH, `<b>${rt(st.title)}</b>`, edge ? { fill: t.head, fontSize: 20 } : { fill: '#FFFFFF', stroke: t.accent, strokeWidth: 3, fontSize: 20 });
    if (prev) k.connector({ id: prev, anchor: 'right' }, { id, anchor: 'left' }, { routing: 'straight', stroke: LINE, strokeWidth: 3 });
    prev = id;
    st.notes.forEach((note, j) => k.sticky(x + (SW - NOTE) / 2, laneY + 20 + labelH + 12 + j * (NOTE + GAP), note, t.sticky));
  });
}
