// Shape outlines as absolute path segments for a w×h box. One source of truth for the SVG
// rendering, the precise hit test, connector anchors and the text area. Pure (unit-tested).
import type { ShapeKind } from '@freero/shared';
import type { Point, Rect } from '@engine';

export type Seg =
  | { t: 'M'; p: Point }
  | { t: 'L'; p: Point }
  | { t: 'C'; c1: Point; c2: Point; p: Point }
  | { t: 'Z' };

export interface ShapeGeometry {
  /** Closed outline (filled + stroked). May hold several subpaths. */
  outline: Seg[];
  /** Interior detail strokes (cylinder rim, process bars). Not part of the outline. */
  details: Seg[];
  /** Detail strokes that are always dashed, whatever the line style (a lifeline's stem). */
  dashed?: Seg[];
}

const K = 0.5522847498; // cubic Bézier circle constant

const P = (x: number, y: number): Point => ({ x, y });

function poly(points: Point[]): Seg[] {
  const segs: Seg[] = points.map((p, i) => ({ t: i === 0 ? 'M' : 'L', p }) as Seg);
  segs.push({ t: 'Z' });
  return segs;
}

/** Points of a polygon defined in unit space, stretched so its extremes touch the box. */
function fitted(unit: Point[], w: number, h: number): Point[] {
  const xs = unit.map((p) => p.x);
  const ys = unit.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const sx = w / (Math.max(...xs) - x0 || 1);
  const sy = h / (Math.max(...ys) - y0 || 1);
  return unit.map((p) => P((p.x - x0) * sx, (p.y - y0) * sy));
}

function regular(n: number, innerRatio?: number): Point[] {
  const pts: Point[] = [];
  const steps = innerRatio ? n * 2 : n;
  for (let i = 0; i < steps; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
    const r = innerRatio && i % 2 ? innerRatio : 1;
    pts.push(P(Math.cos(a) * r, Math.sin(a) * r));
  }
  return pts;
}
const PENTAGON = regular(5);
const STAR = regular(5, 0.4);

function ellipse(x: number, y: number, w: number, h: number): Seg[] {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const ox = rx * K;
  const oy = ry * K;
  return [
    { t: 'M', p: P(cx, y) },
    { t: 'C', c1: P(cx + ox, y), c2: P(x + w, cy - oy), p: P(x + w, cy) },
    { t: 'C', c1: P(x + w, cy + oy), c2: P(cx + ox, y + h), p: P(cx, y + h) },
    { t: 'C', c1: P(cx - ox, y + h), c2: P(x, cy + oy), p: P(x, cy) },
    { t: 'C', c1: P(x, cy - oy), c2: P(cx - ox, y), p: P(cx, y) },
    { t: 'Z' },
  ];
}

/** Rounded rectangle; `tail` (optional) is inserted in the bottom edge (speech bubble). */
function roundRect(w: number, h: number, r: number, tail?: Point[]): Seg[] {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const o = r * (1 - K);
  const segs: Seg[] = [
    { t: 'M', p: P(r, 0) },
    { t: 'L', p: P(w - r, 0) },
    { t: 'C', c1: P(w - o, 0), c2: P(w, o), p: P(w, r) },
    { t: 'L', p: P(w, h - r) },
    { t: 'C', c1: P(w, h - o), c2: P(w - o, h), p: P(w - r, h) },
  ];
  for (const p of tail ?? []) segs.push({ t: 'L', p });
  segs.push(
    { t: 'L', p: P(r, h) },
    { t: 'C', c1: P(o, h), c2: P(0, h - o), p: P(0, h - r) },
    { t: 'L', p: P(0, r) },
    { t: 'C', c1: P(0, o), c2: P(o, 0), p: P(r, 0) },
    { t: 'Z' },
  );
  return segs;
}

