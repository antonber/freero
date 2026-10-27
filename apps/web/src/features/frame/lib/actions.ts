// Frame actions shared by the tool, commands, format toolbar, title and Frames panel.
import type { BoardElement, FrameElement } from '@freero/shared';
import type { Editor, Rect } from '@engine';
import {
  applyPresetSize,
  membershipPatches,
  CONTENT_PADDING,
  fitCamera,
  DEFAULT_FILL,
  isFrame,
  nextFrameIndex,
  nextFrameTitle,
  orderFrames,
  padRect,
  type FramePreset,
} from './frames';

export function allFrames(editor: Editor): FrameElement[] {
  return editor.getElements().filter(isFrame);
}

export function framesInOrder(editor: Editor): FrameElement[] {
  return orderFrames(allFrames(editor));
}

/** Non-frame elements with their rotation-aware bounds. */
function boundedItems(editor: Editor, filter: (el: BoardElement) => boolean = () => true) {
  const out: Array<{ el: BoardElement; bounds: Rect }> = [];
  for (const el of editor.getElements()) {
    if (el.type === 'frame' || !filter(el)) continue;
    const bounds = editor.getBounds([el.id]);
    if (bounds) out.push({ el, bounds });
  }
  return out;
}

/** Creates a frame (next index, "Frame N") and returns its id. Does not adopt children. */
export function createFrame(editor: Editor, rect: Rect, preset: FramePreset, opts: { select?: boolean } = {}): string {
  const frames = allFrames(editor);
  return editor.create<'frame'>(
    {
      type: 'frame',
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.max(40, Math.round(rect.w)),
      h: Math.max(40, Math.round(rect.h)),
      title: nextFrameTitle(frames),
      fill: DEFAULT_FILL,
      index: nextFrameIndex(frames),
      preset,
    },
    { select: opts.select ?? true },
  );
}

/**
 * Re-derives membership after a frame was created or its rect changed: elements whose center is
 * now inside join (from no frame, or from a larger frame they sit in — the innermost frame wins),
 * members now outside leave.
 */
export function syncMembership(editor: Editor, frameId: string): void {
  const frame = editor.getElement<FrameElement>(frameId);
  if (!frame) return;
  const patches = membershipPatches(frame, boundedItems(editor), (id) => {
    const p = editor.getElement(id);
    return p ? p.w * p.h : undefined;
  });
  if (patches.length) editor.updateMany(patches.map(({ id, frameId: fid }) => ({ id, patch: { frameId: fid } })));
}

/** "Frame selection": wraps the selected (non-frame) elements in a new padded frame. */
export function frameSelection(editor: Editor): string | null {
  const ids = editor.getSelection().filter((id) => {
    const el = editor.getElement(id);
    return el && el.type !== 'frame';
  });
  const bounds = editor.getBounds(ids);
  if (!ids.length || !bounds) return null;
  let id = '';
  editor.transact(() => {
    id = createFrame(editor, padRect(bounds, CONTENT_PADDING), 'custom', { select: false });
    if (id) editor.updateMany(ids.map((cid) => ({ id: cid, patch: { frameId: id } })));
  });
  if (id) editor.select([id]);
  return id || null;
}

/**
 * Animates the camera to a frame, clear of the board chrome (top bar + title above, toolbar on the
 * left, and the dock when `rightInset` says it is open).
 */
export function zoomToFrame(editor: Editor, frame: Rect, rightInset = 0): void {
  const insets = { top: 96, right: Math.max(40, rightInset + 24), bottom: 72, left: 88 };
  editor.setCamera(fitCamera(frame, editor.getViewportSize(), insets), { animate: true });
}

/** Shrinks/grows the frame to its children plus padding. Returns false when it has none. */
export function fitToContent(editor: Editor, frame: FrameElement): boolean {
  const childIds = editor.getElements().filter((el) => el.frameId === frame.id).map((el) => el.id);
  const bounds = editor.getBounds(childIds);
  if (!childIds.length || !bounds) return false;
  editor.transact(() => {
    editor.update<FrameElement>(frame.id, { ...padRect(bounds, CONTENT_PADDING), preset: 'custom' });
    syncMembership(editor, frame.id);
  });
  return true;
}

export function setPreset(editor: Editor, frames: FrameElement[], preset: FramePreset): void {
  editor.transact(() => {
    for (const f of frames) {
      editor.update<FrameElement>(f.id, { ...applyPresetSize(f, preset), preset });
      syncMembership(editor, f.id);
    }
  });
}

export function renameFrame(editor: Editor, id: string, title: string): void {
  const frame = editor.getElement<FrameElement>(id);
  const next = title.trim();
  if (!frame || frame.title === next) return;
  editor.update<FrameElement>(id, { title: next || frame.title });
}

/** Selected frames. */
export function selectedFrames(editor: Editor): FrameElement[] {
  return editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter(isFrame);
}
