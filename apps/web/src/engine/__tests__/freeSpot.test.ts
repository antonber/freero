import { afterEach, describe, expect, it } from 'vitest';
import type { Rect } from '../api';
import type { EngineCore } from '../runtime/core';
import { elementAABB } from '../geometry/geometry';
import { makeCore } from './harness';

let core: EngineCore;
afterEach(() => core?.destroy());

const sticky = (x: number, y: number, w = 100, h = 100, rotation = 0) =>
  core.editor.create({ type: 'sticky', x, y, w, h, rotation } as never);
const gapBetween = (a: Rect, b: Rect) =>
  Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));

describe('finding a free spot for inserted content', () => {
  it('never covers or crowds an existing item, rotated ones included, whatever the size inserted', () => {
    core = makeCore();
    sticky(-60, -60, 120, 120); // right under the view center
    sticky(150, -400, 300, 900, 30);
    sticky(-900, 200, 1500, 80);
    for (const size of [{ w: 50, h: 50 }, { w: 640, h: 360 }, { w: 2400, h: 1600 }]) {
      const at = core.editor.findFreeSpot(size, { near: { x: 0, y: 0 }, gap: 40 });
      const box = { ...at, ...size };
      for (const el of core.editor.getElements()) expect(gapBetween(box, elementAABB(el)), `${size.w}x${size.h}`).toBeGreaterThanOrEqual(40);
    }
  });

  it('centres on the view when there is room, else stays in view next to what blocks it (never past all content)', () => {
    core = makeCore();
    const center = core.editor.getViewportCenter();
    const size = { w: 200, h: 100 };
    expect(core.editor.findFreeSpot(size)).toEqual({ x: center.x - 100, y: center.y - 50 });

    sticky(center.x - 50, center.y - 50); // blocks the center
    sticky(5000, 0, 400, 400); // far-away content must not pull the insert over there
    sticky(center.x - 50, center.y - 400); // and the slot right above it, at the view's top edge
    const at = core.editor.findFreeSpot(size);
    expect(Math.hypot(at.x + 100 - center.x, at.y + 50 - center.y)).toBeLessThan(400);
    const vp = core.editor.getViewportSize();
    const tl = core.editor.worldToScreen(at);
    expect(tl.x >= 0 && tl.y >= 0 && tl.x + 200 <= vp.width && tl.y + 100 <= vp.height, 'fully in view').toBe(true);
  });
});
