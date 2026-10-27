// Builders that turn layout intent into fully specified `NewElement`s (every required field of
// the shared element types is set, so templates render the same whatever the element
// feature's defaults are). Coordinates are relative to the template origin; insertion
// translates them later (see place.ts).
import type {
  Anchor,
  CapStyle,
  ConnectorRouting,
  FontFamily,
  ShapeKind,
  StickyColor,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from '@freero/shared';
import type { NewElement, Point, Rect } from '@engine';
import { INK, INK_SOFT, LINE } from './palette';

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

type End = Point | { id: string; anchor: Exclude<Anchor, 'auto'> };

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

  /** Frame heading + one-line instruction, the common top of every template. */
  header(title: string, hintText: string, w: number, pad = 48): number {
    this.text(pad, pad - 8, w - pad * 2, `<b>${rt(title)}</b>`, { size: 32, h: 46 });
    this.hint(pad, pad + 44, w - pad * 2, hintText);
    return pad + 96; // first free y below the header
  }
}
