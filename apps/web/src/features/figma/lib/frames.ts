// Placing and refreshing Figma frames (#171). A placed frame is an ordinary image (the image
// feature's element type) whose item link points back at the frame; the link is all Refresh needs.
import { parseFigmaFrameLink, type BoardElement, type FigmaFrame, type FigmaPlaceResponse, type ImageElement } from '@freero/shared';
import type { Editor, NewElement, Rect } from '@engine';
import { t } from '../messages';

export const DIALOG = 'figma.picker';
/** Frames land at their size in Figma, the long side at most this. */
const MAX_SIDE = 1200;
const GAP = 40;

/** An image placed from a Figma frame (or sent by the plugin), with the frame it shows. */
export function figmaImage(el: BoardElement | undefined | null): (ImageElement & { link: string }) | null {
  return el?.type === 'image' && typeof el.link === 'string' && parseFigmaFrameLink(el.link) ? (el as ImageElement & { link: string }) : null;
}

/** The size a frame of `w`×`h` (Figma's units) is shown at on the board. */
export function shownSize(w: number, h: number): { w: number; h: number } {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
  return { w: Math.max(8, Math.round(w * k)), h: Math.max(8, Math.round(h * k)) };
}

/**
 * A refreshed frame's box: where it was and as wide as it was (people sized it to fit their
 * board), with the new picture's proportions, around the same centre.
 */
export function refreshedBox(el: Pick<ImageElement, 'x' | 'y' | 'w' | 'h'>, naturalW: number, naturalH: number): Rect {
  if (naturalW <= 0 || naturalH <= 0) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const h = Math.max(8, Math.round((el.w * naturalH) / naturalW));
  return { x: el.x, y: Math.round(el.y + (el.h - h) / 2), w: el.w, h };
}

/** Lays out the placed frames in a row on free space near the viewport centre and selects them. */
export function placeFrames(editor: Editor, placed: Array<{ frame: Pick<FigmaFrame, 'w' | 'h'>; stored: FigmaPlaceResponse }>): string[] {
  if (!placed.length) return [];
  const sizes = placed.map((p) => shownSize(p.frame.w, p.frame.h));
  const row = { w: sizes.reduce((s, z) => s + z.w, 0) + GAP * (sizes.length - 1), h: Math.max(...sizes.map((z) => z.h)) };
  const at = editor.findFreeSpot(row);
  let x = at.x;
  const els = placed.map((p, i) => {
    const el = { type: 'image', src: p.stored.url, naturalW: p.stored.w, naturalH: p.stored.h, alt: p.stored.name, link: p.stored.link, x, y: at.y, ...sizes[i] };
    x += sizes[i].w + GAP;
    return el;
  });
  const ids = editor.createMany(els as NewElement[], { select: true });
  editor.zoomToRect({ x: at.x, y: at.y, ...row }, { maxZoom: editor.getCamera().zoom, padding: 48 });
  return ids;
}

/** What a refusal from Figma or the server means for the person, in their language. */
export function figmaErrorText(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  switch (code) {
    case 'figma_not_connected':
    case 'figma_reconnect':
      return t('connectAgain');
    case 'figma_no_access':
      return t('noAccess');
    case 'figma_not_found':
      return t('notFound');
    case 'figma_render_empty':
      return t('renderEmpty');
    case 'figma_rate_limited':
      return t('rateLimited');
    case 'figma_bad_link':
      return t('notAFigmaLink');
    default:
      return e instanceof Error && e.message ? e.message : t('figmaDidntAnswer');
  }
}

export const needsConnect = (e: unknown) => {
  const code = (e as { code?: unknown })?.code;
  return code === 'figma_not_connected' || code === 'figma_reconnect';
};

/** Re-renders the selected Figma images and swaps their pictures in place; one undo step each. */
export async function refreshFromFigma(editor: Editor, ids: string[]): Promise<void> {
  const figma = editor.host.figma;
  if (!figma) return;
  const targets = ids.map((id) => figmaImage(editor.getElement(id))).filter((el): el is NonNullable<ReturnType<typeof figmaImage>> => !!el && !el.locked);
  let done = 0;
  for (const el of targets) {
    const ref = parseFigmaFrameLink(el.link)!;
    try {
      const r = await figma.place(ref.fileKey, ref.nodeId);
      const cur = figmaImage(editor.getElement(el.id));
      if (!cur) continue;
      editor.update<ImageElement>(cur.id, { src: r.url, naturalW: r.w, naturalH: r.h, crop: null, alt: cur.alt || r.name, ...refreshedBox(cur, r.w, r.h) });
      done++;
    } catch (e) {
      editor.host.notify(figmaErrorText(e), 'error', needsConnect(e) ? { action: { label: t('connectFigma'), run: () => figma.connect() } } : undefined);
      return;
    }
  }
  if (done) editor.host.notify(t('refreshed', { count: done }), 'success');
}