// Cloud: bumps between irregularly spaced points on an ellipse, built once in unit space and
// stretched to the box so its extremes touch the bounds.
const CLOUD_UNIT: Seg[] = (() => {
  const angles = [200, 238, 278, 318, 352, 30, 72, 112, 152];
  const base = angles.map((a) => {
    const r = (a * Math.PI) / 180;
    return P(0.5 + Math.cos(r) * 0.36, 0.5 + Math.sin(r) * 0.3);
  });
  const segs: Seg[] = [{ t: 'M', p: base[0] }];
  for (let i = 0; i < base.length; i++) {
    const a = base[i];
    const b = base[(i + 1) % base.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Outward normal for clockwise order in y-down coordinates.
    const k = 0.62;
    const n = P(dy * k, -dx * k);
    segs.push({ t: 'C', c1: P(a.x + n.x, a.y + n.y), c2: P(b.x + n.x, b.y + n.y), p: b });
  }
  segs.push({ t: 'Z' });
  const box = segsBounds(segs);
  return mapSegs(segs, (p) => P((p.x - box.x) / box.w, (p.y - box.y) / box.h));
})();

function mapSegs(segs: Seg[], f: (p: Point) => Point): Seg[] {
  return segs.map((s) =>
    s.t === 'Z' ? s : s.t === 'C' ? { t: 'C', c1: f(s.c1), c2: f(s.c2), p: f(s.p) } : { t: s.t, p: f(s.p) },
  );
}

export function shapeGeometry(kind: ShapeKind, w: number, h: number): ShapeGeometry {
  const m = Math.min(w, h);
  const none: Seg[] = [];
  switch (kind) {
    case 'rect':
      return { outline: poly([P(0, 0), P(w, 0), P(w, h), P(0, h)]), details: none };
    case 'roundRect':
      return { outline: roundRect(w, h, Math.min(24, m * 0.16)), details: none };
    case 'ellipse':
      return { outline: ellipse(0, 0, w, h), details: none };
    case 'triangle':
      return { outline: poly([P(w / 2, 0), P(w, h), P(0, h)]), details: none };
    case 'diamond':
      return { outline: poly([P(w / 2, 0), P(w, h / 2), P(w / 2, h), P(0, h / 2)]), details: none };
    case 'parallelogram': {
      const s = Math.min(w * 0.25, h * 0.6);
      return { outline: poly([P(s, 0), P(w, 0), P(w - s, h), P(0, h)]), details: none };
    }
    case 'trapezoid': {
      const s = Math.min(w * 0.22, h * 0.6);
      return { outline: poly([P(s, 0), P(w - s, 0), P(w, h), P(0, h)]), details: none };
    }
    case 'pentagon':
      return { outline: poly(fitted(PENTAGON, w, h)), details: none };
    case 'hexagon': {
      const s = Math.min(w * 0.25, h * 0.5);
      return { outline: poly([P(s, 0), P(w - s, 0), P(w, h / 2), P(w - s, h), P(s, h), P(0, h / 2)]), details: none };
    }
    case 'octagon': {
      const c = m * 0.29;
      return {
        outline: poly([P(c, 0), P(w - c, 0), P(w, c), P(w, h - c), P(w - c, h), P(c, h), P(0, h - c), P(0, c)]),
        details: none,
      };
    }
    case 'star':
      return { outline: poly(fitted(STAR, w, h)), details: none };
    case 'cross': {
      const a = w * 0.3;
      const b = h * 0.3;
      return {
        outline: poly([
          P(a, 0), P(w - a, 0), P(w - a, b), P(w, b), P(w, h - b), P(w - a, h - b),
          P(w - a, h), P(a, h), P(a, h - b), P(0, h - b), P(0, b), P(a, b),
        ]),
        details: none,
      };
    }
    case 'arrowRight':
    case 'arrowLeft': {
      const hl = Math.min(w * 0.5, h * 0.6);
      const pts = [P(0, h * 0.25), P(w - hl, h * 0.25), P(w - hl, 0), P(w, h / 2), P(w - hl, h), P(w - hl, h * 0.75), P(0, h * 0.75)];
      return { outline: poly(kind === 'arrowRight' ? pts : pts.map((p) => P(w - p.x, p.y))), details: none };
    }
    case 'chevron': {
      const d = Math.min(w * 0.4, h * 0.5);
      return { outline: poly([P(0, 0), P(w - d, 0), P(w, h / 2), P(w - d, h), P(0, h), P(d, h / 2)]), details: none };
    }
    case 'speech': {
      const bh = h * 0.8;
      const r = Math.min(20, Math.min(w, bh) * 0.18);
      // Body as a rounded rect, tail going down-left from the bottom edge.
      const body = roundRect(w, bh, r, [P(w * 0.42, bh), P(w * 0.16, h), P(w * 0.24, bh)]);
      return { outline: body, details: none };
    }
    case 'callout': {
      const bh = h * 0.8;
      return {
        outline: poly([P(0, 0), P(w, 0), P(w, bh), P(w * 0.5, bh), P(w * 0.3, h), P(w * 0.3, bh), P(0, bh)]),
        details: none,
      };
    }
    case 'cloud':
      return { outline: mapSegs(CLOUD_UNIT, (p) => P(p.x * w, p.y * h)), details: none };
    case 'cylinder': {
      const e = Math.min(h * 0.14, w * 0.3);
      const ox = (w / 2) * K;
      const oy = e * K;
      return {
        outline: [
          { t: 'M', p: P(0, e) },
          { t: 'C', c1: P(0, e - oy), c2: P(w / 2 - ox, 0), p: P(w / 2, 0) },
          { t: 'C', c1: P(w / 2 + ox, 0), c2: P(w, e - oy), p: P(w, e) },
          { t: 'L', p: P(w, h - e) },
          { t: 'C', c1: P(w, h - e + oy), c2: P(w / 2 + ox, h), p: P(w / 2, h) },
          { t: 'C', c1: P(w / 2 - ox, h), c2: P(0, h - e + oy), p: P(0, h - e) },
          { t: 'Z' },
        ],
        details: [
          { t: 'M', p: P(0, e) },
          { t: 'C', c1: P(0, e + oy), c2: P(w / 2 - ox, 2 * e), p: P(w / 2, 2 * e) },
          { t: 'C', c1: P(w / 2 + ox, 2 * e), c2: P(w, e + oy), p: P(w, e) },
        ],
      };
    }
    case 'document': {
      const a = h * 0.08;
      const s = (4 / 3) * a;
      const y = h - a;
      return {
        outline: [
          { t: 'M', p: P(0, 0) },
          { t: 'L', p: P(w, 0) },
          { t: 'L', p: P(w, y) },
          { t: 'C', c1: P(w * 0.875, y - s), c2: P(w * 0.625, y - s), p: P(w / 2, y) },
          { t: 'C', c1: P(w * 0.375, y + s), c2: P(w * 0.125, y + s), p: P(0, y) },
          { t: 'Z' },
        ],
        details: none,
      };
    }
    case 'predefinedProcess': {
      const b = Math.min(w * 0.12, 24);
      return {
        outline: poly([P(0, 0), P(w, 0), P(w, h), P(0, h)]),
        details: [
          { t: 'M', p: P(b, 0) },
          { t: 'L', p: P(b, h) },
          { t: 'M', p: P(w - b, 0) },
          { t: 'L', p: P(w - b, h) },
        ],
      };
    }
    default:
      return libraryGeometry(kind, w, h);
  }
}

/** Open polyline as segments (details). */
function line(...pts: Point[]): Seg[] {
  return pts.map((p, i) => ({ t: i === 0 ? 'M' : 'L', p }) as Seg);
}

/** Right half of an ellipse from (x, 0) clockwise to (x, h), bulging by rx. */
function bulgeRight(x: number, h: number, rx: number): Seg[] {
  const ry = h / 2;
  return [
    { t: 'C', c1: P(x + rx * K, 0), c2: P(x + rx, ry - ry * K), p: P(x + rx, ry) },
    { t: 'C', c1: P(x + rx, ry + ry * K), c2: P(x + rx * K, h), p: P(x, h) },
  ];
}

/** Diamond outline used by decision-like shapes. */
const diamond = (w: number, h: number) => poly([P(w / 2, 0), P(w, h / 2), P(w / 2, h), P(0, h / 2)]);

// Flowchart, UML, BPMN and network symbols (shape library sets). Every path is Freero's own,
// drawn from simple proportions of the box.
function libraryGeometry(kind: ShapeKind, w: number, h: number): ShapeGeometry {
  const m = Math.min(w, h);
  const none: Seg[] = [];
  const cx = w / 2;
  const cy = h / 2;
  switch (kind) {
    // ---- flowchart
    case 'terminator':
      return { outline: roundRect(w, h, m / 2), details: none };
    case 'manualInput':
      return { outline: poly([P(0, h * 0.28), P(w, 0), P(w, h), P(0, h)]), details: none };
    case 'manualOperation': {
      const s = Math.min(w * 0.2, h * 0.6);
      return { outline: poly([P(0, 0), P(w, 0), P(w - s, h), P(s, h)]), details: none };
    }
    case 'delay': {
      const rx = Math.min(w * 0.5, h * 0.5);
      return { outline: [{ t: 'M', p: P(0, 0) }, { t: 'L', p: P(w - rx, 0) }, ...bulgeRight(w - rx, h, rx), { t: 'L', p: P(0, h) }, { t: 'Z' }], details: none };
    }
    case 'display': {
      const a = Math.min(w * 0.18, h * 0.5);
      const rx = Math.min(w * 0.18, h * 0.5);
      return {
        outline: [{ t: 'M', p: P(0, cy) }, { t: 'L', p: P(a, 0) }, { t: 'L', p: P(w - rx, 0) }, ...bulgeRight(w - rx, h, rx), { t: 'L', p: P(a, h) }, { t: 'Z' }],
        details: none,
      };
    }
    case 'offPageRef':
      return { outline: poly([P(0, 0), P(w, 0), P(w, h * 0.62), P(cx, h), P(0, h * 0.62)]), details: none };
    case 'merge':
      return { outline: poly([P(0, 0), P(w, 0), P(cx, h)]), details: none };
    case 'internalStorage': {
      const b = Math.min(m * 0.16, 24);
      return { outline: poly([P(0, 0), P(w, 0), P(w, h), P(0, h)]), details: [...line(P(b, 0), P(b, h)), ...line(P(0, b), P(w, b))] };
    }
    case 'multiDocument': {
      const d = m * 0.08;
      const H = h - 2 * d;
      const a = Math.min(H * 0.08, d * 0.8);
      const s = (4 / 3) * a;
      const fw = w - 2 * d;
      const y = h - a;
      return {
        outline: [
          { t: 'M', p: P(2 * d, 0) },
          { t: 'L', p: P(w, 0) },
          { t: 'L', p: P(w, H) },
          { t: 'L', p: P(w - d, H) },
          { t: 'L', p: P(w - d, H + d) },
          { t: 'L', p: P(fw, H + d) },
          { t: 'L', p: P(fw, y) },
          { t: 'C', c1: P(fw * 0.875, y - s), c2: P(fw * 0.625, y - s), p: P(fw / 2, y) },
          { t: 'C', c1: P(fw * 0.375, y + s), c2: P(fw * 0.125, y + s), p: P(0, y) },
          { t: 'L', p: P(0, 2 * d) },
          { t: 'L', p: P(d, 2 * d) },
          { t: 'L', p: P(d, d) },
          { t: 'L', p: P(2 * d, d) },
          { t: 'Z' },
        ],
        details: [...line(P(d, 2 * d), P(fw, 2 * d), P(fw, H + d)), ...line(P(2 * d, d), P(w - d, d), P(w - d, H))],
      };
    }
    case 'punchedCard': {
      const c = m * 0.22;
      return { outline: poly([P(c, 0), P(w, 0), P(w, h), P(0, h), P(0, c)]), details: none };
    }
    case 'punchedTape': {
      const a = h * 0.1;
      const s = (4 / 3) * a;
      return {
        outline: [
          { t: 'M', p: P(0, a) },
          { t: 'C', c1: P(w * 0.125, a + s), c2: P(w * 0.375, a + s), p: P(cx, a) },
          { t: 'C', c1: P(w * 0.625, a - s), c2: P(w * 0.875, a - s), p: P(w, a) },
          { t: 'L', p: P(w, h - a) },
          { t: 'C', c1: P(w * 0.875, h - a - s), c2: P(w * 0.625, h - a - s), p: P(cx, h - a) },
          { t: 'C', c1: P(w * 0.375, h - a + s), c2: P(w * 0.125, h - a + s), p: P(0, h - a) },
          { t: 'Z' },
        ],
        details: none,
      };
    }
    case 'collate':
      return { outline: [...poly([P(0, 0), P(w, 0), P(cx, cy)]), ...poly([P(cx, cy), P(w, h), P(0, h)])], details: none };
    case 'sort':
      return { outline: diamond(w, h), details: line(P(0, cy), P(w, cy)) };
    case 'loopLimit': {
      const c = Math.min(w * 0.2, h * 0.32);
      return { outline: poly([P(c, 0), P(w - c, 0), P(w, c), P(w, h), P(0, h), P(0, c)]), details: none };
    }
    case 'storedData': {
      const rx = Math.min(w * 0.15, h * 0.5);
      const ry = h / 2;
      return {
        outline: [
          { t: 'M', p: P(rx, 0) },
          { t: 'L', p: P(w, 0) },
          { t: 'C', c1: P(w - rx * K, 0), c2: P(w - rx, ry - ry * K), p: P(w - rx, ry) },
          { t: 'C', c1: P(w - rx, ry + ry * K), c2: P(w - rx * K, h), p: P(w, h) },
          { t: 'L', p: P(rx, h) },
          { t: 'C', c1: P(rx - rx * K, h), c2: P(0, ry + ry * K), p: P(0, ry) },
          { t: 'C', c1: P(0, ry - ry * K), c2: P(rx - rx * K, 0), p: P(rx, 0) },
          { t: 'Z' },
        ],
        details: none,
      };
    }
    case 'summingJunction': {
      const k = Math.SQRT1_2;
      return {
        outline: ellipse(0, 0, w, h),
        details: [...line(P(cx - cx * k, cy - cy * k), P(cx + cx * k, cy + cy * k)), ...line(P(cx + cx * k, cy - cy * k), P(cx - cx * k, cy + cy * k))],
      };
    }
    case 'orJunction':
      return { outline: ellipse(0, 0, w, h), details: [...line(P(cx, 0), P(cx, h)), ...line(P(0, cy), P(w, cy))] };

    // ---- UML
    case 'umlClass': {
      const y1 = Math.min(h * 0.3, 40);
      const y2 = y1 + (h - y1) * 0.5;
      return { outline: poly([P(0, 0), P(w, 0), P(w, h), P(0, h)]), details: [...line(P(0, y1), P(w, y1)), ...line(P(0, y2), P(w, y2))] };
    }
    case 'umlActor': {
      const r = Math.min(w * 0.2, h * 0.11);
      const hip = h * 0.56;
      return {
        outline: ellipse(cx - r, 0, 2 * r, 2 * r),
        details: [
          ...line(P(cx, 2 * r), P(cx, hip)),
          ...line(P(0, h * 0.32), P(w, h * 0.32)),
          ...line(P(0, h), P(cx, hip), P(w, h)),
        ],
      };
    }
    case 'umlPackage': {
      const t = Math.min(h * 0.18, 24);
      const tw = w * 0.4;
      return { outline: poly([P(0, 0), P(tw, 0), P(tw, t), P(w, t), P(w, h), P(0, h)]), details: line(P(0, t), P(tw, t)) };
    }
    case 'umlNote': {
      const c = Math.min(m * 0.22, 28);
      return { outline: poly([P(0, 0), P(w - c, 0), P(w, c), P(w, h), P(0, h)]), details: line(P(w - c, 0), P(w - c, c), P(w, c)) };
    }
    case 'umlComponent': {
      const t = Math.min(w * 0.08, 14);
      const th = Math.min(h * 0.14, 16);
      const y1 = h * 0.22;
      const y2 = h * 0.58;
      return {
        outline: poly([
          P(t, 0), P(w, 0), P(w, h), P(t, h),
          P(t, y2 + th), P(0, y2 + th), P(0, y2), P(t, y2),
          P(t, y1 + th), P(0, y1 + th), P(0, y1), P(t, y1),
        ]),
        details: [...line(P(t, y1), P(2 * t, y1), P(2 * t, y1 + th), P(t, y1 + th)), ...line(P(t, y2), P(2 * t, y2), P(2 * t, y2 + th), P(t, y2 + th))],
      };
    }
    case 'umlNode': {
      const d = m * 0.15;
      return {
        outline: poly([P(0, d), P(d, 0), P(w, 0), P(w, h - d), P(w - d, h), P(0, h)]),
        details: [...line(P(0, d), P(w - d, d), P(w, 0)), ...line(P(w - d, d), P(w - d, h))],
      };
    }

    // ---- BPMN
    case 'bpmnIntermediate': {
      const i = m * 0.09;
      return { outline: ellipse(0, 0, w, h), details: ellipse(i, i, w - 2 * i, h - 2 * i) };
    }
    case 'bpmnEnd': {
      const i = m * 0.035;
      return { outline: ellipse(0, 0, w, h), details: [...ellipse(i, i, w - 2 * i, h - 2 * i), ...ellipse(2 * i, 2 * i, w - 4 * i, h - 4 * i)] };
    }
    case 'bpmnGatewayX': {
      const a = w * 0.17;
      const b = h * 0.17;
      return { outline: diamond(w, h), details: [...line(P(cx - a, cy - b), P(cx + a, cy + b)), ...line(P(cx + a, cy - b), P(cx - a, cy + b))] };
    }
    case 'bpmnGatewayPlus': {
      const a = w * 0.22;
      const b = h * 0.22;
      return { outline: diamond(w, h), details: [...line(P(cx - a, cy), P(cx + a, cy)), ...line(P(cx, cy - b), P(cx, cy + b))] };
    }
    case 'bpmnGatewayO':
      return { outline: diamond(w, h), details: ellipse(cx - w * 0.2, cy - h * 0.2, w * 0.4, h * 0.4) };
    case 'bpmnSubprocess': {
      const q = Math.min(14, h * 0.2, w * 0.2);
      const x = cx - q / 2;
      const y = h - q - Math.min(6, h * 0.06);
      return {
        outline: roundRect(w, h, Math.min(16, m * 0.14)),
        details: [
          ...line(P(x, y), P(x + q, y), P(x + q, y + q), P(x, y + q), P(x, y)),
          ...line(P(cx, y + q * 0.2), P(cx, y + q * 0.8)),
          ...line(P(x + q * 0.2, y + q / 2), P(x + q * 0.8, y + q / 2)),
        ],
      };
    }

    // ---- UML sequence diagrams
    case 'umlLifeline': {
      const hh = lifelineHead(h);
      return { outline: poly([P(0, 0), P(w, 0), P(w, hh), P(0, hh)]), details: none, dashed: line(P(cx, hh), P(cx, h)) };
    }
    case 'umlActivation':
      return { outline: poly([P(0, 0), P(w, 0), P(w, h), P(0, h)]), details: none };
    case 'umlFragment': {
      const t = fragmentTag(w, h);
      const c = Math.min(8, t.h / 2);
      return { outline: poly([P(0, 0), P(w, 0), P(w, h), P(0, h)]), details: line(P(0, t.h), P(t.w - c, t.h), P(t.w, t.h - c), P(t.w, 0)) };
    }

    // ---- BPMN events with markers
    case 'bpmnMessageEvent': {
      const i = m * 0.09;
      const ew = w * 0.42;
      const eh = h * 0.3;
      const x = cx - ew / 2;
      const y = cy - eh / 2;
      return {
        outline: ellipse(0, 0, w, h),
        details: [...ellipse(i, i, w - 2 * i, h - 2 * i), ...line(P(x, y), P(x + ew, y), P(x + ew, y + eh), P(x, y + eh), P(x, y)), ...line(P(x, y), P(cx, cy + eh * 0.12), P(x + ew, y))],
      };
    }
    case 'bpmnTimerEvent': {
      const i = m * 0.09;
      const rx = w * 0.27;
      const ry = h * 0.27;
      const ticks: Seg[] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI) / 6;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        ticks.push(...line(P(cx + ca * rx * 0.78, cy + sa * ry * 0.78), P(cx + ca * rx, cy + sa * ry)));
      }
      return {
        outline: ellipse(0, 0, w, h),
        details: [
          ...ellipse(i, i, w - 2 * i, h - 2 * i),
          ...ellipse(cx - rx, cy - ry, 2 * rx, 2 * ry),
          ...ticks,
          ...line(P(cx + rx * 0.45, cy - ry * 0.62), P(cx, cy), P(cx + rx * 0.62, cy + ry * 0.1)),
        ],
      };
    }
    case 'bpmnErrorEvent': {
      const i = m * 0.035;
      const q = (x: number, y: number) => P(w * x, h * y);
      return {
        outline: ellipse(0, 0, w, h),
        details: [
          ...ellipse(i, i, w - 2 * i, h - 2 * i),
          ...ellipse(2 * i, 2 * i, w - 4 * i, h - 4 * i),
          ...poly([q(0.3, 0.72), q(0.41, 0.3), q(0.55, 0.52), q(0.7, 0.28), q(0.6, 0.7), q(0.46, 0.48)]),
        ],
      };
    }

    // ---- entity-relationship: the divider under the title line depends on the text size, so the
    // element draws it (entityDivider).
    case 'erdEntity':
      return { outline: roundRect(w, h, Math.min(6, m * 0.05)), details: none };

    // ---- network
    case 'netServer': {
      const u = h / 3;
      const led = (y: number) => line(P(w * 0.72, y), P(w * 0.86, y));
      return {
        outline: roundRect(w, h, Math.min(8, m * 0.08)),
        details: [...line(P(0, u), P(w, u)), ...line(P(0, 2 * u), P(w, 2 * u)), ...led(u / 2), ...led(u * 1.5), ...led(u * 2.5)],
      };
    }
    case 'netFirewall': {
      const r1 = h / 3;
      const r2 = (2 * h) / 3;
      return {
        outline: poly([P(0, 0), P(w, 0), P(w, h), P(0, h)]),
        details: [
          ...line(P(0, r1), P(w, r1)),
          ...line(P(0, r2), P(w, r2)),
          ...line(P(cx, 0), P(cx, r1)),
          ...line(P(w / 4, r1), P(w / 4, r2)),
          ...line(P((3 * w) / 4, r1), P((3 * w) / 4, r2)),
          ...line(P(cx, r2), P(cx, h)),
        ],
      };
    }
    case 'netRouter': {
      const a = w * 0.3;
      const b = h * 0.3;
      const hx = w * 0.07;
      const hy = h * 0.07;
      return {
        outline: ellipse(0, 0, w, h),
        details: [
          ...line(P(cx - a, cy), P(cx + a, cy)),
          ...line(P(cx, cy - b), P(cx, cy + b)),
          ...line(P(cx + a - hx, cy - hy), P(cx + a, cy), P(cx + a - hx, cy + hy)),
          ...line(P(cx - a + hx, cy - hy), P(cx - a, cy), P(cx - a + hx, cy + hy)),
          ...line(P(cx - hx, cy - b + hy), P(cx, cy - b), P(cx + hx, cy - b + hy)),
          ...line(P(cx - hx, cy + b - hy), P(cx, cy + b), P(cx + hx, cy + b - hy)),
        ],
      };
    }
    case 'netSwitch': {
      const hx = Math.min(w * 0.06, 10);
      const hy = h * 0.1;
      const y1 = h * 0.34;
      const y2 = h * 0.66;
      return {
        outline: roundRect(w, h, Math.min(8, m * 0.1)),
        details: [
          ...line(P(w * 0.2, y1), P(w * 0.8, y1)),
          ...line(P(w * 0.8 - hx, y1 - hy), P(w * 0.8, y1), P(w * 0.8 - hx, y1 + hy)),
          ...line(P(w * 0.2, y2), P(w * 0.8, y2)),
          ...line(P(w * 0.2 + hx, y2 - hy), P(w * 0.2, y2), P(w * 0.2 + hx, y2 + hy)),
        ],
      };
    }
    case 'netMonitor': {
      const sh = h * 0.76;
      const i = m * 0.06;
      return {
        outline: poly([
          P(0, 0), P(w, 0), P(w, sh), P(w * 0.6, sh), P(w * 0.63, h * 0.9), P(w * 0.76, h * 0.9), P(w * 0.76, h),
          P(w * 0.24, h), P(w * 0.24, h * 0.9), P(w * 0.37, h * 0.9), P(w * 0.4, sh), P(0, sh),
        ]),
        details: line(P(i, i), P(w - i, i), P(w - i, sh - i), P(i, sh - i), P(i, i)),
      };
    }
    case 'netLaptop': {
      const i = m * 0.05;
      return {
        outline: poly([P(w * 0.1, 0), P(w * 0.9, 0), P(w * 0.9, h * 0.8), P(w, h * 0.92), P(w, h), P(0, h), P(0, h * 0.92), P(w * 0.1, h * 0.8)]),
        details: [
          ...line(P(w * 0.1 + i, i), P(w * 0.9 - i, i), P(w * 0.9 - i, h * 0.8 - i), P(w * 0.1 + i, h * 0.8 - i), P(w * 0.1 + i, i)),
          ...line(P(0, h * 0.92), P(w, h * 0.92)),
        ],
      };
    }
    case 'netPhone': {
      const top = h * 0.12;
      const bottom = h * 0.82;
      const i = w * 0.1;
      return {
        outline: roundRect(w, h, m * 0.18),
        details: [...line(P(i, top), P(w - i, top), P(w - i, bottom), P(i, bottom), P(i, top)), ...line(P(w * 0.4, h * 0.91), P(w * 0.6, h * 0.91))],
      };
    }
    case 'netUser': {
      const rx = w * 0.22;
      const ry = h * 0.25;
      const top = h * 0.57;
      return {
        outline: [
          ...ellipse(cx - rx, 0, 2 * rx, 2 * ry),
          { t: 'M', p: P(0, h) },
          { t: 'C', c1: P(0, top + (h - top) * 0.25), c2: P(w * 0.22, top), p: P(cx, top) },
          { t: 'C', c1: P(w * 0.78, top), c2: P(w, top + (h - top) * 0.25), p: P(w, h) },
          { t: 'Z' },
        ],
        details: none,
      };
    }
    default:
      return wireframeGeometry(kind, w, h) ?? { outline: poly([P(0, 0), P(w, 0), P(w, h), P(0, h)]), details: none };
  }
}

