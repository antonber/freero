// Dark mode changes how the live canvas is painted, never what people authored (canvas/theme.ts).
import { describe, expect, it } from 'vitest';
import { canvasInk, isLightSurface, shownBackground } from '../canvas/theme';

describe('dark canvas', () => {
  it('repaints only the default inks (through a variable that exports leave unset), never a colour someone picked', () => {
    expect(canvasInk('#17162B')).toBe('var(--fr-canvas-ink, #17162B)');
    for (const picked of ['#E5484D', '#FFF3A3', '#FFFFFF', '#5B3FF0']) expect(canvasInk(picked)).toBe(picked);
  });

  it('turns a light board background dark, keeps one the author made dark, and leaves light mode alone', () => {
    const light = shownBackground('#F3F2F8', 'dark');
    expect(isLightSurface(light)).toBe(false);
    expect(shownBackground('#17162B', 'dark')).toBe('#17162B');
    expect(shownBackground('#F3F2F8', 'light')).toBe('#F3F2F8');
  });
});
