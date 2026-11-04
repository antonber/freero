// A board drawn on the server (#33): the elements the reader may see (realtime's view — no hidden
// frame's contents for viewers, nobody's private drafts), their pictures read from uploads, drawn
// as SVG (svg.ts) and rasterised to PNG or wrapped in a PDF (raster.ts). Who may export at all —
// the downloads policy, the board's "viewers can copy and export", the audit event — is the
// caller's to check first (boards.recordBoardExport); this module only draws.
import { rotatedBounds, type BoardElement, type Rect } from '@freero/shared';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { readBoardView, type BoardReader } from '../realtime/index';
import { readUpload } from '../uploads/index';
import { boardSvg, stickerSrc } from './svg';
import { pdfOf, rasterize } from './raster';

export type RenderFormat = 'png' | 'svg' | 'pdf';
export const RENDER_FORMATS: readonly RenderFormat[] = ['png', 'svg', 'pdf'];

/** What to draw: the format, optionally only one frame, and the pixels per board unit (png / pdf). */
export interface RenderSpec {
  format: RenderFormat;
  frameId?: string | null;
  scale?: number;
  /** At most this many pixels a side (png / pdf), whatever the scale: a preview to show in a conversation. */
  fit?: number;
}

/** Bounds: boards bigger than this are refused (413), pictures bigger than this are drawn smaller. */
export const RENDER_LIMITS = { maxItems: 5000, maxSide: 8000, maxPixels: 40_000_000, maxImageBytes: 40 * 1024 * 1024, maxScale: 4 } as const;

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

/** Reads what a create or download asks to draw; refused (400) when it can't be one. */
export function readRenderSpec(v: { format?: unknown; frameId?: unknown; scale?: unknown }): RenderSpec {
  if (!RENDER_FORMATS.includes(v.format as RenderFormat)) throw badRequest(`format must be ${RENDER_FORMATS.join(', ')}`);
  if (v.frameId !== undefined && v.frameId !== null && (typeof v.frameId !== 'string' || !v.frameId || v.frameId.length > 200)) throw badRequest('frameId must be a frame id');
  const scale = v.scale === undefined || v.scale === null ? undefined : Number(v.scale);
  if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0 || scale > RENDER_LIMITS.maxScale)) throw badRequest(`scale must be a number above 0, at most ${RENDER_LIMITS.maxScale}`);
  return { format: v.format as RenderFormat, ...(typeof v.frameId === 'string' ? { frameId: v.frameId } : {}), ...(scale !== undefined ? { scale } : {}) };
}

/** `frame` and what sits in it, at any depth (and connectors joining two of those). */
function insideFrame(all: readonly BoardElement[], frame: BoardElement): BoardElement[] {
  const ids = new Set([frame.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const el of all)
      if (!ids.has(el.id) && ((el.frameId && ids.has(el.frameId)) || (el.attachedTo && ids.has(el.attachedTo)))) {
        ids.add(el.id);
        grew = true;
      }
  }
  return all.filter((el) => {
    if (ids.has(el.id)) return true;
    if (el.type !== 'connector') return false;
    const c = el as unknown as { start?: { elementId?: string | null }; end?: { elementId?: string | null } };
    return !!c.start?.elementId && !!c.end?.elementId && ids.has(c.start.elementId) && ids.has(c.end.elementId);
  });
}

/** Data URLs of the uploaded pictures these elements show (others are drawn as placeholders), within a byte budget. */
async function pictures(els: readonly BoardElement[]): Promise<Map<string, string>> {
  const srcs = new Set<string>();
  for (const el of els) {
    const src = el.type === 'image' ? (el as { src?: unknown }).src : el.type === 'embed' ? (el as { image?: unknown }).image : stickerSrc(el);
    if (typeof src === 'string' && (src.startsWith('/uploads/') || /^data:image\/(png|jpeg|gif|webp);base64,/.test(src))) srcs.add(src);
  }
  const out = new Map<string, string>();
  let budget: number = RENDER_LIMITS.maxImageBytes;
  for (const src of srcs) {
    if (src.startsWith('data:')) {
      if (src.length > budget) continue;
      budget -= src.length;
      out.set(src, src);
      continue;
    }
    const type = IMAGE_TYPES[src.split('.').pop()?.toLowerCase() ?? ''];
    if (!type) continue;
    const bytes = await readUpload(src).catch(() => null);
    if (!bytes || bytes.length > budget) continue;
    budget -= bytes.length;
    out.set(src, `data:${type};base64,${bytes.toString('base64')}`);
  }
  return out;
}

export interface Rendered {
  body: Buffer;
  contentType: string;
  extension: RenderFormat;
  /** Size of the picture in pixels (png), or of the page in board units (svg, pdf). */
  width: number;
  height: number;
  /** The scale it was drawn at (lower than asked when the picture would have been too big). */
  scale: number;
  items: number;
}

/**
 * Draws board `boardId` as `reader` sees it — never anyone's private drafts — in `spec`'s format.
 * 404 for a frame the reader can't see; 413 for a board beyond RENDER_LIMITS.maxItems.
 */
export async function renderBoard(boardId: string, reader: BoardReader, title: string, spec: RenderSpec): Promise<Rendered> {
  const view = await readBoardView(boardId, reader);
  let els = view.elements.filter((e) => e.layer !== 'private').map((e) => e.el);
  let area: Rect | undefined;
  if (spec.frameId) {
    const frame = els.find((el) => el.id === spec.frameId);
    if (!frame || (frame.type !== 'frame' && frame.type !== 'kanban')) throw notFound('No such frame on this board');
    els = insideFrame(els, frame);
    area = rotatedBounds(frame);
  }
  if (els.length > RENDER_LIMITS.maxItems)
    throw new HttpError(413, `This ${spec.frameId ? 'frame' : 'board'} has ${els.length} items; pictures are drawn of at most ${RENDER_LIMITS.maxItems} (export a frame instead)`, 'board_too_large');
  const images = await pictures(els);
  const { svg, width, height } = boardSvg({ elements: els, collection: (n) => view.collection(n), imageData: (src) => images.get(src) ?? null, ...(area ? { area } : {}) });
  if (spec.format === 'svg') return { body: Buffer.from(svg), contentType: 'image/svg+xml', extension: 'svg', width, height, scale: 1, items: els.length };
  // As sharp as asked (default 2 pixels per unit for PNG, 1.5 for PDF), never past the pixel budget.
  const want = spec.scale ?? (spec.format === 'png' ? 2 : 1.5);
  const side = Math.min(RENDER_LIMITS.maxSide, spec.fit ?? Infinity);
  const scale = Math.max(0.05, Math.min(want, side / width, side / height, Math.sqrt(RENDER_LIMITS.maxPixels / (width * height))));
  const r = await rasterize(svg, scale);
  if (spec.format === 'png') return { body: r.png, contentType: 'image/png', extension: 'png', width: r.width, height: r.height, scale, items: els.length };
  return { body: pdfOf(r.pixels, r.width, r.height, width * 0.75, height * 0.75, title), contentType: 'application/pdf', extension: 'pdf', width, height, scale, items: els.length };
}