// ---- Wireframe kit (KAI-120): low-fidelity device frames and UI controls, Freero's own drawings.
// Corner radii, marks and bars have fixed sizes (capped by the box), so a resized control keeps
// its look instead of stretching.

const at = (segs: Seg[], dx: number, dy: number) => mapSegs(segs, (p) => P(p.x + dx, p.y + dy));
/** Rounded rectangle at (x, y). */
const rr = (x: number, y: number, w: number, h: number, r: number) => at(roundRect(Math.max(0.5, w), Math.max(0.5, h), r), x, y);
const circle = (cx: number, cy: number, r: number) => ellipse(cx - r, cy - r, 2 * r, 2 * r);

/** Controls whose label sits beside their mark (checkbox, radio, toggle, slider). */
const LABEL_BESIDE = new Set<ShapeKind>(['wfCheckbox', 'wfRadio', 'wfToggle', 'wfSlider']);
export const labelBeside = (kind: ShapeKind) => LABEL_BESIDE.has(kind);

const wf = {
  browserBar: (h: number) => Math.min(40, h * 0.22),
  phoneInset: (m: number) => Math.min(10, m * 0.05),
  tabletInset: (m: number) => Math.min(16, m * 0.05),
  desktopScreen: (h: number) => h * 0.8,
  bezel: (m: number) => Math.min(12, m * 0.04),
  /** Side of a checkbox / radio mark. */
  mark: (w: number, h: number) => Math.min(h, w, 28),
  toggleW: (w: number, h: number) => Math.min(w, h * 1.8),
  sliderLabel: (w: number) => w * 0.3,
  listTitle: (h: number) => Math.min(36, h * 0.22),
  modalTitle: (h: number) => Math.min(48, h * 0.2),
  cardImage: (h: number) => h * 0.5,
};

