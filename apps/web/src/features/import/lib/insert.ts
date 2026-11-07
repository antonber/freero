// Putting an imported file on the board: read it (size-capped), recognise and parse it, store its
// pictures, then create everything in ONE transaction — one undo step — on a free spot near where
// it was dropped. A file we can't read adds nothing and says why.
import { translateDraft, type BoardElement, type ElementDraft, type FrameElement } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';
import { boundsOf, ImportError, MAX_FILE_BYTES, type ImportReport, type ImportResult } from './common';
import { looksLikeDrawio, parseDrawio } from './drawio';
import { looksLikeExcalidraw, parseExcalidraw } from './excalidraw';
import { isVsdxName, parseVsdx } from './vsdx';
import { isPptxName, parsePptx } from './pptx';
import { looksLikeMural, parseMural } from './mural';
import { looksLikeLucid, parseLucid } from './lucid';
import { parseMiro } from './miro';
import { nanoid } from 'nanoid';

import { t as tr } from '../messages';
export const IMPORT_DIALOG = 'import.dialog';

/** Text formats (a file, or pasted); `.vsdx` and `.pptx` are zip packages, read from their bytes. Mural's and Lucid's CSV exports are recognised by their header. */
export type ImportKind = 'drawio' | 'excalidraw' | 'mural' | 'lucid';
export type FileKind = ImportKind | 'vsdx' | 'pptx';

/** Which importer a file is for, by its name, else by its first bytes; null: none. */
export function kindOfFile(name: string, head: string): FileKind | null {
  const n = name.toLowerCase();
  if (isVsdxName(n) || n.endsWith('.vsd')) return 'vsdx';
  if (isPptxName(n) || n.endsWith('.ppt')) return 'pptx';
  if (n.endsWith('.drawio') || n.endsWith('.dio')) return 'drawio';
  if (n.endsWith('.excalidraw')) return 'excalidraw';
  if ((n.endsWith('.xml') || n.endsWith('.txt') || !n.includes('.')) && looksLikeDrawio(head)) return 'drawio';
  if ((n.endsWith('.json') || n.endsWith('.txt') || !n.includes('.')) && looksLikeExcalidraw(head)) return 'excalidraw';
  // Any other CSV is left to the CSV import (features/csv).
  if (n.endsWith('.csv') && looksLikeMural(head)) return 'mural';
  if (n.endsWith('.csv') && looksLikeLucid(head)) return 'lucid';
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
  if (kind === 'mural') return parseMural(text, newId);
  if (kind === 'lucid') return parseLucid(text, newId);
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

/**
 * Stores each picture with the board's uploads (linked ones fetched by the server); null for one
 * that couldn't be stored. A picture used several times (a logo on every slide) is stored once.
 */
async function storeImages(editor: Editor, images: ImportResult['images'], signal?: AbortSignal): Promise<Map<string, string | null>> {
  const stored = new Map<string, Promise<string | null>>();
  const store = (source: string) => {
    let p = stored.get(source);
    if (!p && signal?.aborted) p = Promise.resolve(null); // cancelled: nothing more is uploaded
    if (!p) {
      p = (source.startsWith('data:') ? editor.host.uploadImage(dataUrlToBlob(source)) : editor.host.importImage(source)).then(
        ({ url }) => url || null,
        () => null,
      );
      stored.set(source, p);
    }
    return p;
  };
  const out = new Map<string, string | null>();
  await Promise.all(images.map(async ({ id, source }) => out.set(id, await store(source))));
  return out;
}

/** The person cancelled (the import dialog's Cancel aborts `signal`): rejects with its AbortError, and nothing is placed. */
function stopIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
}

/**
 * Creates `result` on the board near `at` (default: the middle of the view), selected and in view.
 * Images are stored first; one that can't be is left out (lines to it keep a loose end) and
 * reported. Returns the report. Once `signal` is aborted, nothing more is stored or placed (#193).
 */
