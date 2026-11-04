// Mural's own "Download to CSV" (#163; docs/design/importers.md: Mural's API terms rule out an API
// importer) → Freero drafts. The header Mural writes: ID, Text, BG Color, Sticky type, Border line,
// Position X, Position Y, Area, Link to, Last Updated By, Last Updated, Last Content Edited By, Last
// Content Edited, Tags, Integration Labels. Untrusted input: the text is HTML-escaped by Mural and
// becomes plain text here; who edited what (people's names) is never read. Pure.
import { frameDraft, STICKY_SIZE, stickyDraft, type ElementDraft, type Rect } from '@freero/shared';
import { boundsOf, coord, htmlToPlain, ImportError, MAX_ITEMS, nearestSticky, Skips, type ImportResult } from './common';
import { columns, csvRows, headerOf } from './csvRows';

import { t as tx } from '../messages';

/** Mural's standard sticky is about this wide: positions are spread by STICKY_SIZE / this so stickies keep their gaps. */
const MURAL_STICKY = 138;
const AREA_PAD = 48;
const AREA_TITLE = 56;

/** Looks like Mural's CSV download (by its header). */
export function looksLikeMural(text: string): boolean {
  const h = headerOf(text);
  return ['id', 'text', 'bg color', 'position x', 'position y'].every((c) => h.includes(c));
}

export function parseMural(text: string, newId: () => string): ImportResult {
  const rows = csvRows(text);
  const col = columns(rows[0] ?? []);
  const need = ['text', 'position x', 'position y'];
  if (!need.every((c) => col.has(c))) throw new ImportError(tx('notAMuralCsv'));
  const body = rows.slice(1);
  if (body.length > MAX_ITEMS) throw new ImportError(tx('tooManyRows', { n: body.length, max: MAX_ITEMS }));
  const cell = (r: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? '' : (r[i] ?? '');
  };
  const skips = new Skips();
  const scale = STICKY_SIZE / MURAL_STICKY;
  const stickies: ElementDraft[] = [];
  const tags: NonNullable<ImportResult['tags']> = [];
  const areaOf = new Map<string, string>();
  for (const r of body) {
    const x = cell(r, 'position x').trim() ? Number(cell(r, 'position x')) : NaN;
    const y = cell(r, 'position y').trim() ? Number(cell(r, 'position y')) : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      skips.add(tx('rowsWithoutAPosition'));
      continue;
    }
    const id = newId();
    const link = cell(r, 'link to').trim();
    const d = stickyDraft(id, coord(x * scale), coord(y * scale), htmlToPlain(cell(r, 'text')).slice(0, 5000), nearestSticky(cell(r, 'bg color')), STICKY_SIZE);
    if (/^https?:\/\//i.test(link) && link.length <= 2000) (d as { link?: string }).link = link;
    stickies.push(d);
    const names = cell(r, 'tags')
      .split(/[;,|]/)
      .map((t) => htmlToPlain(t).trim().slice(0, 40))
      .filter(Boolean);
    if (names.length) tags.push({ id, names });
    const area = htmlToPlain(cell(r, 'area')).trim().slice(0, 200);
    if (area) areaOf.set(id, area);
  }
  if (!stickies.length) throw new ImportError(tx('nothingInThisFile'));

  // Each area becomes a frame around its stickies (Mural's CSV names the area, not its box).
  const frames: ElementDraft[] = [];
  const byArea = new Map<string, ElementDraft[]>();
  for (const s of stickies) {
    const a = areaOf.get(s.id);
    if (a) byArea.set(a, [...(byArea.get(a) ?? []), s]);
  }
  for (const [title, members] of byArea) {
    const b = boundsOf(members);
    const fid = newId();
    const r: Rect = { x: b.x - AREA_PAD, y: b.y - AREA_TITLE, w: b.w + AREA_PAD * 2, h: b.h + AREA_TITLE + AREA_PAD };
    frames.push(frameDraft(fid, r, title));
    for (const m of members) m.frameId = fid;
  }
  const notes = [tx('muralNoSizes')];
  return { drafts: [...frames, ...stickies], images: [], tags, report: { source: 'Mural', imported: frames.length + stickies.length, skipped: skips.list(), notes } };
}