function wireframeGeometry(kind: ShapeKind, w: number, h: number): ShapeGeometry | null {
  const m = Math.min(w, h);
  const cy = h / 2;
  switch (kind) {
    case 'wfBrowser': {
      const bar = wf.browserBar(h);
      const dot = Math.min(5, bar * 0.14);
      const details = [...line(P(0, bar), P(w, bar))];
      if (w >= 120) details.push(...circle(16, bar / 2, dot), ...circle(32, bar / 2, dot), ...circle(48, bar / 2, dot), ...rr(64, bar * 0.22, w - 80, bar * 0.56, bar * 0.28));
      return { outline: roundRect(w, h, Math.min(10, m / 4)), details };
    }
    case 'wfPhone': {
      const r = Math.min(32, m * 0.16);
      const i = wf.phoneInset(m);
      return {
        outline: roundRect(w, h, r),
        details: [
          ...rr(i, i, w - 2 * i, h - 2 * i, Math.max(2, r - i)),
          ...line(P(w / 2 - Math.min(22, w * 0.1), i + 10), P(w / 2 + Math.min(22, w * 0.1), i + 10)),
          ...line(P(w / 2 - Math.min(30, w * 0.14), h - i - 9), P(w / 2 + Math.min(30, w * 0.14), h - i - 9)),
        ],
      };
    }
    case 'wfTablet': {
      const r = Math.min(22, m * 0.07);
      const i = wf.tabletInset(m);
      return { outline: roundRect(w, h, r), details: [...rr(i, i, w - 2 * i, h - 2 * i, Math.max(2, r - i)), ...circle(w / 2, i / 2, Math.max(1, Math.min(3, i * 0.25)))] };
    }
    case 'wfDesktop': {
      const sh = wf.desktopScreen(h);
      const i = wf.bezel(m);
      const foot = h - (h - sh) * 0.3;
      return {
        outline: [
          ...roundRect(w, sh, Math.min(10, m * 0.04)),
          ...poly([P(w * 0.44, sh), P(w * 0.56, sh), P(w * 0.56, foot), P(w * 0.7, foot), P(w * 0.7, h), P(w * 0.3, h), P(w * 0.3, foot), P(w * 0.44, foot)]),
        ],
        details: rr(i, i, w - 2 * i, sh - 2 * i, Math.max(2, Math.min(10, m * 0.04) - i / 2)),
      };
    }
    case 'wfButton':
      return { outline: roundRect(w, h, Math.min(8, h / 2)), details: [] };
    case 'wfInput':
      return { outline: roundRect(w, h, Math.min(6, h / 2)), details: [] };
    case 'wfSearch': {
      const r = Math.min(h * 0.17, 9);
      const c = P(Math.min(h * 0.5, 22) + 1, cy - 1.5);
      return { outline: roundRect(w, h, h / 2), details: [...circle(c.x, c.y, r), ...line(P(c.x + r * 0.7, c.y + r * 0.7), P(c.x + r * 1.6, c.y + r * 1.6))] };
    }
    case 'wfTextArea':
      return {
        outline: roundRect(w, h, Math.min(6, m / 2)),
        details: m >= 24 ? [...line(P(w - 14, h - 4), P(w - 4, h - 14)), ...line(P(w - 9, h - 4), P(w - 4, h - 9))] : [],
      };
    case 'wfCheckbox': {
      const s = wf.mark(w, h);
      const y = (h - s) / 2;
      return {
        outline: rr(0, y, s, s, Math.min(4, s * 0.2)),
        details: line(P(s * 0.24, cy), P(s * 0.42, cy + s * 0.18), P(s * 0.76, cy - s * 0.2)),
      };
    }
    case 'wfRadio': {
      const s = wf.mark(w, h);
      return { outline: circle(s / 2, cy, s / 2), details: circle(s / 2, cy, s * 0.2) };
    }
    case 'wfToggle': {
      const tw = wf.toggleW(w, h);
      return { outline: rr(0, 0, tw, h, h / 2), details: circle(tw - h / 2, cy, Math.max(1, h / 2 - 4)) };
    }
    case 'wfDropdown': {
      const c = Math.min(5, h * 0.14);
      const x = w - Math.min(20, w * 0.15);
      return { outline: roundRect(w, h, Math.min(6, h / 2)), details: line(P(x - c, cy - c / 2), P(x, cy + c / 2), P(x + c, cy - c / 2)) };
    }
    case 'wfTabs': {
      const tw = w / 3;
      const bar = (x0: number) => line(P(x0 + tw * 0.3, cy), P(x0 + tw * 0.7, cy));
      return {
        outline: roundRect(w, h, Math.min(6, h / 2)),
        details: [...line(P(tw, 0), P(tw, h)), ...line(P(2 * tw, 0), P(2 * tw, h)), ...line(P(Math.min(8, tw / 4), h - 4), P(tw - Math.min(8, tw / 4), h - 4)), ...bar(tw), ...bar(2 * tw)],
      };
    }
    case 'wfNavBar': {
      const d = h * 0.5;
      const details = [...circle(12 + d / 2, cy, d / 2)];
      if (w >= 320) for (let k = 0; k < 3; k++) details.push(...line(P(w - 16 - (k + 1) * 60 + 12, cy), P(w - 16 - k * 60, cy)));
      return { outline: roundRect(w, h, Math.min(4, m / 2)), details };
    }
    case 'wfCard': {
      const ih = wf.cardImage(h);
      return {
        outline: roundRect(w, h, Math.min(10, m * 0.1)),
        details: [
          ...line(P(0, ih), P(w, ih)),
          ...line(P(w * 0.2, ih * 0.8), P(w * 0.42, ih * 0.42), P(w * 0.56, ih * 0.62), P(w * 0.66, ih * 0.5), P(w * 0.8, ih * 0.8)),
          ...circle(w * 0.72, ih * 0.27, Math.min(9, ih * 0.08)),
          ...line(P(12, h * 0.82), P(w * 0.72, h * 0.82)),
          ...line(P(12, h * 0.9), P(w * 0.5, h * 0.9)),
        ],
      };
    }
    case 'wfList': {
      const t = wf.listTitle(h);
      const n = Math.max(1, Math.floor((h - t) / 40));
      const rowH = (h - t) / n;
      const details = [...line(P(0, t), P(w, t))];
      for (let i = 0; i < n; i++) {
        const y0 = t + i * rowH;
        if (i > 0) details.push(...line(P(12, y0), P(w - 12, y0)));
        details.push(...circle(20, y0 + rowH / 2, Math.min(5, rowH * 0.15)), ...line(P(34, y0 + rowH / 2), P(34 + Math.max(4, (w - 60) * (0.8 - 0.18 * (i % 3))), y0 + rowH / 2)));
      }
      return { outline: roundRect(w, h, Math.min(8, m * 0.1)), details };
    }
    case 'wfImage': {
      const r = Math.min(4, m * 0.05);
      const k = r * (1 - Math.SQRT1_2);
      return { outline: roundRect(w, h, r), details: [...line(P(k, k), P(w - k, h - k)), ...line(P(w - k, k), P(k, h - k))] };
    }
    case 'wfAvatar':
      return {
        outline: ellipse(0, 0, w, h),
        details: [
          ...ellipse(w * 0.32, h * 0.2, w * 0.36, h * 0.36),
          { t: 'M', p: P(w * 0.2, h * 0.84) },
          { t: 'C', c1: P(w * 0.26, h * 0.6), c2: P(w * 0.74, h * 0.6), p: P(w * 0.8, h * 0.84) },
        ],
      };
    case 'wfSlider': {
      const lw = wf.sliderLabel(w);
      const r = Math.min(h / 2, (w - lw) / 2);
      const kx = lw + Math.min(Math.max(r, (w - lw) * 0.6), w - lw - r);
      return { outline: circle(kx, cy, r), details: [...line(P(lw, cy), P(kx - r, cy)), ...line(P(kx + r, cy), P(w, cy))] };
    }
    case 'wfModal': {
      const t = wf.modalTitle(h);
      const c = Math.min(6, t * 0.15);
      const bh = Math.min(32, h * 0.13);
      const details = [
        ...line(P(0, t), P(w, t)),
        ...line(P(w - 20 - c, t / 2 - c), P(w - 20 + c, t / 2 + c)),
        ...line(P(w - 20 + c, t / 2 - c), P(w - 20 - c, t / 2 + c)),
      ];
      if (w > 220 && h > t + bh + 24) details.push(...rr(w - 12 - 80, h - bh - 12, 80, bh, 6), ...rr(w - 12 - 168, h - bh - 12, 80, bh, 6));
      if (h > t + bh + 70) details.push(...line(P(16, t + 22), P(w * 0.8, t + 22)), ...line(P(16, t + 38), P(w * 0.6, t + 38)));
      return { outline: roundRect(w, h, Math.min(12, m * 0.06)), details };
    }
    case 'wfProgress':
      return { outline: roundRect(w, h, h / 2), details: h > 8 ? rr(3, 3, (w - 6) * 0.6, h - 6, (h - 6) / 2) : line(P(0, cy), P(w * 0.6, cy)) };
    default:
      return null;
  }
}

