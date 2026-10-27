import { describe, expect, it } from 'vitest';
import { placeholderFor } from './placeholder';

describe('placeholderFor', () => {
  it('gives a board the same placeholder on every render (no flicker between loads)', () => {
    expect(placeholderFor('board-123')).toEqual(placeholderFor('board-123'));
  });

  it('gives different boards different placeholders', () => {
    const specs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => JSON.stringify(placeholderFor(id)));
    expect(new Set(specs).size).toBe(specs.length);
  });

  it('never draws shapes outside the 320x200 thumbnail', () => {
    for (let i = 0; i < 200; i++) {
      const spec = placeholderFor(`id-${i}`);
      expect(spec.shapes.length).toBeGreaterThan(1);
      for (const s of spec.shapes) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(320);
        expect(s.y + s.h).toBeLessThanOrEqual(200);
      }
    }
  });
});
