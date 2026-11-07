// Fingers and pens on the canvas (KAI-139). The canvas (canvas/Canvas.tsx) asks `routePress` what a
// new press is for, so the rules live in one place:
// - palm rejection: while a pen touches the screen, fingers do nothing (no pan, select or draw);
// - "pen draws, finger pans": once a pen has been used on this board, one finger always pans;
// - with the select tool, a finger on empty canvas pans (a tap still deselects, a long press
//   opens the menu); on an item or a handle it selects / drags as a mouse would;
// - except in the phone layout's view mode (not "Edit board"): there a finger on an item pans too,
//   so a pan or pinch that starts on a big item (a kanban) never selects it; only a tap (lifted
//   within TOUCH_SLOP_PX, no second finger meanwhile) reaches the select tool, as a click there;
// - other tools take a finger like a mouse press (tap a sticky into place, draw with a finger).
// Two fingers pinch-zoom and pan (handled by the canvas).

/** How long (ms) a still finger must stay down to open the context menu. */
export const LONG_PRESS_MS = 500;
/** How far (screen px) a finger may wander and still count as a tap or a long press. */
export const TOUCH_SLOP_PX = 10;
/** How far (screen px) off an item a finger still hits it. */
export const TOUCH_HIT_PX = 14;

/**
 * - 'ignore': nothing at all (a palm);
 * - 'pan': the finger pans (a tap on empty canvas deselects);
 * - 'pan-or-tap': the finger pans, and if it lifts as a tap the tool gets the press and release;
 * - 'tool': the tool gets the press as a mouse button's.
 */
export type PressRoute = 'ignore' | 'pan' | 'pan-or-tap' | 'tool';

export interface PressInput {
  pointerType: string;
  /** Pens currently touching the screen. */
  pensDown: number;
  /** A pen has been used on this board in this session. */
  penSeen: boolean;
  toolId: string;
  /** The press lands on an item or one of the selection's handles. */
  onItem: boolean;
  /** The phone layout's view mode: a phone-sized window, not editing the board (UiState.phoneEditing). */
  phoneView: boolean;
}

export function routePress(p: PressInput): PressRoute {
  if (p.pointerType !== 'touch') return 'tool';
  if (p.pensDown > 0) return 'ignore';
  if (p.penSeen) return 'pan';
  if (p.toolId === 'select' && !p.onItem) return 'pan';
  if (p.toolId === 'select' && p.phoneView) return 'pan-or-tap';
  return 'tool';
}