/** Where a wireframe kind's label goes (null: not a wireframe kind). */
function wireframeTextBox(kind: ShapeKind, w: number, h: number): Rect | null {
  const m = Math.min(w, h);
  switch (kind) {
    case 'wfBrowser': {
      const bar = wf.browserBar(h);
      return w >= 120 ? { x: 72, y: bar * 0.22, w: Math.max(1, w - 96), h: bar * 0.56 } : { x: 0, y: 0, w, h: bar };
    }
    case 'wfPhone': {
      const i = wf.phoneInset(m);
      return { x: i + 8, y: i + 22, w: Math.max(1, w - 2 * i - 16), h: Math.min(36, h * 0.1) };
    }
    case 'wfTablet':
    case 'wfDesktop': {
      const i = kind === 'wfTablet' ? wf.tabletInset(m) : wf.bezel(m);
      return { x: i + 8, y: i + 8, w: Math.max(1, w - 2 * i - 16), h: Math.min(36, h * 0.1) };
    }
    case 'wfInput':
      return { x: 6, y: 0, w: Math.max(1, w - 12), h };
    case 'wfSearch': {
      const left = Math.min(h * 0.5, 22) + Math.min(h * 0.17, 9) * 1.6 + 6;
      return { x: left, y: 0, w: Math.max(1, w - left - h * 0.4), h };
    }
    case 'wfTextArea':
      return { x: 6, y: 4, w: Math.max(1, w - 12), h: Math.max(1, h - 8) };
    case 'wfCheckbox':
    case 'wfRadio': {
      const x = Math.min(wf.mark(w, h) + 6, w - 1);
      return { x, y: 0, w: w - x, h };
    }
    case 'wfToggle': {
      const x = Math.min(wf.toggleW(w, h) + 6, w - 1);
      return { x, y: 0, w: w - x, h };
    }
    case 'wfDropdown':
      return { x: 6, y: 0, w: Math.max(1, w - 12 - Math.min(28, w * 0.2)), h };
    case 'wfTabs':
      return { x: 0, y: 0, w: w / 3, h: Math.max(1, h - 4) };
    case 'wfNavBar': {
      const d = h * 0.5;
      return { x: 18 + d, y: 0, w: Math.max(1, w * 0.4), h };
    }
    case 'wfCard': {
      const ih = wf.cardImage(h);
      return { x: 10, y: ih + 4, w: Math.max(1, w - 20), h: Math.max(1, h * 0.76 - ih - 4) };
    }
    case 'wfList':
      return { x: 10, y: 0, w: Math.max(1, w - 20), h: wf.listTitle(h) };
    case 'wfSlider':
      return { x: 0, y: 0, w: Math.max(1, wf.sliderLabel(w) - 6), h };
    case 'wfModal':
      return { x: 12, y: 0, w: Math.max(1, w - 52), h: wf.modalTitle(h) };
    case 'wfButton':
    case 'wfImage':
    case 'wfAvatar':
    case 'wfProgress':
      return { x: 0, y: 0, w, h };
    default:
      return null;
  }
}

