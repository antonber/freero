// Fully specified element drafts (every required field of the shared element types is set, so
// what the server writes renders exactly like what the tools create). Freero's own palette.
import type { Anchor, ShapeKind, StickyColor } from '../elements';
import type { Point, Rect } from '../geometry';
import { plainToRichText } from '../text';
import { measureText } from './measure';
import type { ElementDraft } from './types';

export const INK = '#17162B';
export const LINE = '#2B2A44';
export const SOFT_LINE = '#8A89A3';
export const STICKY_SIZE = 200;
export const STICKY_GAP = 24;

/** Mind-map node styles (the mind-map feature's pills). */
export const MIND_STYLE = {
  root: { font: 20, bold: true, padX: 26, padY: 14, minW: 150, maxText: 300 },
  node: { font: 15, bold: false, padX: 16, padY: 8, minW: 64, maxText: 260 },
} as const;
export const MIND_ROOT_COLOR = '#5B3FF0';
export const MIND_BRANCH_COLORS = ['#FF6B5B', '#2E9BF0', '#1FA463', '#F5A524', '#E64DA6', '#14B8A6', '#8B5CF6', '#F97316'];
export const CLUSTER_COLORS: StickyColor[] = ['yellow', 'blue', 'green', 'pink', 'orange', 'violet', 'cyan', 'coral', 'lime', 'gray'];

const base = (id: string, x: number, y: number, w: number, h: number, frameId?: string | null) => ({
  id,
  x: Math.round(x),
  y: Math.round(y),
  w: Math.round(w),
  h: Math.round(h),
  rotation: 0,
  ...(frameId ? { frameId } : {}),
});

export function sticky(id: string, x: number, y: number, text: string, color: StickyColor, size = STICKY_SIZE, frameId?: string | null): ElementDraft {
  return {
    ...base(id, x, y, size, size, frameId),
    type: 'sticky',
    color,
    text: plainToRichText(text),
    fontFamily: 'sans',
    fontSize: 'auto',
    textColor: INK,
    align: 'center',
    vAlign: 'middle',
  };
}

export interface ShapeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
}

export function shape(id: string, kind: ShapeKind, r: Rect, text: string, s: ShapeStyle = {}, frameId?: string | null): ElementDraft {
  return {
    ...base(id, r.x, r.y, r.w, r.h, frameId),
    type: 'shape',
    shape: kind,
    text: plainToRichText(text),
    fill: s.fill ?? '#FFFFFF',
    fillOpacity: 1,
    stroke: s.stroke ?? LINE,
    strokeWidth: s.strokeWidth ?? 2,
    strokeStyle: 'solid',
    fontFamily: 'sans',
    fontSize: s.fontSize ?? 16,
    textColor: INK,
    align: 'center',
    vAlign: 'middle',
  };
}

/** A text box `w` wide holding `text` (optionally bold), as tall as its lines. */
export function textBox(id: string, x: number, y: number, w: number, text: string, o: { size?: number; bold?: boolean; color?: string } = {}, frameId?: string | null): ElementDraft {
  const size = o.size ?? 18;
  const m = measureText(text, { fontSize: size, maxWidth: w, bold: o.bold, lineHeight: 1.4 });
  const html = o.bold ? `<b>${plainToRichText(text)}</b>` : plainToRichText(text);
  return {
    ...base(id, x, y, w, m.h + 8, frameId),
    type: 'text',
    text: html,
    fontFamily: 'sans',
    fontSize: size,
    textColor: o.color ?? INK,
    align: 'left',
    background: 'transparent',
    autoWidth: false,
  };
}

export function frame(id: string, r: Rect, title: string, frameId?: string | null): ElementDraft {
  return { ...base(id, r.x, r.y, r.w, r.h, frameId), type: 'frame', title, fill: '#FFFFFF', index: 0, preset: 'custom' };
}

export type ConnectorEnd = { id: string; anchor: Exclude<Anchor, 'auto'>; rect: Rect } | { point: Point };

