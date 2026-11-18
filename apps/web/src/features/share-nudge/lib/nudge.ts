// When the share nudge speaks (pure, so the rule reads in one place): on a board only its owner can
// open — no link, no team, nobody else on it right now — once they have put NUDGE_AFTER items of
// their own on it AND worked on it for a while this visit (a template drops ten items at once: that
// is not a board coming along yet), and only the first time on that board in this browser.

/** Items of their own on the board before the nudge. */
export const NUDGE_AFTER = 10;
/** Time on the board this visit before the nudge. */
export const NUDGE_AFTER_MS = 3 * 60_000;

export interface NudgeState {
  isOwner: boolean;
  signedIn: boolean;
  /** Host.board.shared: undefined where it isn't known (embeds, the sandbox). */
  shared: boolean | undefined;
  othersHere: boolean;
  mine: number;
  /** On the board for NUDGE_AFTER_MS this visit. */
  settled: boolean;
  alreadyShown: boolean;
}

export const shouldNudge = (s: NudgeState): boolean =>
  s.isOwner && s.signedIn && s.shared === false && !s.othersHere && !s.alreadyShown && s.settled && s.mine >= NUDGE_AFTER;

const key = (boardId: string) => `fr.share-nudge.${boardId}`;

/** Whether this browser showed the nudge on this board (storage that fails reads as "shown": stay quiet). */
export function nudgeShown(boardId: string): boolean {
  try {
    return localStorage.getItem(key(boardId)) !== null;
  } catch {
    return true;
  }
}

export function markNudgeShown(boardId: string): void {
  try {
    localStorage.setItem(key(boardId), String(Date.now()));
  } catch {
    // Private mode: it may show again on this board, which is harmless.
  }
}
