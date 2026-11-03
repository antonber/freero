// Presentation session: local state (per board), camera moves and presence publishing.
import { createStore, useStore, type StoreApi } from 'zustand';
import type { FrameElement } from '@freero/shared';
import type { Editor, Point, Rect } from '@engine';
import { pointLaser, stopLaser } from './laser';
import { currentPosition, slides, type PresentExt } from './model';

export interface PresentState {
  presenting: boolean;
  /** Current slide (frame id), null when presenting a board without frames. */
  frameId: string | null;
  /** Last known position, used when the current frame is deleted mid-presentation. */
  position: number;
  /** Presentations (`clientId:startedAt`) whose banner this user dismissed. */
  dismissed: string[];
  /** Presenting with the laser pointer on (L). */
  laser: boolean;
  /** Presenting with my notes pane open (N). */
  notesOpen: boolean;
  /** [#146] My notes in a window of their own (second screen). */
  notesWindow: boolean;
  /** [#146] When I last started presenting, on the server's clock (older server sessions are stale). */
  since: number;
}

const stores = new Map<string, StoreApi<PresentState>>();

export function presentStore(editor: Editor): StoreApi<PresentState> {
  let s = stores.get(editor.boardId);
  if (!s) {
    s = createStore<PresentState>(() => ({ presenting: false, frameId: null, position: 0, dismissed: [], laser: false, notesOpen: true, notesWindow: false, since: 0 }));
    stores.set(editor.boardId, s);
  }
  return s;
}

export function usePresent<T>(editor: Editor, selector: (s: PresentState) => T): T {
  return useStore(presentStore(editor), selector);
}

// ---- presence (ext.present of this client)
const published = new Map<string, PresentExt>();
export function publish(editor: Editor, patch: PresentExt) {
  const next = { ...(published.get(editor.boardId) ?? {}), ...patch };
  published.set(editor.boardId, next);
  editor.setPresenceExt(next);
}

/** Room for the bottom control bar when fitting a slide. */
const FIT_PADDING = 40;
const BAR_SPACE = 72;

/** Camera for a slide: fit the frame, leaving the bottom bar clear. */
export function fitSlide(editor: Editor, rect: Rect, animate: boolean) {
  // zoomToRect pads evenly; grow the rect downward so the frame sits above the bar.
  const vp = editor.getViewportSize();
  const usable = Math.max(1, vp.height - BAR_SPACE - FIT_PADDING * 2);
  const zoom = Math.min((vp.width - FIT_PADDING * 2) / rect.w, usable / rect.h);
  const extra = BAR_SPACE / Math.max(zoom, 0.0001);
  editor.zoomToRect({ x: rect.x, y: rect.y, w: rect.w, h: rect.h + extra }, { padding: FIT_PADDING, animate });
}

function showCurrent(editor: Editor, animate: boolean) {
  const { frameId } = presentStore(editor).getState();
  const frame = frameId ? editor.getElement<FrameElement>(frameId) : undefined;
  if (frame) fitSlide(editor, frame, animate);
  else editor.zoomToFit(undefined, { animate, padding: 64, maxZoom: 1 });
}

/**
 * Starts presenting from the selected frame (or `fromFrameId`). The server is told who presents
 * (#146): if someone else on the board presents, it refuses and this stops again with its reason.
 * `handedOver`: someone handed the presentation to me — the server already says so.
 */
export function startPresenting(editor: Editor, fromFrameId?: string | null, opts: { handedOver?: boolean } = {}) {
  const list = slides(editor.getElements());
  const selected = editor.getSelection().find((id) => list.some((f) => f.id === id));
  const start = list.find((f) => f.id === (fromFrameId ?? selected)) ?? list[0] ?? null;
  editor.stopEditing();
  editor.clearSelection();
  if (editor.getToolId() !== 'select') editor.setTool('select');
  editor.openDock(null);
  editor.setChromeHidden(true);
  presentStore(editor).setState({
    presenting: true,
    frameId: start?.id ?? null,
    position: start ? list.indexOf(start) : 0,
    since: editor.host.serverNow(),
  });
  if (!opts.handedOver && editor.host.presentation)
    editor.host.presentation.start(start?.id ?? null).catch((e: unknown) => {
      stopPresenting(editor, { quietly: true });
      editor.host.notify(e instanceof Error ? e.message : 'Couldn’t start presenting', 'info');
    });
  publish(editor, { presenting: { frameId: start?.id ?? null, startedAt: Date.now() } });
  // The presenter sees how the room reacts (#144: features/presence counts, nothing is stored).
  editor.runCommand('presence.countReactions', { on: true });
  showCurrent(editor, true);
}

/** Laser pointer: a point of my trail (shared through presence only). */
export function laserAt(editor: Editor, p: Point) {
  pointLaser(editor, p, (laser) => publish(editor, { laser }));
}

export function laserOff(editor: Editor) {
  stopLaser(editor, (laser) => publish(editor, { laser }));
}

/** Stops presenting here. `quietly`: the server already moved on (handed over, refused): don't tell it. */
export function stopPresenting(editor: Editor, opts: { quietly?: boolean } = {}) {
  if (!presentStore(editor).getState().presenting) return;
  laserOff(editor);
  presentStore(editor).setState({ presenting: false, laser: false, notesWindow: false });
  if (!opts.quietly) editor.host.presentation?.end().catch(() => undefined);
  editor.setChromeHidden(false);
  publish(editor, { presenting: null });
  editor.runCommand('presence.countReactions', { on: false });
}

/** Go to a slide by position (clamped). */
export function goTo(editor: Editor, position: number) {
  const list = slides(editor.getElements());
  if (!list.length) return showCurrent(editor, true);
  const p = Math.max(0, Math.min(list.length - 1, position));
  const frame = list[p];
  presentStore(editor).setState({ frameId: frame.id, position: p });
  const cur = published.get(editor.boardId)?.presenting;
  publish(editor, { presenting: { frameId: frame.id, startedAt: cur?.startedAt ?? Date.now() } });
  fitSlide(editor, frame, true);
}

export function step(editor: Editor, delta: number) {
  const list = slides(editor.getElements());
  const { frameId, position } = presentStore(editor).getState();
  goTo(editor, currentPosition(list, frameId, position) + delta);
}

/** Re-fit the current slide (viewport resized). */
export function refit(editor: Editor) {
  if (presentStore(editor).getState().presenting) showCurrent(editor, false);
}

/** Hands presenting to `to` (#146): the server checks and records it; their screen takes over. */
export async function handOff(editor: Editor, to: { id: string; name: string }): Promise<void> {
  const p = editor.host.presentation;
  if (!p) return;
  try {
    await p.handoff(to.id, presentStore(editor).getState().frameId);
    stopPresenting(editor, { quietly: true });
    editor.host.notify(`${to.name} presents now`, 'success');
  } catch (e) {
    editor.host.notify(e instanceof Error ? e.message : 'Couldn’t hand over', 'error');
  }
}
