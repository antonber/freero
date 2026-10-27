// Filling a pasted link's card: the server unfurls the page (Host.unfurl), the preview image is
// shrunk and stored with the board's own uploads (Host.uploadImage), so viewers and exports load
// it from Freero, never from the third-party site.
import type { EmbedElement } from '@freero/shared';
import type { Editor } from '@engine';
import { videoEmbed } from './providers';

/** Card sizes (world px). */
export const CARD_W = 360;
export const CARD_H_IMAGE = 316;
export const CARD_H_TEXT = 128;
const MAX_IMAGE_SIDE = 720;

// Cards whose preview is being fetched by THIS client (a 'loading' card nobody fetches any more,
// e.g. after an undo, renders as a plain link card).
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
export const isFetching = (id: string) => inFlight.has(id);
export function subscribeFetching(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const changed = () => listeners.forEach((l) => l());

async function shrink(dataUrl: string): Promise<Blob | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
  } catch {
    return null;
  }
}

/** Unfurls `url` for card `id` and writes the result (or 'failed') into it. */
export async function fillPreview(editor: Editor, id: string, url: string): Promise<void> {
  inFlight.add(id);
  changed();
  let patch: Partial<EmbedElement>;
  try {
    const p = await editor.host.unfurl(url);
    let image: string | null = null;
    if (p.image) {
      const small = await shrink(p.image);
      image = small ? await editor.host.uploadImage(small).then((r) => r.url, () => null) : null;
    }
    patch = { title: p.title, description: p.description, siteName: p.siteName, image, status: 'ready' };
  } catch {
    patch = { status: 'failed' };
  } finally {
    inFlight.delete(id);
    changed();
  }
  const cur = editor.getElement<EmbedElement>(id);
  if (!cur || cur.url !== url) return; // deleted or re-pointed meanwhile
  const h = patch.image || videoEmbed(url) ? CARD_H_IMAGE : CARD_H_TEXT;
  editor.update<EmbedElement>(id, { ...patch, h, y: cur.y + (cur.h - h) / 2 });
}
