// Putting an imported file on the board: read it (size-capped), recognise and parse it, store its
// pictures, then create everything in ONE transaction — one undo step — on a free spot near where
// it was dropped. A file we can't read adds nothing and says why.
import { translateDraft, type ElementDraft } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';
import { boundsOf, ImportError, MAX_FILE_BYTES, type ImportReport, type ImportResult } from './common';
import { looksLikeDrawio, parseDrawio } from './drawio';
import { looksLikeExcalidraw, parseExcalidraw } from './excalidraw';
import { nanoid } from 'nanoid';

export const IMPORT_DIALOG = 'import.dialog';

export type ImportKind = 'drawio' | 'excalidraw';

/** Which importer a file is for, by its name, else by its first bytes; null: neither. */
export function kindOfFile(name: string, head: string): ImportKind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.drawio') || n.endsWith('.dio')) return 'drawio';
  if (n.endsWith('.excalidraw')) return 'excalidraw';
  if ((n.endsWith('.xml') || n.endsWith('.txt') || !n.includes('.')) && looksLikeDrawio(head)) return 'drawio';
  if ((n.endsWith('.json') || n.endsWith('.txt') || !n.includes('.')) && looksLikeExcalidraw(head)) return 'excalidraw';
  return null;
}

/** Which importer pasted text is for (a diagram copied out of draw.io or Excalidraw). */
export function kindOfText(text: string | null): ImportKind | null {
  if (!text) return null;
  if (looksLikeDrawio(text)) return 'drawio';
  if (looksLikeExcalidraw(text)) return 'excalidraw';
  return null;
}

export async function parseImport(kind: ImportKind, text: string, newId: () => string = nanoid): Promise<ImportResult> {
  return kind === 'drawio' ? parseDrawio(text, newId) : parseExcalidraw(text, newId);
}

function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  const meta = url.slice(5, comma);
  const type = meta.split(';')[0] || 'application/octet-stream';
  const body = url.slice(comma + 1);
  const bytes = meta.includes(';base64') ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(body));
  return new Blob([bytes], { type });
}

/** Stores each picture with the board's uploads (linked ones fetched by the server); null for one that couldn't be stored. */
async function storeImages(editor: Editor, images: ImportResult['images']): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  await Promise.all(
    images.map(async ({ id, source }) => {
      try {
        const { url } = source.startsWith('data:') ? await editor.host.uploadImage(dataUrlToBlob(source)) : await editor.host.importImage(source);
        out.set(id, url || null);
      } catch {
        out.set(id, null);
      }
    }),
  );
  return out;
}

/**
 * Creates `result` on the board near `at` (default: the middle of the view), selected and in view.
 * Images are stored first; one that can't be is left out (lines to it keep a loose end) and
 * reported. Returns the report.
 */
export async function placeImport(editor: Editor, result: ImportResult, at?: Point): Promise<ImportReport> {
  const skipped = [...result.report.skipped];
  let drafts: ElementDraft[] = result.drafts;
  if (result.images.length) {
    const stored = await storeImages(editor, result.images);
    const failed = new Set([...stored].filter(([, url]) => !url).map(([id]) => id));
    if (failed.size) skipped.push({ what: 'Images that couldn’t be stored (left out)', count: failed.size });
    drafts = drafts
      .filter((d) => !failed.has(d.id))
      .map((d) => {
        if (d.type === 'image' && stored.get(d.id)) return { ...d, src: stored.get(d.id)! };
        if (d.type !== 'connector') return d;
        const loose = (e: typeof d.start) => (e.elementId && failed.has(e.elementId) ? { elementId: null, x: e.x, y: e.y } : e);
        return { ...d, start: loose(d.start), end: loose(d.end) };
      });
  }
  if (!drafts.length) throw new ImportError('Nothing in this file could be put on the board.');
  const b = boundsOf(drafts);
  const spot = editor.findFreeSpot({ w: b.w, h: b.h }, at ? { near: at } : undefined);
  const placed = drafts.map((d) => translateDraft(d, Math.round(spot.x - b.x), Math.round(spot.y - b.y)));
  let ids: string[] = [];
  editor.transact(() => {
    ids = editor.createMany(placed as unknown as NewElement[]);
  });
  if (!ids.length) throw new ImportError('You can’t add these items to this board right now.');
  const top = ids.filter((id) => {
    const el = editor.getElement(id);
    return el && !(el.frameId && ids.includes(el.frameId));
  });
  editor.select(top);
  editor.zoomToFit(ids, { animate: true, padding: 96, maxZoom: Math.max(1, editor.getCamera().zoom) });
  return { ...result.report, imported: ids.length, skipped };
}

/** Reads, recognises, parses and places a file; throws ImportError (a message for the person). */
export async function importFile(editor: Editor, file: File, at?: Point): Promise<ImportReport> {
  if (file.size > MAX_FILE_BYTES) throw new ImportError(`That file is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const text = await file.text();
  const kind = kindOfFile(file.name, text.slice(0, 2000));
  if (!kind) throw new ImportError('Freero imports draw.io (.drawio) and Excalidraw (.excalidraw) files.');
  return placeImport(editor, await parseImport(kind, text), at);
}

/** One line for a toast. */
export function summary(r: ImportReport): string {
  const n = r.imported;
  const left = r.skipped.reduce((s, x) => s + x.count, 0);
  return `Imported ${n} ${n === 1 ? 'item' : 'items'} from ${r.source}${left ? ` · ${left} not mapped exactly` : ''}`;
}
