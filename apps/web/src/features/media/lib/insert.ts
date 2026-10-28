// Getting files onto the board: upload each (media or attachment), then create every item at once.
import type { Editor, NewElement, Point, Rect } from '@engine';
import { CARD_H, CARD_W, boundsOf, rowLayout, videoSize } from './layout';
import { addPending } from './pending';
import { storeFile, type Stored } from './store';

const MAX_FILES = 20;

function itemOf(s: Exclude<Stored, { kind: 'error' }>): Omit<NewElement<'media'>, 'x' | 'y'> | Omit<NewElement<'file'>, 'x' | 'y'> {
  if (s.kind === 'file') return { type: 'file', w: CARD_W, h: CARD_H, src: s.src, name: s.file.name || 'File', size: s.file.size, mime: s.file.type };
  const { probed } = s;
  const size = probed.kind === 'video' ? videoSize(probed.w, probed.h) : { w: CARD_W, h: CARD_H };
  return {
    type: 'media',
    ...size,
    kind: probed.kind,
    src: s.src,
    poster: s.poster,
    name: s.file.name || (probed.kind === 'video' ? 'Video' : 'Audio'),
    size: s.file.size,
    duration: Math.round(probed.duration * 10) / 10,
    naturalW: probed.w,
    naturalH: probed.h,
  };
}

/**
 * Uploads files as video / audio items and file cards, laid out side by side centered on `at` (a
 * drop point) or in a free spot near the view. Placeholders show where they will land meanwhile;
 * the items are created together once every upload settled (one undo step).
 */
export async function insertFiles(editor: Editor, files: File[], at: Point | null): Promise<string[]> {
  if (!files.length || !editor.can('editor')) return [];
  if (files.length > MAX_FILES) editor.host.notify(`Adding the first ${MAX_FILES} of ${files.length} files.`, 'info');
  const batch = files.slice(0, MAX_FILES);
  const guess = rowLayout(batch.map(() => ({ w: CARD_W, h: CARD_H })), at ?? editor.getViewportCenter());
  const clear = addPending(batch.map((f, i) => ({ rect: guess[i], name: f.name })));
  let stored: Stored[];
  try {
    // A couple at a time: big videos don't starve each other, and the rate limit stays clear.
    stored = new Array(batch.length);
    let next = 0;
    const worker = async () => {
      while (next < batch.length) {
        const i = next++;
        stored[i] = await storeFile(editor.host, batch[i]);
      }
    };
    await Promise.all([worker(), worker()]);
  } finally {
    clear();
  }
  for (const s of stored) if (s.kind === 'error') editor.host.notify(s.message, 'error');
  const items = stored.filter((s): s is Exclude<Stored, { kind: 'error' }> => s.kind !== 'error').map(itemOf);
  if (!items.length) return [];
  let rects = rowLayout(items, at ?? editor.getViewportCenter());
  if (!at) {
    const b = boundsOf(rects);
    const spot = editor.findFreeSpot({ w: b.w, h: b.h });
    rects = rects.map((r) => ({ ...r, x: r.x - b.x + Math.round(spot.x), y: r.y - b.y + Math.round(spot.y) }));
  }
  const els = items.map((it, i) => ({ ...it, x: rects[i].x, y: rects[i].y })) as NewElement[];
  const ids = editor.createMany(els, { select: true });
  if (ids.length) reveal(editor, boundsOf(rects));
  return ids;
}

/** Glides the camera out (never in) when what was just added isn't fully in view. */
function reveal(editor: Editor, r: Rect) {
  const safe = editor.getSafeArea();
  const a = editor.worldToScreen({ x: r.x, y: r.y });
  const b = editor.worldToScreen({ x: r.x + r.w, y: r.y + r.h });
  if (a.x >= safe.x && a.y >= safe.y && b.x <= safe.x + safe.w && b.y <= safe.y + safe.h) return;
  editor.zoomToRect(r, { maxZoom: editor.getCamera().zoom, padding: 48 });
}

/** Pictures and PDFs have their own items; offered to their importers, never made file cards. */
const ownedElsewhere = (f: File) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/**
 * Opens the system file picker (must run inside the click's user activation). Everything lands in
 * a free spot near the view; pictures and PDFs picked here become image and document items.
 */
export function pickFiles(editor: Editor) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    for (const f of files.filter(ownedElsewhere)) void editor.importData({ files: [f], text: null, html: null }, editor.getViewportCenter());
    const rest = files.filter((f) => !ownedElsewhere(f));
    if (rest.length) void insertFiles(editor, rest, null);
  };
  input.click();
}