/** Height of a lifeline's participant box. */
export const lifelineHead = (h: number) => Math.min(52, h * 0.3);

/** The name tag in a combined fragment's top-left corner ("alt", "loop"). */
export const fragmentTag = (w: number, h: number) => ({ w: Math.min(w * 0.35, 88), h: Math.min(h * 0.22, 28) });

/** Line height of an entity's text (looser than other shapes so the title divider has air). */
export const ENTITY_LINE = 1.7;
export const ENTITY_PAD = 10;
/** Text size of an entity whose size is 'auto' (entities are tables: they don't shrink text to fit). */
export const ENTITY_FONT = 14;

/** y (local) of the divider under an entity's title line, for its text size and border. */
export function entityDivider(fontSize: number | 'auto', strokeWidth: number): number {
  const fs = fontSize === 'auto' ? ENTITY_FONT : fontSize;
  return Math.round(ENTITY_PAD + strokeWidth / 2 + fs * ENTITY_LINE) + 0.5;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** SVG path data, offset by (dx, dy). */
export function toSvgPath(segs: Seg[], dx = 0, dy = 0): string {
  const pt = (p: Point) => `${fmt(p.x + dx)} ${fmt(p.y + dy)}`;
  return segs
    .map((s) => (s.t === 'Z' ? 'Z' : s.t === 'C' ? `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.p)}` : `${s.t}${pt(s.p)}`))
    .join('');
}

/**
 * Path data for drawing the shape with its stroke kept INSIDE the w×h bounds: the outline is
 * computed for a box inset by half the stroke on every side.
 */
export function insetPaths(kind: ShapeKind, w: number, h: number, strokeWidth: number): { outline: string; details: string; dashed: string } {
  const half = Math.max(0, strokeWidth) / 2;
  const g = shapeGeometry(kind, Math.max(1, w - 2 * half), Math.max(1, h - 2 * half));
  return { outline: toSvgPath(g.outline, half, half), details: toSvgPath(g.details, half, half), dashed: toSvgPath(g.dashed ?? [], half, half) };
}

const polyCache = new Map<string, Point[][]>();

/** The outline as closed polygons (curves sampled), for hit testing and anchors. Cached: hover
 *  hit-tests the same few shapes over and over. */
export function outlinePolygons(kind: ShapeKind, w: number, h: number, steps = 12): Point[][] {
  const key = `${kind}|${w}|${h}|${steps}`;
  let hit = polyCache.get(key);
  if (!hit) {
    if (polyCache.size > 300) polyCache.clear();
    hit = samplePolygons(kind, w, h, steps);
    polyCache.set(key, hit);
  }
  return hit;
}

function samplePolygons(kind: ShapeKind, w: number, h: number, steps: number): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [];
  let last = P(0, 0);
  for (const s of shapeGeometry(kind, w, h).outline) {
    if (s.t === 'M') {
      if (cur.length > 2) out.push(cur);
      cur = [s.p];
      last = s.p;
    } else if (s.t === 'L') {
      cur.push(s.p);
      last = s.p;
    } else if (s.t === 'C') {
      for (let i = 1; i <= steps; i++) cur.push(bezier(last, s.c1, s.c2, s.p, i / steps));
      last = s.p;
    }
  }
  if (cur.length > 2) out.push(cur);
  return out;
}

