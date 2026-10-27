import { describe, expect, it } from 'vitest';
import { computePosition } from './position';

const viewport = { width: 1000, height: 800 };
const anchor = { x: 400, y: 300, width: 100, height: 40 };
const floating = { width: 200, height: 100 };

describe('computePosition', () => {
  it('does not overlap the anchor: leaves the gap below it and centres on it', () => {
    expect(computePosition({ anchor, floating, viewport })).toEqual({ x: 350, y: 348, side: 'bottom', align: 'center' });
  });

  it('lines up start/end edges with the anchor instead of centring', () => {
    expect(computePosition({ anchor, floating, viewport, align: 'start' }).x).toBe(400);
    expect(computePosition({ anchor, floating, viewport, align: 'end' }).x).toBe(300);
  });

  it('puts left/right popovers beside the anchor, not on top of it', () => {
    expect(computePosition({ anchor, floating, viewport, side: 'right', offset: 10 })).toMatchObject({ x: 510, y: 270 });
    expect(computePosition({ anchor, floating, viewport, side: 'left', offset: 10 }).x).toBe(190);
  });

  it('flips to the opposite side instead of running off the bottom/right edge', () => {
    const low = computePosition({ anchor: { ...anchor, y: 740 }, floating, viewport });
    expect(low.side).toBe('top');
    expect(low.y).toBe(740 - 8 - 100);
    expect(computePosition({ anchor: { ...anchor, x: 900 }, floating, viewport, side: 'right' }).side).toBe('left');
  });

  it('does not flip to a side with even less room, and clamps into the viewport', () => {
    const tall = { width: 200, height: 500 };
    const r = computePosition({ anchor: { ...anchor, y: 350 }, floating: tall, viewport });
    expect(r.side).toBe('bottom');
    expect(r.y).toBe(800 - 8 - 500);
  });

  it('never lets a popover hang off the left or right edge', () => {
    expect(computePosition({ anchor: { ...anchor, x: 0 }, floating, viewport }).x).toBe(8);
    expect(computePosition({ anchor: { ...anchor, x: 980 }, floating, viewport }).x).toBe(1000 - 8 - 200);
  });

  it('keeps an over-wide popover pinned to the left padding rather than a negative x', () => {
    expect(computePosition({ anchor, floating: { width: 2000, height: 100 }, viewport }).x).toBe(8);
  });
});
