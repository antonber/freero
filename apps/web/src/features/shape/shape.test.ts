import { describe, expect, it } from 'vitest';
import type { ShapeKind } from '@freero/shared';
import { anchorOnOutline, detailPolylines, distanceToOutline, dragRect, hitShape, outlinePolygons } from './lib/geometry';
import { LIBRARY_KINDS } from './lib/library';

const W = 200;
const H = 120;
const ANCHORS = ['top', 'right', 'bottom', 'left'] as const;

describe('shape outlines', () => {
  it('every library shape fills its box exactly, so the selection frame, handles and drawing agree', () => {
    for (const kind of LIBRARY_KINDS) {
      const pts = [...outlinePolygons(kind, W, H), ...detailPolylines(kind, W, H)].flat();
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      // Never pokes outside its box (strokes would be clipped, anchors off)...
      expect(Math.min(...xs), kind).toBeGreaterThanOrEqual(-0.5);
      expect(Math.min(...ys), kind).toBeGreaterThanOrEqual(-0.5);
      expect(Math.max(...xs), kind).toBeLessThanOrEqual(W + 0.5);
      expect(Math.max(...ys), kind).toBeLessThanOrEqual(H + 0.5);
      // ...and actually reaches every side (no shape drawn shrunken inside its handles).
      expect(Math.min(...xs), kind).toBeLessThan(1.5);
      expect(Math.min(...ys), kind).toBeLessThan(1.5);
      expect(Math.max(...xs), kind).toBeGreaterThan(W - 1.5);
      expect(Math.max(...ys), kind).toBeGreaterThan(H - 1.5);
    }
  });
});

describe('boards from a newer version', () => {
  it('a shape kind this version does not know draws as its box, not nothing', () => {
    const polys = outlinePolygons('someFutureKind' as ShapeKind, W, H);
    expect(polys).toEqual([[{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]]);
  });
});

describe('connector anchors', () => {
  it('sit on the drawn outline for every shape and side', () => {
    for (const kind of LIBRARY_KINDS)
      for (const a of ANCHORS) {
        const p = anchorOnOutline(kind, W, H, a);
        const drawn = [...outlinePolygons(kind, W, H), ...detailPolylines(kind, W, H)];
        expect(distanceToOutline(drawn, p), `${kind} ${a}`).toBeLessThan(0.75);
      }
  });

  it('touch the slanted side of a triangle rather than floating at the bounding box edge', () => {
    const left = anchorOnOutline('triangle', W, H, 'left');
    expect(left.y).toBeCloseTo(H / 2);
    expect(left.x).toBeCloseTo(W / 4);
  });
});

describe('hit testing', () => {
  const opts = { tolerance: 6, hasText: false };

  it('clicks in the empty middle of an unfilled circle fall through to what is beneath', () => {
    expect(hitShape('ellipse', W, H, { x: W / 2, y: H / 2 }, { ...opts, filled: false })).toBe(false);
    expect(hitShape('ellipse', W, H, { x: W / 2, y: 2 }, { ...opts, filled: false })).toBe(true);
  });

  it('an unfilled shape with text is still grabbable by its text', () => {
    expect(hitShape('ellipse', W, H, { x: W / 2, y: H / 2 }, { ...opts, filled: false, hasText: true })).toBe(true);
  });

  it('a UML actor is grabbable by its limbs, not just its head, but not in the gaps between them', () => {
    const leg = { x: W * 0.25, y: H * 0.56 + (H - H * 0.56) * 0.5 }; // halfway down the left leg
    expect(hitShape('umlActor', W, H, leg, { ...opts, filled: true })).toBe(true);
    expect(hitShape('umlActor', W, H, { x: W / 2, y: H * 0.9 }, { ...opts, filled: true })).toBe(false);
  });

  it('the bounding-box corners outside a filled diamond do not count as hits', () => {
    expect(hitShape('diamond', W, H, { x: 12, y: 12 }, { ...opts, filled: true })).toBe(false);
    expect(hitShape('diamond', W, H, { x: W / 2, y: H / 2 }, { ...opts, filled: true })).toBe(true);
  });
});

describe('drag to create', () => {
  it('dragging up-left from the press point creates the shape there with a positive size', () => {
    expect(dragRect({ x: 100, y: 100 }, { x: 40, y: 70 }, false)).toEqual({ x: 40, y: 70, w: 60, h: 30 });
  });

  it('Shift makes it 1:1 in the direction you drag', () => {
    expect(dragRect({ x: 100, y: 100 }, { x: 40, y: 130 }, true)).toEqual({ x: 40, y: 100, w: 60, h: 60 });
  });
});