export interface ConnectorStyle {
  label?: string;
  routing?: 'straight' | 'elbow' | 'curved';
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  startCap?: 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond' | 'bar';
  endCap?: 'none' | 'arrow' | 'triangle' | 'circle' | 'diamond' | 'bar';
  waypoints?: Point[];
}

export function anchorPoint(r: Rect, a: Exclude<Anchor, 'auto'>): Point {
  return a === 'top'
    ? { x: r.x + r.w / 2, y: r.y }
    : a === 'bottom'
      ? { x: r.x + r.w / 2, y: r.y + r.h }
      : a === 'left'
        ? { x: r.x, y: r.y + r.h / 2 }
        : { x: r.x + r.w, y: r.y + r.h / 2 };
}

export function connector(id: string, from: ConnectorEnd, to: ConnectorEnd, s: ConnectorStyle = {}, frameId?: string | null): ElementDraft {
  const end = (e: ConnectorEnd) => {
    if ('point' in e) return { elementId: null, x: Math.round(e.point.x), y: Math.round(e.point.y) };
    const p = anchorPoint(e.rect, e.anchor);
    return { elementId: e.id, anchor: e.anchor, x: Math.round(p.x), y: Math.round(p.y) };
  };
  const a = end(from);
  const b = end(to);
  const pts = [a, b, ...(s.waypoints ?? [])];
  const x = Math.min(...pts.map((p) => p.x));
  const y = Math.min(...pts.map((p) => p.y));
  return {
    ...base(id, x, y, Math.max(1, Math.max(...pts.map((p) => p.x)) - x), Math.max(1, Math.max(...pts.map((p) => p.y)) - y), frameId),
    type: 'connector',
    start: a,
    end: b,
    routing: s.routing ?? 'elbow',
    stroke: s.stroke ?? LINE,
    strokeWidth: s.strokeWidth ?? 2,
    strokeStyle: s.strokeStyle ?? 'solid',
    startCap: s.startCap ?? 'none',
    endCap: s.endCap ?? 'arrow',
    label: s.label ? plainToRichText(s.label) : '',
    waypoints: (s.waypoints ?? []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
  };
}

/** Moves a draft by (dx, dy), its connector ends and waypoints included. */
export function translateDraft(el: ElementDraft, dx: number, dy: number): ElementDraft {
  const moved = { ...el, x: el.x + dx, y: el.y + dy } as ElementDraft;
  if (moved.type === 'connector') {
    moved.start = { ...moved.start, x: moved.start.x + dx, y: moved.start.y + dy };
    moved.end = { ...moved.end, x: moved.end.x + dx, y: moved.end.y + dy };
    if (moved.waypoints) moved.waypoints = moved.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return moved;
}

/** Box of a mind-map pill holding `text`. */
export function mindNodeSize(text: string, isRoot: boolean): { w: number; h: number } {
  const s = isRoot ? MIND_STYLE.root : MIND_STYLE.node;
  const m = measureText(text, { fontSize: s.font, maxWidth: s.maxText, bold: s.bold, lineHeight: 1.35 });
  return { w: Math.round(Math.max(s.minW, m.w + 1 + s.padX * 2)), h: Math.round(m.h + s.padY * 2) };
}

/** Box of a diagram shape holding `text`, by outline (diamonds and ellipses need room inside). */
export function shapeSize(text: string, kind: ShapeKind, fontSize = 16): { w: number; h: number } {
  const m = measureText(text || ' ', { fontSize, maxWidth: 220, lineHeight: 1.4 });
  let w = Math.max(120, m.w + 40);
  let h = Math.max(60, m.h + 28);
  if (kind === 'diamond') {
    w = Math.max(150, m.w * 1.6 + 40);
    h = Math.max(96, m.h * 1.8 + 32);
  } else if (kind === 'ellipse') {
    w = Math.max(120, m.w * 1.35 + 40);
    h = Math.max(70, m.h * 1.35 + 28);
  } else if (kind === 'hexagon' || kind === 'parallelogram' || kind === 'trapezoid') {
    w += 40;
  } else if (kind === 'cylinder') {
    h += 24;
  }
  return { w: Math.round(w), h: Math.round(h) };
}
