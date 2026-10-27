// Sticky tag chips scale with the sticky (world units): 1 at the default 200 px sticky.
export const chipScale = (w: number, h: number) => Math.min(2.5, Math.max(0.5, Math.min(w, h) / 200));