export async function placeImport(editor: Editor, result: ImportResult, at?: Point, signal?: AbortSignal): Promise<ImportReport> {
  stopIfCancelled(signal);
  const skipped = [...result.report.skipped];
  let drafts: ElementDraft[] = result.drafts;
  if (result.images.length) {
    const stored = await storeImages(editor, result.images, signal);
    stopIfCancelled(signal);
    const failed = new Set([...stored].filter(([, url]) => !url).map(([id]) => id));
    if (failed.size) skipped.push({ what: tr('imagesThatCouldnTBe'), count: failed.size });
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
  // Imported frames (pages, slides) come after the board's own in the deck, in the file's order.
  const deckEnd = editor.getElements().reduce((m, el) => (el.type === 'frame' && Number.isFinite(el.index) ? Math.max(m, el.index) : m), -1) + 1;
  let frameNo = 0;
  const placed = drafts.map((d) => {
    const moved = translateDraft(d, Math.round(spot.x - b.x), Math.round(spot.y - b.y));
    return moved.type === 'frame' ? ({ ...moved, index: deckEnd + frameNo++ } as ElementDraft) : moved;
  });
  // Tables keep their cells outside the element: the table feature writes them as they are inserted.
  const content = result.content ?? {};
  const tables = placed.filter((d) => d.type === 'table' && content[d.id]);
  const plain = placed.filter((d) => !(d.type === 'table' && content[d.id]));
  let ids: string[] = [];
  editor.transact(() => {
    ids = editor.createMany(plain as unknown as NewElement[]);
    if (!ids.length && plain.length) return;
    for (const t of tables) {
      const el = { ...t, z: 0, createdBy: '', createdAt: 0, updatedAt: 0 } as unknown as BoardElement;
      ids.push(...editor.insertElements({ elements: [el], content: { [t.id]: content[t.id] } }, { at: { x: t.x + t.w / 2, y: t.y + t.h / 2 } }));
    }
    // Tags by name: the tags feature finds the board's tag of that name or makes one.
    const tagged = (result.tags ?? []).filter((t) => ids.includes(t.id) && t.names.length);
    if (tagged.length) editor.runCommand('tags.applyNames', { items: tagged });
    // Speaker notes become presenter notes (the present feature owns them).
    for (const n of result.notes ?? []) if (editor.getElement<FrameElement>(n.frameId)) editor.runCommand('present.setNote', { frameId: n.frameId, text: n.text });
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
export async function importFile(editor: Editor, file: File, at?: Point, signal?: AbortSignal): Promise<ImportReport> {
  if (file.size > MAX_FILE_BYTES) throw new ImportError(`That file is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const packaged = kindOfFile(file.name, '');
  if (packaged === 'vsdx') return placeImport(editor, await parseVsdx(new Uint8Array(await file.arrayBuffer()), nanoid), at, signal);
  if (packaged === 'pptx') return placeImport(editor, await parsePptx(new Uint8Array(await file.arrayBuffer()), nanoid), at, signal);
  const text = await file.text();
  const kind = kindOfFile(file.name, text.slice(0, 2000));
  if (!kind || kind === 'vsdx' || kind === 'pptx') throw new ImportError(tr('freeroImportsTheseFiles'));
  return placeImport(editor, await parseImport(kind, text), at, signal);
}

/**
 * [#62] Reads a Miro board with the person's own token (through the server, which keeps nothing)
 * and places it like a file. The host's errors carry a message for the person.
 */
export async function importMiro(editor: Editor, board: string, token: string, at?: Point, signal?: AbortSignal): Promise<ImportReport> {
  const host = editor.host.boardImport;
  if (!host) throw new ImportError(tr('miroImportNotOffered'));
  const answer = await host.miro(board, token, signal);
  return placeImport(editor, parseMiro(answer, nanoid), at, signal);
}

/** One line for a toast. */
export function summary(r: ImportReport): string {
  const n = r.imported;
  const left = r.skipped.reduce((s, x) => s + x.count, 0);
  return tr('importedNItemsFromSource', { n, source: r.source, value: left ? tr('leftNotMappedExactly', { left }) : '' });
}
