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
      return { outline: poly([P(0, 0), P(w, 0), P(w, h), P(0, h)]), details: none };
  }
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
export function insetPaths(kind: ShapeKind, w: number, h: number, strokeWidth: number): { outline: string; details: string } {
  const half = Math.max(0, strokeWidth) / 2;
  const g = shapeGeometry(kind, Math.max(1, w - 2 * half), Math.max(1, h - 2 * half));
  return { outline: toSvgPath(g.outline, half, half), details: toSvgPath(g.details, half, half) };
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
  for (const s of shapeGeometry(kind, w, h).details) {
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
  const c = P(w / 2, h / 2);
  const dir = anchor === 'top' ? P(0, -1) : anchor === 'bottom' ? P(0, 1) : anchor === 'left' ? P(-1, 0) : P(1, 0);
  let best = Infinity;
  for (const poly of outlinePolygons(kind, w, h, 24)) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const t = raySegment(c, dir, poly[j], poly[i]);
      if (t !== null && t > 1e-6) best = Math.min(best, t);
    }
  }
  if (!Number.isFinite(best)) {
    // The ray leaves through a gap (an hourglass waist, a stick figure): attach to the drawn
    // point nearest that side's midpoint instead of floating at the bounding box.
    const mid = anchor === 'top' ? P(w / 2, 0) : anchor === 'bottom' ? P(w / 2, h) : anchor === 'left' ? P(0, h / 2) : P(w, h / 2);
    return nearestDrawnPoint([...outlinePolygons(kind, w, h, 24).map((p) => [...p, p[0]]), ...detailPolylines(kind, w, h)], mid) ?? mid;
  }
  return P(c.x + dir.x * best, c.y + dir.y * best);
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
      return { x: 0, y: 0, w, h };
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