/** The interior detail strokes as open polylines (curves sampled), for hit testing. */
export function detailPolylines(kind: ShapeKind, w: number, h: number, steps = 8): Point[][] {
  const out: Point[][] = [];
  let cur: Point[] = [];
  let last = P(0, 0);
  const g = shapeGeometry(kind, w, h);
  for (const s of [...g.details, ...(g.dashed ?? [])]) {
    if (s.t === 'M') {
      if (cur.length > 1) out.push(cur);
      cur = [s.p];
    } else if (s.t === 'L') cur.push(s.p);
    else if (s.t === 'C') for (let i = 1; i <= steps; i++) cur.push(bezier(last, s.c1, s.c2, s.p, i / steps));
    if (s.t !== 'Z') last = s.p;
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function nearestDrawnPoint(lines: Point[][], p: Point): Point | null {
  let best: Point | null = null;
  let bestD = Infinity;
  for (const l of lines)
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1];
      const b = l[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      const q = P(a.x + t * dx, a.y + t * dy);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
  return best;
}

function distanceToPolylines(lines: Point[][], p: Point): number {
  let best = Infinity;
  for (const l of lines) for (let i = 1; i < l.length; i++) best = Math.min(best, distToSegment(p, l[i - 1], l[i]));
  return best;
}

function bezier(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  return P(
    u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  );
}

function segsBounds(segs: Seg[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let last = P(0, 0);
  const add = (p: Point) => {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  };
  for (const s of segs) {
    if (s.t === 'Z') continue;
    if (s.t === 'C') for (let i = 1; i <= 24; i++) add(bezier(last, s.c1, s.c2, s.p, i / 24));
    else add(s.p);
    last = s.p;
  }
  return { x: x0, y: y0, w: x1 - x0 || 1, h: y1 - y0 || 1 };
}

function insidePolygon(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToOutline(polys: Point[][], p: Point): number {
  let best = Infinity;
  for (const poly of polys)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, distToSegment(p, poly[j], poly[i]));
  return best;
}

/**
 * Does a local point hit the shape? Filled shapes hit anywhere inside their real outline;
 * unfilled shapes only near the outline (so you can click "through" an empty circle), plus
 * their text if they have any.
 */
export function hitShape(
  kind: ShapeKind,
  w: number,
  h: number,
  p: Point,
  opts: { filled: boolean; tolerance: number; hasText: boolean },
): boolean {
  const polys = outlinePolygons(kind, w, h);
  if (opts.filled && polys.some((poly) => insidePolygon(poly, p))) return true;
  if (distanceToOutline(polys, p) <= opts.tolerance) return true;
  // Stick figures and inner lines (an actor's limbs) are part of what you see, so they grab too.
  if (distanceToPolylines(detailPolylines(kind, w, h), p) <= opts.tolerance) return true;
  if (opts.hasText) {
    const t = textBox(kind, w, h);
    return p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;
  }
  return false;
}

/**
 * Where a ray from the box center toward `anchor` leaves the real outline (e.g. the slanted
 * side of a triangle, the top of a star), so connectors touch the drawn shape.
 */
export function anchorOnOutline(kind: ShapeKind, w: number, h: number, anchor: 'top' | 'right' | 'bottom' | 'left'): Point {
  if (kind === 'umlLifeline') {
    // The participant box's top and sides; the bottom anchor is the end of the stem.
    const hh = lifelineHead(h);
    return anchor === 'top' ? P(w / 2, 0) : anchor === 'bottom' ? P(w / 2, h) : P(anchor === 'left' ? 0 : w, hh / 2);
  }
  const dir = anchor === 'top' ? P(0, -1) : anchor === 'bottom' ? P(0, 1) : anchor === 'left' ? P(-1, 0) : P(1, 0);
  const mid = anchor === 'top' ? P(w / 2, 0) : anchor === 'bottom' ? P(w / 2, h) : anchor === 'left' ? P(0, h / 2) : P(w, h / 2);
  return rayExit(kind, w, h, P(w / 2, h / 2), dir, mid);
}

/**
 * Attach anywhere: where a line aimed from the shape's center toward `toward` (local) meets its
 * drawn outline — a spot on an ellipse's curve, on a diamond's slanted side. Scaling the shape
 * scales `toward` with it, so an end attached at 25% of a side stays at 25% after a resize.
 */
export function outlineToward(kind: ShapeKind, w: number, h: number, toward: Point): Point {
  if (kind === 'umlLifeline') {
    // Below the participant box, messages attach to the stem at their height.
    const hh = lifelineHead(h);
    if (toward.y > hh) return P(w / 2, Math.min(h, toward.y));
    const c = P(w / 2, hh / 2);
    const d = P(toward.x - c.x, toward.y - c.y);
    if (Math.hypot(d.x, d.y) < 1e-9) return P(w / 2, 0);
    return rayExit('rect', w, hh, c, d, toward);
  }
  const c = P(w / 2, h / 2);
  const d = P(toward.x - c.x, toward.y - c.y);
  if (Math.hypot(d.x, d.y) < 1e-9) return anchorOnOutline(kind, w, h, 'top');
  return rayExit(kind, w, h, c, d, boxExit(w, h, c, d));
}

/** Where the ray c + t·d leaves the w×h box. */
function boxExit(w: number, h: number, c: Point, d: Point): Point {
  const tx = d.x > 0 ? (w - c.x) / d.x : d.x < 0 ? -c.x / d.x : Infinity;
  const ty = d.y > 0 ? (h - c.y) / d.y : d.y < 0 ? -c.y / d.y : Infinity;
  const t = Math.min(tx, ty);
  return P(c.x + d.x * t, c.y + d.y * t);
}

/**
 * First crossing of the ray o + t·d with the outline. When the ray leaves through a gap (an
 * hourglass waist, a stick figure), the drawn point nearest `fallback` instead of floating at the
 * bounding box.
 */
function rayExit(kind: ShapeKind, w: number, h: number, o: Point, d: Point, fallback: Point): Point {
  let best = Infinity;
  for (const poly of outlinePolygons(kind, w, h, 24)) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const t = raySegment(o, d, poly[j], poly[i]);
      if (t !== null && t > 1e-6) best = Math.min(best, t);
    }
  }
  if (!Number.isFinite(best))
    return nearestDrawnPoint([...outlinePolygons(kind, w, h, 24).map((p) => [...p, p[0]]), ...detailPolylines(kind, w, h)], fallback) ?? fallback;
  return P(o.x + d.x * best, o.y + d.y * best);
}

/** Distance t along the ray (o + t·d) to segment ab, or null. */
function raySegment(o: Point, d: Point, a: Point, b: Point): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
  const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
  return u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

/** Area (local coords) where the shape's text lives, so it stays inside the visible outline. */
export function textBox(kind: ShapeKind, w: number, h: number): Rect {
  const r = (x: number, y: number, rw: number, rh: number): Rect => ({ x: x * w, y: y * h, w: rw * w, h: rh * h });
  switch (kind) {
    case 'ellipse':
      return r(0.146, 0.146, 0.708, 0.708);
    case 'triangle':
      return r(0.25, 0.45, 0.5, 0.52);
    case 'diamond':
      return r(0.25, 0.25, 0.5, 0.5);
    case 'parallelogram':
    case 'trapezoid': {
      const s = Math.min(w * 0.25, h * 0.6);
      return { x: s * 0.75, y: 0, w: w - s * 1.5, h };
    }
    case 'pentagon':
      return r(0.18, 0.25, 0.64, 0.68);
    case 'hexagon': {
      const s = Math.min(w * 0.25, h * 0.5);
      return { x: s * 0.6, y: 0, w: w - s * 1.2, h };
    }
    case 'octagon':
      return r(0.08, 0.08, 0.84, 0.84);
    case 'star':
      return r(0.3, 0.36, 0.4, 0.42);
    case 'cross':
      return r(0.22, 0.3, 0.56, 0.4);
    case 'arrowRight':
    case 'arrowLeft': {
      const hl = Math.min(w * 0.5, h * 0.6);
      const tw = w - hl * 0.45;
      return { x: kind === 'arrowRight' ? 0 : w - tw, y: h * 0.25, w: tw, h: h * 0.5 };
    }
    case 'chevron': {
      const d = Math.min(w * 0.4, h * 0.5);
      return { x: d, y: 0, w: Math.max(1, w - 2 * d + d * 0.5), h };
    }
    case 'speech':
    case 'callout':
      return r(0, 0, 1, 0.8);
    case 'cloud':
      return r(0.16, 0.2, 0.68, 0.62);
    case 'cylinder': {
      const e = Math.min(h * 0.14, w * 0.3);
      return { x: 0, y: 2 * e, w, h: Math.max(1, h - 3 * e) };
    }
    case 'document':
      return r(0, 0, 1, 0.86);
    case 'predefinedProcess': {
      const b = Math.min(w * 0.12, 24);
      return { x: b, y: 0, w: w - 2 * b, h };
    }
    case 'terminator':
      return { x: Math.min(w, h) * 0.25, y: 0, w: Math.max(1, w - Math.min(w, h) * 0.5), h };
    case 'manualInput':
      return r(0, 0.24, 1, 0.76);
    case 'manualOperation': {
      const s = Math.min(w * 0.2, h * 0.6);
      return { x: s * 0.75, y: 0, w: w - s * 1.5, h };
    }
    case 'delay':
      return r(0, 0, 0.88, 1);
    case 'display':
      return r(0.14, 0, 0.74, 1);
    case 'offPageRef':
      return r(0, 0, 1, 0.66);
    case 'merge':
      return r(0.25, 0.04, 0.5, 0.46);
    case 'internalStorage': {
      const b = Math.min(Math.min(w, h) * 0.16, 24);
      return { x: b, y: b, w: w - b, h: h - b };
    }
    case 'multiDocument': {
      const d = Math.min(w, h) * 0.08;
      return { x: 0, y: 2 * d, w: w - 2 * d, h: (h - 2 * d) * 0.86 };
    }
    case 'punchedTape':
      return r(0, 0.16, 1, 0.68);
    case 'sort':
    case 'bpmnGatewayX':
    case 'bpmnGatewayPlus':
    case 'bpmnGatewayO':
      return r(0.25, 0.25, 0.5, 0.5);
    case 'storedData':
      return r(0.12, 0, 0.74, 1);
    case 'summingJunction':
    case 'orJunction':
    case 'bpmnIntermediate':
    case 'bpmnEnd':
      return r(0.18, 0.18, 0.64, 0.64);
    case 'umlClass':
      return { x: 0, y: 0, w, h: Math.min(h * 0.3, 40) };
    case 'umlActor':
      return r(0, 0.82, 1, 0.18);
    case 'umlPackage': {
      const t = Math.min(h * 0.18, 24);
      return { x: 0, y: t, w, h: h - t };
    }
    case 'umlNote': {
      const c = Math.min(Math.min(w, h) * 0.22, 28);
      return { x: 0, y: c * 0.5, w: w - c * 0.5, h: h - c * 0.5 };
    }
    case 'umlComponent': {
      const t = Math.min(w * 0.08, 14);
      return { x: 2 * t, y: 0, w: w - 2 * t, h };
    }
    case 'umlNode': {
      const d = Math.min(w, h) * 0.15;
      return { x: 0, y: d, w: w - d, h: h - d };
    }
    case 'bpmnSubprocess':
      return r(0, 0, 1, 0.74);
    case 'bpmnMessageEvent':
    case 'bpmnTimerEvent':
    case 'bpmnErrorEvent':
      return r(0.18, 0.18, 0.64, 0.64);
    case 'umlLifeline':
      return { x: 0, y: 0, w, h: lifelineHead(h) };
    case 'umlFragment':
      return { x: 0, y: 0, ...fragmentTag(w, h) };
    case 'netServer':
    case 'netFirewall':
      return r(0, 0, 0.7, 1);
    case 'netRouter':
      return r(0.15, 0.15, 0.7, 0.7);
    case 'netMonitor':
      return r(0.06, 0.06, 0.88, 0.64);
    case 'netLaptop':
      return r(0.15, 0.05, 0.7, 0.7);
    case 'netPhone':
      return r(0.1, 0.12, 0.8, 0.7);
    case 'netUser':
      return r(0.1, 0.66, 0.8, 0.32);
    default:
      return wireframeTextBox(kind, w, h) ?? { x: 0, y: 0, w, h };
  }
}

/**
 * Box from a drag (start → current). Shift locks a square; with alt-less dragging the start
 * corner stays fixed whichever way you drag.
 */
export function dragRect(start: Point, cur: Point, square: boolean): Rect {
  let dx = cur.x - start.x;
  let dy = cur.y - start.y;
  if (square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * s;
    dy = Math.sign(dy || 1) * s;
  }
  return {
    x: Math.min(start.x, start.x + dx),
    y: Math.min(start.y, start.y + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}
