// Frame actions shared by the tool, commands, format toolbar, title and Frames panel.
import type { BoardElement, FrameElement } from '@freero/shared';
import type { Editor, Rect } from '@engine';
import {
  applyPresetSize,
  membershipPatches,
  CONTENT_PADDING,
  DEFAULT_FILL,
  isFrame,
  nextFrameIndex,
  nextFrameTitle,
  orderFrames,
  padRect,
  presetById,
  reorderPatches,
  type FramePreset,
} from './frames';
import { layoutItems, type SlideLayoutId } from './layouts';

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

/**
 * Hides (or shows) frames' contents from viewers and commenters. The engine then moves everything
 * inside into the editors layer (and back), which the server sends to owners/editors only.
 */
export function setHidden(editor: Editor, frames: FrameElement[], hidden: boolean): void {
  if (!editor.can('editor')) return;
  editor.transact(() => frames.forEach((f) => editor.update<FrameElement>(f.id, { hidden })));
  editor.host.notify(
    hidden
      ? 'Contents hidden: viewers and commenters now see an empty frame, and the server no longer sends them what is inside.'
      : 'Contents visible to everyone again.',
    'info',
  );
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

/** Animates the camera to a frame (title included), in the part of the screen the chrome leaves free. */
export function zoomToFrame(editor: Editor, frame: { id: string }): void {
  editor.zoomToFit([frame.id], { maxZoom: 2, padding: 32 });
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

// ------------------------------------------------------------------ slides (KAI-126)

/** Puts a layout's texts (and image area) into a frame, sized to it: one undo step. */
export function applyLayout(editor: Editor, frameId: string, layout: SlideLayoutId): string[] {
  const frame = editor.getElement<FrameElement>(frameId);
  if (!isFrame(frame) || frame.locked || !editor.can('editor')) return [];
  let ids: string[] = [];
  editor.transact(() => {
    ids = editor.createMany(layoutItems(frame, layout));
  });
  return ids;
}

const SLIDE = presetById('16:9');
const SLIDE_GAP = 160;

/**
 * A new 16:9 slide with a layout, right after `after` in the deck (default: at the end), placed to
 * the right of the slide before it when that spot is free. One undo step; the slide is selected.
 */
export function newSlide(editor: Editor, layout: SlideLayoutId | null, after?: string): string | null {
  if (!editor.can('editor') || !editor.mayAdd('frame')) return null;
  const order = framesInOrder(editor);
  const prev = (after ? order.find((f) => f.id === after) : undefined) ?? order[order.length - 1];
  const size = prev && (prev.preset === '4:3' || prev.preset === '16:9') ? { w: prev.w, h: prev.h } : { w: SLIDE.w, h: SLIDE.h };
  const near = prev ? { x: prev.x + prev.w + SLIDE_GAP + size.w / 2, y: prev.y + size.h / 2 } : undefined;
  const spot = editor.findFreeSpot(size, { near, gap: 80 });
  let id = '';
  editor.transact(() => {
    id = createFrame(editor, { ...spot, ...size }, prev?.preset === '4:3' ? '4:3' : '16:9', { select: false });
    if (!id) return;
    const n = order.length + 1;
    editor.update<FrameElement>(id, { title: `Slide ${n}` });
    if (prev) moveSlide(editor, id, order.indexOf(prev) + 1);
    if (layout) applyLayout(editor, id, layout);
  });
  if (!id) return null;
  editor.select([id]);
  return id;
}

/** Moves a slide to position `slot` of the deck (0 = first): rewrites the indexes that change. */
export function moveSlide(editor: Editor, id: string, slot: number): void {
  const patches = reorderPatches(allFrames(editor), id, slot);
  if (patches.length) editor.transact(() => patches.forEach(({ id: fid, index }) => editor.update<FrameElement>(fid, { index })));
}

/** Duplicates a slide with its contents (and notes, element content) right after it in the deck. */
export function duplicateSlide(editor: Editor, id: string): string | null {
  const order = framesInOrder(editor);
  const at = order.findIndex((f) => f.id === id);
  if (at < 0 || !editor.can('editor')) return null;
  let copy: string | undefined;
  editor.transact(() => {
    copy = editor.duplicate([id]).find((cid) => editor.getElement(cid)?.type === 'frame');
    if (copy) moveSlide(editor, copy, at + 1);
  });
  return copy ?? null;
}

/** Skips (or puts back) slides when presenting and in PDF exports. */
export function setSkipped(editor: Editor, frames: FrameElement[], skip: boolean): void {
  if (!editor.can('editor')) return;
  editor.transact(() => frames.forEach((f) => editor.update<FrameElement>(f.id, { skip })));
}

/** Selected frames. */
export function selectedFrames(editor: Editor): FrameElement[] {
  return editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter(isFrame);
}
