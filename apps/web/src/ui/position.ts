// Pure positioning math for floating layers (popovers, menus, tooltips).
// Places a floating box next to an anchor and keeps it inside the viewport:
// flips to the opposite side when the preferred side lacks room, then clamps.

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';

export interface Box { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

export interface PositionInput {
  anchor: Box;
  floating: Size;
  viewport: Size;
  side?: Side;
  align?: Align;
  /** Gap between anchor and floating box. */
  offset?: number;
  /** Minimum distance from the viewport edges. */
  padding?: number;
}

export interface PositionResult { x: number; y: number; side: Side; align: Align }

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function place(a: Box, f: Size, side: Side, align: Align, offset: number): { x: number; y: number } {
  if (side === 'top' || side === 'bottom') {
    const y = side === 'top' ? a.y - offset - f.height : a.y + a.height + offset;
    const x =
      align === 'start' ? a.x : align === 'end' ? a.x + a.width - f.width : a.x + a.width / 2 - f.width / 2;
    return { x, y };
  }
  const x = side === 'left' ? a.x - offset - f.width : a.x + a.width + offset;
  const y =
    align === 'start' ? a.y : align === 'end' ? a.y + a.height - f.height : a.y + a.height / 2 - f.height / 2;
  return { x, y };
}

/** Free space on a given side of the anchor (excluding the gap and padding). */
function space(a: Box, v: Size, side: Side, offset: number, padding: number): number {
  switch (side) {
    case 'top': return a.y - offset - padding;
    case 'bottom': return v.height - (a.y + a.height) - offset - padding;
    case 'left': return a.x - offset - padding;
    case 'right': return v.width - (a.x + a.width) - offset - padding;
  }
}

const clamp = (n: number, min: number, max: number) => (max < min ? min : Math.min(Math.max(n, min), max));

export function computePosition({
  anchor,
  floating,
  viewport,
  side = 'bottom',
  align = 'center',
  offset = 8,
  padding = 8,
}: PositionInput): PositionResult {
  const need = side === 'top' || side === 'bottom' ? floating.height : floating.width;
  let finalSide = side;
  if (space(anchor, viewport, side, offset, padding) < need) {
    const opp = OPPOSITE[side];
    const oppSpace = space(anchor, viewport, opp, offset, padding);
    if (oppSpace >= need || oppSpace > space(anchor, viewport, side, offset, padding)) finalSide = opp;
  }
  const p = place(anchor, floating, finalSide, align, offset);
  return {
    x: clamp(p.x, padding, viewport.width - padding - floating.width),
    y: clamp(p.y, padding, viewport.height - padding - floating.height),
    side: finalSide,
    align,
  };
}

/** Normalizes an HTMLElement / DOMRect anchor to a viewport box. */
export function anchorBox(anchor: HTMLElement | DOMRect | Box | null | undefined): Box | null {
  if (!anchor) return null;
  if (typeof HTMLElement !== 'undefined' && anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  const b = anchor as Box;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}
