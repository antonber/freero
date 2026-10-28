// Fingers and pens on the canvas (KAI-139). The canvas (canvas/Canvas.tsx) asks `routePress` what a
// new press is for, so the rules live in one place:
// - palm rejection: while a pen touches the screen, fingers do nothing (no pan, select or draw);
// - "pen draws, finger pans": once a pen has been used on this board, one finger always pans;
// - with the select tool, a finger on empty canvas pans (a tap still deselects, a long press
//   opens the menu); on an item or a handle it selects / drags as a mouse would;
// - other tools take a finger like a mouse press (tap a sticky into place, draw with a finger).
// Two fingers pinch-zoom and pan (handled by the canvas).

/** How long (ms) a still finger must stay down to open the context menu. */
export const LONG_PRESS_MS = 500;
/** How far (screen px) a finger may wander and still count as a tap or a long press. */
export const TOUCH_SLOP_PX = 10;
/** How far (screen px) off an item a finger still hits it. */
export const TOUCH_HIT_PX = 14;

export type PressRoute = 'ignore' | 'pan' | 'tool';

export interface PressInput {
  pointerType: string;
  /** Pens currently touching the screen. */
  pensDown: number;
  /** A pen has been used on this board in this session. */
  penSeen: boolean;
  toolId: string;
  /** The press lands on an item or one of the selection's handles. */
  onItem: boolean;
}

export function routePress(p: PressInput): PressRoute {
  if (p.pointerType !== 'touch') return 'tool';
  if (p.pensDown > 0) return 'ignore';
  if (p.penSeen) return 'pan';
  if (p.toolId === 'select' && !p.onItem) return 'pan';
  return 'tool';
}
