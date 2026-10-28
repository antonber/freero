// Builders that turn layout intent into fully specified `NewElement`s (every required field of
// the shared element types is set, so templates render the same whatever the element
// feature's defaults are). Coordinates are relative to the template origin; insertion
// translates them later (see place.ts).
import type { LucideIcon } from 'lucide-react';
import type {
  Anchor,
  CapStyle,
  CardStatus,
  IconNode,
  ConnectorRouting,
  FontFamily,
  ShapeKind,
  StickyColor,
  StrokeStyle,
  TableCopyContent,
  TextAlign,
  VerticalAlign,
} from '@freero/shared';
import type { NewElement, Point, Rect } from '@engine';
import { INK, INK_SOFT, LINE } from './palette';
import type { BuiltTemplate } from './types';

/** Escapes plain text into the RichText subset (newlines become <br>). */
export function rt(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r\n?|\n/g, '<br>');
}

/** A bold first line followed by regular lines. */
export function titled(title: string, body?: string): string {
  return body ? `<b>${rt(title)}</b><br>${rt(body)}` : `<b>${rt(title)}</b>`;
}

/** Bulleted / numbered RichText list. */
export function list(items: string[], ordered = false): string {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((i) => `<li>${rt(i)}</li>`).join('')}</${tag}>`;
}

export const STICKY = 160;

/**
 * A connector end: a free point, a side's middle (`anchor`), or a spot on the element's box as
 * fractions (`at`, e.g. a message's height on a sequence-diagram lifeline or an activation bar).
 * `at` spots must lie on the drawn outline (a box side, or a lifeline's stem at u = 0.5), where
 * the connector feature's projection keeps them.
 */
export type End = Point | { id: string; anchor: Exclude<Anchor, 'auto'> } | { id: string; at: { u: number; v: number } };

/**
 * Kanban geometry as the kanban element lays itself out. Its arrange pass restacks items on
 * insert anyway; building them in the same spots keeps the preview and the first frame right.
 */
const KANBAN = { header: 52, colHead: 44, gap: 12, pad: 10, itemGap: 10, minBody: 180 };
/** Swimlane geometry (row pools): title band, lane header column, phase header row. */
const POOL = { title: 44, laneHead: 150, phaseHead: 36 };

/** A kanban item: a task card, or a sticky note (square unless `h` is given). */
export type KanbanItem =
  | { card: string; desc?: string; color: string; due?: string }
  | { sticky: string; color: StickyColor; h?: number };

export interface KanbanColumnSpec {
  title: string;
  /** Cards dropped in this column take this status. */
  status?: CardStatus | null;
  wip?: number;
  color: string;
  items: KanbanItem[];
}

/** A table cell with its own fill (a Gantt bar, a RACI letter). */
export interface TableCell {
  t: string;
  f?: string;
}

/** A mind-map subtree; children inherit the branch color unless they name their own. */
export interface TreeSpec {
  text: string;
  color?: string;
  children?: TreeSpec[];
}

export interface BandSpec {
  title: string;
  size: number;
  color: string;
}

/** A pool's bands in template coordinates (lanes are rows, phases columns). */
export interface PoolGeometry {
  id: string;
  /** Top and height of lane i's body. */
  lane(i: number): { y: number; h: number };
  /** Left and width of phase j's body. */
  phase(j: number): { x: number; w: number };
  w: number;
  h: number;
}

/**
 * Height a task card settles at for its text and width. The card feature measures it exactly
 * on insert; this estimate (a little generous) keeps the template's layout close to that.
 */
export function cardHeight(w: number, title: string, desc = ''): number {
  const inner = Math.max(40, w - 36);
  const lines = (t: string, px: number) => t.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((l.length * px) / inner)), 0);
  const t = lines(title, 8.4);
  const d = desc ? Math.min(3, lines(desc, 7)) : 0;
  return 13 + t * 20 + (d ? 4 + d * 18 : 0) + 10 + 24 + 12;
}

const itemHeights = (colW: number, columns: KanbanColumnSpec[]) => {
  const inner = colW - 2 * KANBAN.pad;
  return columns.map((c) => c.items.map((it) => ('card' in it ? cardHeight(inner, it.card, it.desc) : Math.min(it.h ?? inner, inner))));
};

/** The size a kanban with these columns takes (lay out around it before building it). */
export function kanbanSize(colW: number, columns: KanbanColumnSpec[]): { w: number; h: number } {
  const K = KANBAN;
  const tallest = Math.max(0, ...itemHeights(colW, columns).map((hs) => (hs.length ? hs.reduce((a, b) => a + b, 0) + (hs.length - 1) * K.itemGap : 0)));
  return { w: K.gap + columns.length * (colW + K.gap), h: K.header + K.colHead + Math.max(K.minBody, tallest + 2 * K.pad) + K.gap };
}

/** The drawing of a lucide icon (the app's icon set), as an icon element stores it. */
export function iconOf(icon: LucideIcon): { name: string; nodes: IconNode[] } {
  // lucide components carry their drawing: calling the forwardRef's render once, without
  // mounting, hands it back (the icon library reads its index the same way).
  const render = (icon as unknown as { render: (props: object, ref: null) => { props: { icon: { name: string; node: IconNode[] } } } }).render;
  const data = render({}, null).props.icon;
  return { name: data.name, nodes: data.node.map(([tag, attrs]) => [tag, Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'key'))] as IconNode) };
}

export interface ShapeOpts {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  fontSize?: number | 'auto';
  fontFamily?: FontFamily;
  textColor?: string;
  align?: TextAlign;
  vAlign?: VerticalAlign;
}

export interface TextOpts {
  size?: number;
  color?: string;
  align?: TextAlign;
  background?: string;
  font?: FontFamily;
  /** Explicit height; otherwise estimated from line count. */
  h?: number;
}

export interface ConnectorOpts {
  routing?: ConnectorRouting;
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  startCap?: CapStyle;
  endCap?: CapStyle;
  label?: string;
}

/**
 * Accumulates the elements of one template. Elements created after `frame()` belong to that
 * frame (frameId) until the next frame.
 */
export class Kit {
  readonly els: NewElement[] = [];
  /** Content kept outside the elements (table cells), by element id. */
  private readonly content: Record<string, unknown> = {};
  private frameId: string | null = null;
  private rects = new Map<string, Rect>();

  constructor(private readonly newId: () => string) {}

  private push<T extends NewElement>(el: T): string {
    const id = el.id ?? this.newId();
    this.els.push({ ...el, id });
    this.rects.set(id, { x: el.x, y: el.y, w: el.w, h: el.h });
    return id;
  }

  private inFrame() {
    return this.frameId ? { frameId: this.frameId } : {};
  }

  frame(title: string, w: number, h: number, fill = '#FFFFFF', at: Point = { x: 0, y: 0 }): string {
    const id = this.newId();
    this.push<NewElement<'frame'>>({ id, type: 'frame', x: at.x, y: at.y, w, h, title, fill, index: 0, preset: 'custom' });
    this.frameId = id;
    return id;
  }

  sticky(x: number, y: number, text: string, color: StickyColor, size = STICKY, h = size): string {
    return this.push<NewElement<'sticky'>>({
      type: 'sticky',
      x,
      y,
      w: size,
      h,
      color,
      text: rt(text),
      fontFamily: 'sans',
      fontSize: 'auto',
      textColor: INK,
      align: 'center',
      vAlign: 'middle',
      ...this.inFrame(),
    });
  }

  shape(kind: ShapeKind, x: number, y: number, w: number, h: number, html: string, o: ShapeOpts = {}): string {
    return this.push<NewElement<'shape'>>({
      type: 'shape',
      shape: kind,
      x,
      y,
      w,
      h,
      text: html,
      fill: o.fill ?? '#FFFFFF',
      fillOpacity: o.fillOpacity ?? 1,
      stroke: o.stroke ?? 'transparent',
      strokeWidth: o.strokeWidth ?? 2,
      strokeStyle: o.strokeStyle ?? 'solid',
      fontFamily: o.fontFamily ?? 'sans',
      fontSize: o.fontSize ?? 18,
      textColor: o.textColor ?? INK,
      align: o.align ?? 'center',
      vAlign: o.vAlign ?? 'middle',
      ...this.inFrame(),
    });
  }

  /** A soft rounded panel (column/lane/quadrant background) with no text. */
  panel(x: number, y: number, w: number, h: number, fill: string, stroke = 'transparent'): string {
    return this.shape('roundRect', x, y, w, h, '', { fill, stroke, strokeWidth: stroke === 'transparent' ? 0 : 2 });
  }

  text(x: number, y: number, w: number, html: string, o: TextOpts = {}): string {
    const size = o.size ?? 18;
    const lines = Math.max(1, (html.match(/<br>|<li>|<p>/g) ?? []).length + (html.startsWith('<ul>') || html.startsWith('<ol>') ? 0 : 1));
    return this.push<NewElement<'text'>>({
      type: 'text',
      x,
      y,
      w,
      h: o.h ?? Math.round(lines * size * 1.4 + 8),
      text: html,
      fontFamily: o.font ?? 'sans',
      fontSize: size,
      textColor: o.color ?? INK,
      align: o.align ?? 'left',
      background: o.background ?? 'transparent',
      autoWidth: false,
      ...this.inFrame(),
    });
  }

  /** Small grey instruction line under a heading. */
  hint(x: number, y: number, w: number, text: string): string {
    return this.text(x, y, w, rt(text), { size: 16, color: INK_SOFT });
  }

  card(
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    description: string,
    color: string,
    status: 'todo' | 'doing' | 'done' | null = null,
    dueDate: string | null = null,
  ): string {
    return this.push<NewElement<'card'>>({
      type: 'card',
      x,
      y,
      w,
      h,
      title,
      description: rt(description),
      color,
      status,
      dueDate,
      assigneeId: null,
      tags: [],
      ...this.inFrame(),
    });
  }

  emoji(x: number, y: number, size: number, emoji: string): string {
    return this.push<NewElement<'emoji'>>({ type: 'emoji', x, y, w: size, h: size, emoji, ...this.inFrame() });
  }

  /** A mind-map node. Pass `parent` null for the root (its own id becomes the rootId). */
  mindmap(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    color: string,
    parent: { id: string; rootId: string } | null,
    direction?: 'right' | 'left' | 'both',
  ): { id: string; rootId: string } {
    const id = this.newId();
    const rootId = parent ? parent.rootId : id;
    this.push<NewElement<'mindmap'>>({
      id,
      type: 'mindmap',
      x,
      y,
      w,
      h,
      text: rt(text),
      color,
      parentId: parent ? parent.id : null,
      rootId,
      ...(parent ? {} : { direction: direction ?? 'right' }),
      collapsed: false,
      ...this.inFrame(),
    });
    return { id, rootId };
  }

  private endpoint(end: End) {
    if ('at' in end) {
      const r = this.rects.get(end.id);
      if (!r) throw new Error(`Connector endpoint ${end.id} is not part of this template`);
      const { u, v } = end.at;
      // `anchor` names the nearest side (clients without `at` attach there).
      const sides: Array<[Exclude<Anchor, 'auto'>, number]> = [
        ['left', u],
        ['right', 1 - u],
        ['top', v],
        ['bottom', 1 - v],
      ];
      const anchor = sides.sort((a, b) => a[1] - b[1])[0][0];
      return { elementId: end.id, anchor, at: { u, v }, x: r.x + u * r.w, y: r.y + v * r.h };
    }
    if ('id' in end) {
      const r = this.rects.get(end.id);
      if (!r) throw new Error(`Connector endpoint ${end.id} is not part of this template`);
      const p =
        end.anchor === 'top'
          ? { x: r.x + r.w / 2, y: r.y }
          : end.anchor === 'bottom'
            ? { x: r.x + r.w / 2, y: r.y + r.h }
            : end.anchor === 'left'
              ? { x: r.x, y: r.y + r.h / 2 }
              : { x: r.x + r.w, y: r.y + r.h / 2 };
      return { elementId: end.id, anchor: end.anchor, x: p.x, y: p.y };
    }
    return { elementId: null, x: end.x, y: end.y };
  }

  connector(from: End, to: End, o: ConnectorOpts = {}): string {
    const start = this.endpoint(from);
    const end = this.endpoint(to);
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    return this.push<NewElement<'connector'>>({
      type: 'connector',
      x,
      y,
      w: Math.max(1, Math.abs(end.x - start.x)),
      h: Math.max(1, Math.abs(end.y - start.y)),
      start,
      end,
      routing: o.routing ?? 'elbow',
      stroke: o.stroke ?? LINE,
      strokeWidth: o.strokeWidth ?? 2,
      strokeStyle: o.strokeStyle ?? 'solid',
      startCap: o.startCap ?? 'none',
      endCap: o.endCap ?? 'arrow',
      label: o.label ?? '',
      ...this.inFrame(),
    });
  }

  /**
   * A table with the given column widths; `rows[i]` is the row height and its cell texts (plain
   * text, or `{ t, f }` for a cell with its own fill; missing cells stay empty). `fills` colors
   * whole columns (by column index), e.g. "us" in a comparison. The first row is the header
   * unless `header` is false.
   */
  table(
    x: number,
    y: number,
    colWidths: number[],
    rows: Array<{ h: number; cells: Array<string | TableCell> }>,
    o: { header?: boolean; fontSize?: number; fills?: Record<number, string> } = {},
  ): string {
    const cols = colWidths.map((w) => ({ id: this.newId(), w }));
    const rowTracks = rows.map((r) => ({ id: this.newId(), h: r.h }));
    const cells: TableCopyContent = {};
    rows.forEach((r, ri) =>
      cols.forEach((c, ci) => {
        const cell = r.cells[ci] ?? '';
        const text = typeof cell === 'string' ? cell : cell.t;
        const fill = (typeof cell === 'string' ? undefined : cell.f) ?? o.fills?.[ci];
        if (text || fill) cells[`${rowTracks[ri].id}:${c.id}`] = { ...(text ? { t: rt(text) } : {}), ...(fill ? { f: fill } : {}) };
      }),
    );
    const id = this.push<NewElement<'table'>>({
      type: 'table',
      x,
      y,
      w: colWidths.reduce((a, b) => a + b, 0),
      h: rows.reduce((a, r) => a + r.h, 0),
      rows: rowTracks,
      cols,
      header: o.header ?? true,
      fontSize: o.fontSize ?? 16,
      ...this.inFrame(),
    });
    this.content[id] = cells;
    return id;
  }

  /**
   * A tinted section with a bold title (and an optional grey hint under it). Returns the first
   * free y inside it, below the title block.
   */
  section(
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    tint: string,
    o: { accent?: string; hint?: string; size?: number; icon?: LucideIcon } = {},
  ): number {
    this.panel(x, y, w, h, tint);
    const size = o.size ?? 22;
    const lineH = Math.round(size * 1.45);
    let tx = x + 24;
    if (o.icon) {
      const is = Math.round(size * 1.25);
      this.icon(tx, y + 18 + (lineH - is) / 2, is, o.icon, o.accent ?? INK);
      tx += is + 10;
    }
    this.text(tx, y + 18, x + w - 24 - tx, `<b>${rt(title)}</b>`, { size, color: o.accent ?? INK, h: lineH });
    if (!o.hint) return y + 18 + Math.round(size * 1.45) + 14;
    this.text(x + 24, y + 22 + size * 1.45, w - 48, rt(o.hint), { size: 14, color: INK_SOFT, h: 22 });
    return y + 22 + Math.round(size * 1.45) + 22 + 18;
  }

  /** Stickies laid out left to right, wrapping inside `w`. Returns the y below the last row. */
  stickies(x: number, y: number, w: number, texts: string[], color: StickyColor, size = STICKY, gap = 16): number {
    const perRow = Math.max(1, Math.floor((w + gap) / (size + gap)));
    texts.forEach((t, i) => this.sticky(x + (i % perRow) * (size + gap), y + Math.floor(i / perRow) * (size + gap), t, color, size));
    return y + Math.ceil(texts.length / perRow) * (size + gap) - gap;
  }

  /**
   * A mind map growing right as a tree: one column per level (`cols[level]` = node size), leaves
   * `rowH` apart, each parent centered on its children. Returns the height it takes.
   */
  mindTree(x: number, y: number, cols: Array<{ w: number; h: number }>, gapX: number, rowH: number, root: TreeSpec): number {
    const leaves = (t: TreeSpec): number => (t.children?.length ? t.children.reduce((n, c) => n + leaves(c), 0) : 1);
    const place = (t: TreeSpec, level: number, top: number, color: string, parent: { id: string; rootId: string } | null) => {
      const c = cols[Math.min(level, cols.length - 1)];
      const span = leaves(t) * rowH;
      const nx = x + cols.slice(0, level).reduce((a, b) => a + b.w + gapX, 0);
      const node = this.mindmap(nx, top + span / 2 - c.h / 2, c.w, c.h, t.text, t.color ?? color, parent, parent ? undefined : 'right');
      let childTop = top;
      for (const child of t.children ?? []) {
        place(child, level + 1, childTop, child.color ?? t.color ?? color, node);
        childTop += leaves(child) * rowH;
      }
    };
    place(root, 0, y, root.color ?? INK, null);
    return leaves(root) * rowH;
  }

  /** Builds `fn`'s elements as members of container `id` (a kanban or swimlane), then returns to the frame. */
  within(id: string, fn: () => void): void {
    const outer = this.frameId;
    this.frameId = id;
    try {
      fn();
    } finally {
      this.frameId = outer;
    }
  }

  icon(x: number, y: number, size: number, icon: LucideIcon, color: string = INK, strokeWidth = 2): string {
    const { name, nodes } = iconOf(icon);
    return this.push<NewElement<'icon'>>({ type: 'icon', x, y, w: size, h: size, name, nodes, color, strokeWidth, ...this.inFrame() });
  }

  /**
   * A kanban board with its items stacked the way the board stacks them (cards take the
   * column's width). Returns its id and height (the tallest column decides it).
   */
  kanban(x: number, y: number, title: string, colW: number, columns: KanbanColumnSpec[]): { id: string; w: number; h: number } {
    const K = KANBAN;
    const inner = colW - 2 * K.pad;
    const heights = itemHeights(colW, columns);
    const { w, h } = kanbanSize(colW, columns);
    const id = this.push<NewElement<'kanban'>>({
      type: 'kanban',
      x,
      y,
      w,
      h,
      title: rt(title),
      colW,
      columns: columns.map((c) => ({ id: this.newId(), title: rt(c.title), status: c.status ?? null, color: c.color, ...(c.wip ? { wip: c.wip } : {}) })),
      ...this.inFrame(),
    });
    this.within(id, () =>
      columns.forEach((c, ci) => {
        const ix = x + K.gap + ci * (colW + K.gap) + K.pad;
        let iy = y + K.header + K.colHead + K.pad;
        c.items.forEach((it, ii) => {
          const ih = heights[ci][ii];
          if ('card' in it) this.card(ix, iy, inner, ih, it.card, it.desc ?? '', it.color, c.status ?? null, it.due ?? null);
          else this.sticky(ix + (inner - ih) / 2, iy, it.sticky, it.color, ih);
          iy += ih + K.itemGap;
        });
      }),
    );
    return { id, w, h };
  }

  /**
   * A swimlane pool, lanes as rows and phases as columns (phase headers show with two or more
   * phases). Build what goes in it with `within(pool.id, …)` at `lane()` / `phase()` spots.
   */
  swimlane(x: number, y: number, title: string, lanes: BandSpec[], phases: BandSpec[]): PoolGeometry {
    const P = POOL;
    const top = y + P.title + (phases.length > 1 ? P.phaseHead : 0);
    const laneTop = lanes.map((_, i) => top + lanes.slice(0, i).reduce((a, b) => a + b.size, 0));
    const phaseLeft = phases.map((_, j) => x + P.laneHead + phases.slice(0, j).reduce((a, b) => a + b.size, 0));
    const w = P.laneHead + phases.reduce((a, b) => a + b.size, 0);
    const h = top - y + lanes.reduce((a, b) => a + b.size, 0);
    const band = (b: BandSpec) => ({ id: this.newId(), title: rt(b.title), size: b.size, color: b.color });
    const id = this.push<NewElement<'swimlane'>>({ type: 'swimlane', x, y, w, h, title: rt(title), lanes: lanes.map(band), phases: phases.map(band), ...this.inFrame() });
    return { id, lane: (i) => ({ y: laneTop[i], h: lanes[i].size }), phase: (j) => ({ x: phaseLeft[j], w: phases[j].size }), w, h };
  }

  /** The finished template. */
  done(): BuiltTemplate {
    return { elements: this.els, content: this.content };
  }

  /** Frame heading + one-line instruction, the common top of every template. */
  header(title: string, hintText: string, w: number, pad = 48): number {
    this.text(pad, pad - 8, w - pad * 2, `<b>${rt(title)}</b>`, { size: 32, h: 46 });
    this.hint(pad, pad + 44, w - pad * 2, hintText);
    return pad + 96; // first free y below the header
  }
}
