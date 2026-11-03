// Editing one slide on its own (#135): the frame at 100% of its size (smaller only when the window
// can't show that much), everything outside it out of sight and out of reach, previous / next to
// step through the deck, Esc back to the board where you were. Built on the engine's focus
// (Editor.setFocus with hideOutside + contentsOnly): local view state of this viewer only —
// nothing about it is written to the board, and others see the edits live as usual.
import { createStore, useStore, type StoreApi } from 'zustand';
import type { FrameElement } from '@freero/shared';
import type { Camera, Editor } from '@engine';
import { framesInOrder } from './actions';
import { isFrame } from './frames';

export interface SlideEditState {
  /** The slide being edited, null when not editing one. */
  frameId: string | null;
  /** Where the board was before, to go back to. */
  back: Camera | null;
}

const stores = new Map<string, StoreApi<SlideEditState>>();

export function slideEditStore(editor: Editor): StoreApi<SlideEditState> {
  let s = stores.get(editor.boardId);
  if (!s) {
    s = createStore<SlideEditState>(() => ({ frameId: null, back: null }));
    stores.set(editor.boardId, s);
  }
  return s;
}

export const useSlideEdit = <T>(editor: Editor, pick: (s: SlideEditState) => T): T => useStore(slideEditStore(editor), pick);

/** Room around the slide when it has to be fitted. */
const PADDING = 48;

/** Opens `frameId` on its own (or moves the slide editor to it). */
export function editSlide(editor: Editor, frameId: string): void {
  const frame = editor.getElement<FrameElement>(frameId);
  if (!isFrame(frame)) return;
  const store = slideEditStore(editor);
  const { frameId: current, back } = store.getState();
  // Already editing a slide (its focus still on): keep where the board was before the first one.
  const editing = !!current && editor.getFocus() === current;
  editor.stopEditing();
  if (editor.getToolId() !== 'select') editor.setTool('select');
  // Set before the focus moves, so the focus watcher sees a slide change, not the end of editing.
  store.setState({ frameId, back: editing ? back : editor.getCamera() });
  editor.clearSelection();
  editor.setFocus(frameId, { hideOutside: true, contentsOnly: true });
  editor.zoomToFit([frameId], { maxZoom: 1, padding: PADDING, animate: true });
}

/** The slide `delta` steps away in the deck (presentation order, skipped slides included). */
export function neighbour(editor: Editor, frameId: string, delta: number): FrameElement | null {
  const order = framesInOrder(editor);
  const at = order.findIndex((f) => f.id === frameId);
  return at < 0 ? null : (order[at + delta] ?? null);
}

export function stepSlide(editor: Editor, delta: number): void {
  const { frameId } = slideEditStore(editor).getState();
  const next = frameId ? neighbour(editor, frameId, delta) : null;
  if (next) editSlide(editor, next.id);
}

/** Back to the board, where it was before. */
export function leaveSlide(editor: Editor): void {
  const store = slideEditStore(editor);
  const { frameId, back } = store.getState();
  if (!frameId) return;
  store.setState({ frameId: null, back: null });
  if (editor.getFocus() === frameId) editor.setFocus(null);
  if (back) editor.setCamera(back, { animate: true });
}

/**
 * The engine ended the focus (Esc with nothing selected, or the slide was deleted, or another
 * feature focused something else): the slide editor ends with it.
 */
export function focusChanged(editor: Editor, focus: string | null): void {
  const { frameId } = slideEditStore(editor).getState();
  if (frameId && focus !== frameId) leaveSlide(editor);
}

/**
 * The bar went away while a slide was open (the board closed, or the chrome changed around it —
 * presenting): forget the slide and its focus, so the board shows whole again.
 */
export function forgetSlide(editor: Editor): void {
  const { frameId } = slideEditStore(editor).getState();
  slideEditStore(editor).setState({ frameId: null, back: null });
  if (frameId && editor.getFocus() === frameId) editor.setFocus(null);
}
