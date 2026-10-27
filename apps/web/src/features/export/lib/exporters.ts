// Editor-facing export actions shared by the dialogs and commands.
import type { FrameElement } from '@freero/shared';
import type { Editor, Rect } from '@engine';
import { dataUrlToBlob, downloadBlob, exportFileName } from './files';
import type { PdfFrame } from './pdf';

export type ImageFormat = 'png' | 'jpeg' | 'svg';
export type ImageScope = 'board' | 'selection' | 'visible';

/** Padding around ids/whole-board exports (world px). */
export const EXPORT_PADDING = 32;
/** Frames draw their title above their box (outside its bounds); leave room for it. */
export const FRAME_PADDING = 64;
/** The engine caps a rendered side at this many pixels. */
export const MAX_SIDE_PX = 8192;
/** Above this many items we warn that rendering takes a moment. */
export const LARGE_BOARD = 300;

export function visibleRect(editor: Editor): Rect {
  const cam = editor.getCamera();
  const vp = editor.getViewportSize();
  return { x: cam.x, y: cam.y, w: vp.width / cam.zoom, h: vp.height / cam.zoom };
}

export interface ScopeInfo {
  /** Items that will be rendered. */
  count: number;
  /** Output size in world px before scaling (including padding). */
  rect: Rect | null;
  request: { ids?: string[]; rect?: Rect; padding?: number };
}

export function scopeInfo(editor: Editor, scope: ImageScope): ScopeInfo {
  if (scope === 'visible') {
    const rect = visibleRect(editor);
    return { count: editor.elementsInRect(rect, 'intersect').length, rect, request: { rect, padding: 0 } };
  }
  const ids = scope === 'selection' ? editor.getSelection() : undefined;
  if (ids && !ids.length) return { count: 0, rect: null, request: { ids } };
  const b = editor.getBounds(ids);
  const els = ids ? ids.map((id) => editor.getElement(id)).filter(Boolean) : editor.getElements();
  const pad = els.some((e) => e!.type === 'frame') ? FRAME_PADDING : EXPORT_PADDING;
  const rect = b && { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  return { count: els.length, rect, request: { ids, padding: pad } };
}

/** Pixel size after the engine's per-side cap. */
export function outputSize(rect: Rect, scale: number): { w: number; h: number; capped: boolean } {
  const k = Math.min(scale, MAX_SIDE_PX / Math.max(rect.w, rect.h));
  return { w: Math.round(rect.w * k), h: Math.round(rect.h * k), capped: k < scale };
}

export async function exportImage(
  editor: Editor,
  o: { format: ImageFormat; scale: number; background: boolean; scope: ImageScope },
): Promise<void> {
  const { request } = scopeInfo(editor, o.scope);
  const dataUrl = await editor.renderToDataUrl({
    ...request,
    format: o.format,
    scale: o.format === 'svg' ? 1 : o.scale,
    // JPEG has no transparency, so it always gets the board background.
    background: o.background || o.format === 'jpeg' ? undefined : null,
  });
  const suffix = o.scope === 'selection' ? 'selection' : o.scope === 'visible' ? 'view' : '';
  const ext = o.format === 'jpeg' ? 'jpg' : o.format;
  downloadBlob(dataUrlToBlob(dataUrl), exportFileName(editor.host.board.title, ext, suffix));
}

export function boardFrames(editor: Editor): PdfFrame[] {
  return editor
    .getElements()
    .filter((e): e is FrameElement => e.type === 'frame')
    .map((f) => ({ id: f.id, title: f.title || 'Untitled frame', index: f.index ?? 0, x: f.x, y: f.y, w: f.w, h: f.h }));
}

/** Render scale for a PDF page: crisp but bounded memory for huge frames. */
export function pdfScale(f: Rect): number {
  return Math.min(2, Math.max(0.5, 3200 / Math.max(f.w, f.h)));
}

/** Copies the selection to the clipboard as PNG; falls back to a download with a toast. */
export async function copySelectionAsImage(editor: Editor): Promise<void> {
  const ids = editor.getSelection();
  const notify = editor.host.notify;
  if (!ids.length) {
    notify('Select something first, then copy it as an image.', 'info');
    return;
  }
  const blob = editor.renderToDataUrl({ ids, format: 'png', scale: 2 }).then(dataUrlToBlob);
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('Clipboard images unsupported');
    // Pass the promise (not the blob) so the write starts inside the user gesture (Safari).
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    notify('Copied selection as image.', 'success');
  } catch {
    try {
      downloadBlob(await blob, exportFileName(editor.host.board.title, 'png', 'selection'));
      notify('Your browser blocked copying images, so we downloaded a PNG instead.', 'info');
    } catch {
      notify('Could not render the selection as an image.', 'error');
    }
  }
}
