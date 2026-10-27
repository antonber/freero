import { describe, expect, it } from 'vitest';
import type { Rect } from '@engine';
import { reactionSlot } from './lib/reactions';

describe('react with stamp', () => {
  it('reacting several times to the same item lines the stamps up instead of stacking them', () => {
    const sticky = { x: 0, y: 0, w: 200, h: 200 };
    const taken: Rect[] = [];
    const a = reactionSlot(sticky, 48, taken);
    const b = reactionSlot(sticky, 48, taken);
    const c = reactionSlot(sticky, 48, taken);
    // First one sits on the top-right corner.
    expect(a.x).toBeLessThan(200);
    expect(a.x + 48).toBeGreaterThan(200);
    expect(a.y).toBeLessThan(0);
    for (const [p, q] of [[a, b], [b, c], [a, c]]) expect(Math.abs(p.x - q.x)).toBeGreaterThanOrEqual(48 * 0.75);
  });
});
