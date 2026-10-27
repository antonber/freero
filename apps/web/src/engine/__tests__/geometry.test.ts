import { describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import { elementAABB, elementIntersectsRect, localToWorld } from '../geometry/geometry';
import { cull, hitTestElements } from '../geometry/spatial';
import { snapMove } from '../geometry/snap';
import { resizeBox } from '../geometry/transform';
import { fitRect, screenToWorld, zoomAt } from '../camera/camera';

const el = (id: string, x: number, y: number, w: number, h: number, rotation = 0) =>
  ({ id, type: 'sticky', x, y, w, h, rotation, z: 0 }) as BoardElement;
const noDef = () => undefined;

describe('rotation-aware bounds and hit-testing', () => {
  it('a 45° square grows its bounds to the diagonal (selection/culling must not clip corners)', () => {
    const b = elementAABB(el('a', 0, 0, 100, 100, 45));
    expect(b.w).toBeCloseTo(Math.SQRT2 * 100, 6);
    expect(b.x).toBeCloseTo(50 - (Math.SQRT2 * 100) / 2, 6);
  });

  it('clicking the empty corner of a rotated element bounding box misses it', () => {
    const diamond = el('a', 0, 0, 100, 100, 45);
    expect(hitTestElements([diamond], { x: -15, y: -15 }, noDef)).toBeNull();
    expect(hitTestElements([diamond], { x: 50, y: 0 }, noDef)?.id).toBe('a');
  });

  it('hit-testing returns the topmost element in render order', () => {
    const below = el('below', 0, 0, 100, 100);
    const above = el('above', 50, 50, 100, 100);
    expect(hitTestElements([below, above], { x: 75, y: 75 }, noDef)?.id).toBe('above');
  });

  it('marquee intersection uses the rotated shape, not its bounding box', () => {
    const diamond = el('a', 0, 0, 100, 100, 45);
    expect(elementIntersectsRect(diamond, { x: -30, y: -30, w: 12, h: 12 })).toBe(false);
    expect(elementIntersectsRect(diamond, { x: 45, y: -30, w: 10, h: 32 })).toBe(true);
  });
});

describe('viewport culling', () => {
  it('keeps elements that are only partly visible and drops ones fully outside', () => {
    const view = { x: 0, y: 0, w: 1000, h: 800 };
    const partly = el('partly', -90, 100, 100, 100); // 10px inside the left edge
    const rotatedIn = el('rotated', -110, 100, 100, 100, 45); // only its rotated corner pokes in
    const outside = el('outside', -300, 100, 100, 100);
    expect(cull([partly, rotatedIn, outside], view).map((e) => e.id)).toEqual(['partly', 'rotated']);
  });
});

describe('snapping', () => {
  const others = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 103, y: 500, w: 100, h: 100 },
  ];

  it('picks the nearest guide within the threshold, not the first one found', () => {
    // left edge at 105: 5px from x=100 (right edge of #1), 2px from x=103 (left edge of #2)
    const r = snapMove({ x: 105, y: 250, w: 50, h: 50 }, others, 6);
    expect(r.dx).toBe(-2);
    expect(r.guides.some((g) => g.axis === 'x' && g.pos === 103)).toBe(true);
  });

  it('does not snap beyond the threshold', () => {
    expect(snapMove({ x: 220, y: 250, w: 50, h: 50 }, others, 6)).toMatchObject({ dx: 0, dy: 0, guides: [] });
  });

  it('snaps centers to centers', () => {
    expect(snapMove({ x: 27, y: 250, w: 50, h: 50 }, others, 6).dx).toBe(-2); // center 52 → 50
  });
});

describe('resizing', () => {
  it('resizing a rotated element keeps the opposite corner fixed in world space', () => {
    const start = { x: 0, y: 0, w: 100, h: 50, rotation: 30 };
    const before = localToWorld(start, { x: 0, y: 0 });
    const { box } = resizeBox(start, 'se', { x: 160, y: 140 }, { x: 0, y: 0 }, { keepAspect: false, minW: 1, minH: 1 });
    const after = localToWorld(box, { x: 0, y: 0 });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(box.w).toBeGreaterThan(100);
  });

  it('never shrinks below the minimum size even when dragged past the anchor', () => {
    const { box } = resizeBox(
      { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      'se',
      { x: -500, y: -500 },
      { x: 0, y: 0 },
      { keepAspect: false, minW: 40, minH: 30 },
    );
    expect(box).toMatchObject({ x: 0, y: 0, w: 40, h: 30 });
  });
});

describe('camera', () => {
  it('zooming keeps the world point under the cursor fixed', () => {
    const cam = { x: 100, y: 50, zoom: 1 };
    const cursor = { x: 400, y: 300 };
    const before = screenToWorld(cam, cursor);
    const after = screenToWorld(zoomAt(cam, 2.5, cursor), cursor);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('zoom is clamped to 2%–400%', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 50, { x: 0, y: 0 }).zoom).toBe(4);
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0.0001, { x: 0, y: 0 }).zoom).toBe(0.02);
  });

  it('fit puts the whole rect inside the padded viewport, centered', () => {
    const cam = fitRect({ x: 1000, y: 1000, w: 4000, h: 1000 }, { width: 1000, height: 800 }, 50, 1);
    const tl = { x: (1000 - cam.x) * cam.zoom, y: (1000 - cam.y) * cam.zoom };
    const br = { x: (5000 - cam.x) * cam.zoom, y: (2000 - cam.y) * cam.zoom };
    expect(tl.x).toBeGreaterThanOrEqual(49.9);
    expect(br.x).toBeLessThanOrEqual(950.1);
    expect((tl.y + br.y) / 2).toBeCloseTo(400, 6);
  });
});
