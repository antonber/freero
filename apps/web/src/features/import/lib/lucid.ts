// Lucid's own "CSV of Shape Data" export, from Lucidspark or Lucidchart (#165; docs/design/importers.md:
// Lucid's API terms couldn't be read, and its API has no positions either) → Freero drafts. The
// header Lucid writes: Id, Name, Shape Library, Page ID, Contained By, Group, Line Source, Line
// Destination, Source Arrow, Destination Arrow, Status, Text Area 1 … n, Comments, then any custom
// data. Rows named Document / Page describe the file; lines name the shapes at their ends;
// "Contained By" names a shape's container (a Lucidspark frame, a container, a swim lane).
// The export has no positions, sizes or colours: everything is laid out here — connected shapes in
// layers left to right (@freero/shared `layered`), the rest in a grid below, each container's
// content inside its frame, pages side by side. Untrusted input: every cell becomes plain text. Pure.
import {
  connectorDraft,
  frameDraft,
  layered,
  measureText,
  shapeDraft,
  STICKY_SIZE,
  stickyDraft,
  textDraft,
  type CapStyle,
  type ElementDraft,
  type ShapeKind,
} from '@freero/shared';
import { attachedEnd, htmlToPlain, ImportError, lineBox, MAX_ITEMS, richLabel, Skips, type ImportResult } from './common';
import { columns, csvRows, headerOf } from './csvRows';

import { t as tx } from '../messages';

const GAP = 48;
const RANK_GAP = 120;
const FRAME_PAD = 48;
const FRAME_TITLE = 56;
const PAGE_GAP = 240;

/** Looks like Lucid's CSV of shape data (by its header). */
export function looksLikeLucid(text: string): boolean {
  const h = headerOf(text);
  return ['id', 'name', 'shape library', 'page id', 'line source', 'line destination'].every((c) => h.includes(c));
}

type Kind = 'sticky' | 'text' | 'shape' | 'container' | 'image';
interface Node {
  key: string;
  id: string;
  name: string;
  kind: Kind;
  shape: ShapeKind;
  text: string;
  page: string;
  parent: string | null;
  group: string;
  tags: string[];
  /** Laid out: top left, relative to its parent's content box. */
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Line {
  from: string;
  to: string;
  text: string;
  startCap: CapStyle;
  endCap: CapStyle;
}

/** The nearest Freero shape to a Lucid shape name ("Process", "Decision", "Terminator", …); null: drawn as a rectangle. */
function shapeOf(name: string): ShapeKind | null {
  const n = name.toLowerCase();
  const pairs: Array<[RegExp, ShapeKind]> = [
    [/decision|diamond|rhomb/, 'diamond'],
    [/terminator|stadium|pill/, 'terminator'],
    [/circle|ellipse|oval|connector/, 'ellipse'],
    [/multiple documents|multi.?doc/, 'multiDocument'],
    [/document/, 'document'],
    [/database|cylinder|stored data|disk/, 'cylinder'],
    [/predefined process|subroutine/, 'predefinedProcess'],
    [/manual input/, 'manualInput'],
    [/manual operation/, 'manualOperation'],
    [/delay/, 'delay'],
    [/display/, 'display'],
    [/off.?page/, 'offPageRef'],
    [/merge/, 'merge'],
    [/internal storage/, 'internalStorage'],
    [/data|input|output|parallelogram/, 'parallelogram'],
    [/preparation|hexagon/, 'hexagon'],
    [/triangle/, 'triangle'],
    [/pentagon/, 'pentagon'],
    [/octagon/, 'octagon'],
    [/star/, 'star'],
    [/cloud/, 'cloud'],
    [/cross|plus/, 'cross'],
    [/callout|speech/, 'speech'],
    [/actor|stick figure/, 'umlActor'],
    [/note/, 'umlNote'],
    [/rounded/, 'roundRect'],
    [/process|rectangle|block|square|card/, 'rect'],
  ];
  return pairs.find(([re]) => re.test(n))?.[1] ?? null;
}

const capOf = (v: string, d: CapStyle): CapStyle => {
  const s = v.trim().toLowerCase();
  if (!s) return d;
  if (s === 'none') return 'none';
  if (/hollow|open/.test(s)) return 'triangleOpen';
  if (/diamond/.test(s)) return 'diamond';
  if (/circle|dot/.test(s)) return 'circle';
  if (/zero or many/.test(s)) return 'zeroOrMany';
  if (/one or many/.test(s)) return 'oneOrMany';
  if (/many/.test(s)) return 'many';
  if (/one/.test(s)) return 'one';
  return 'arrow';
};

/** Boxes laid out in a grid of about square proportions, from (0, 0). */
function grid(boxes: Node[], gap: number): { w: number; h: number } {
  if (!boxes.length) return { w: 0, h: 0 };
  const cols = Math.max(1, Math.ceil(Math.sqrt(boxes.length)));
  let x = 0;
  let y = 0;
  let rowH = 0;
  let w = 0;
  boxes.forEach((b, i) => {
    if (i && i % cols === 0) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    b.x = x;
    b.y = y;
    x += b.w + gap;
    rowH = Math.max(rowH, b.h);
    w = Math.max(w, x - gap);
  });
  return { w, h: y + rowH };
}

export function parseLucid(text: string, newId: () => string): ImportResult {
  const rows = csvRows(text);
  const head = rows[0] ?? [];
  const col = columns(head);
  if (!['id', 'name', 'line source', 'line destination'].every((c) => col.has(c))) throw new ImportError(tx('notALucidCsv'));
  const body = rows.slice(1);
  if (body.length > MAX_ITEMS * 2) throw new ImportError(tx('tooManyRows', { n: body.length, max: MAX_ITEMS }));
  const textCols = head.map((h, i) => (/^text area \d+$/i.test(h.trim()) ? i : -1)).filter((i) => i >= 0);
  const cell = (r: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? '' : (r[i] ?? '').trim();
  };
  const textOf = (r: string[]) =>
    htmlToPlain(
      textCols
        .map((i) => r[i] ?? '')
        .filter((t) => t.trim())
        .join('\n'),
    ).slice(0, 5000);
  const skips = new Skips();
  const pages = new Map<string, string>();
  const nodes = new Map<string, Node>();
  const lines: Line[] = [];
  let comments = 0;
  const raw: string[][] = [];
  for (const r of body) {
    const name = cell(r, 'name');
    const id = cell(r, 'id');
    if (!id) continue;
    if (cell(r, 'comments')) comments++;
    if (name === 'Document') continue;
    if (name === 'Page') pages.set(id, textOf(r) || tx('page', { n: pages.size + 1 }));
    else if (cell(r, 'line source') || cell(r, 'line destination') || name === 'Line') {
      if (!cell(r, 'line source') || !cell(r, 'line destination')) {
        skips.add(tx('looseLinesLeftOut'));
        continue;
      }
      lines.push({ from: cell(r, 'line source'), to: cell(r, 'line destination'), text: textOf(r), startCap: capOf(cell(r, 'source arrow'), 'none'), endCap: capOf(cell(r, 'destination arrow'), 'arrow') });
    } else raw.push(r);
  }
  // A shape something else is contained by is a container, whatever its name.
  const containers = new Set(raw.map((r) => cell(r, 'contained by').split(/[,;\s]+/)[0]).filter(Boolean));
  for (const r of raw) {
    const id = cell(r, 'id');
    const name = cell(r, 'name');
    const library = cell(r, 'shape library');
    const txt = textOf(r);
    let kind: Kind = 'shape';
    if (containers.has(id) || /frame|container|swim ?lane|pool|lane/i.test(name)) kind = 'container';
    else if (/sticky/i.test(name)) kind = 'sticky';
    else if (/^text$/i.test(name)) kind = 'text';
    else if (/image|picture|photo/i.test(name) || /images/i.test(library)) kind = 'image';
    const shape = kind === 'shape' ? shapeOf(name) : 'rect';
    if (kind === 'shape' && !shape) skips.add(tx('replaceShapesDrawnAsRectangles', { replace: name.slice(0, 40) }));
    if (kind === 'image') {
      skips.add(tx('imagesWhosePictureIsnT'));
      continue;
    }
    if (kind === 'shape' && !txt && /^(line|arrow)$/i.test(name)) continue;
    const tags = cell(r, 'tags')
      .split(/[;,|]/)
      .map((t) => htmlToPlain(t).trim().slice(0, 40))
      .filter(Boolean);
    nodes.set(id, { key: id, id: newId(), name, kind, shape: shape ?? 'rect', text: txt, page: cell(r, 'page id'), parent: cell(r, 'contained by').split(/[,;\s]+/)[0] || null, group: cell(r, 'group'), tags, x: 0, y: 0, w: 0, h: 0 });
  }
  if (nodes.size > MAX_ITEMS) throw new ImportError(tx('tooManyRows', { n: nodes.size, max: MAX_ITEMS }));
  if (!nodes.size) throw new ImportError(tx('nothingInThisFile'));
  // A parent that isn't in the file (or contains itself, directly or not) is no parent.
  for (const n of nodes.values()) {
    const seen = new Set([n.key]);
    for (let p = n.parent; p; p = nodes.get(p)?.parent ?? null) {
      if (!nodes.has(p) || seen.has(p)) {
        n.parent = null;
        break;
      }
      seen.add(p);
    }
  }
  const children = new Map<string | null, Node[]>();
  for (const n of nodes.values()) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);

  // Sizes of leaves; containers get theirs from their content.
  for (const n of nodes.values()) {
    if (n.kind === 'sticky') [n.w, n.h] = [STICKY_SIZE, STICKY_SIZE];
    else if (n.kind === 'text') {
      const m = measureText(n.text || ' ', { fontSize: 18, maxWidth: 360 });
      [n.w, n.h] = [Math.max(80, Math.min(360, m.w + 8)), m.h + 8];
    } else if (n.kind === 'shape') {
      const m = measureText(n.text || ' ', { fontSize: 16, maxWidth: 260 });
      [n.w, n.h] = [Math.max(160, Math.min(300, m.w + 56)), Math.max(80, m.h + 40)];
    }
  }
  // The child of `group` (null: the page) that `key` sits in, if any.
  const unitIn = (key: string, within: Set<string>): string | null => {
    for (let k: string | null = key; k; k = nodes.get(k)?.parent ?? null) if (within.has(k)) return k;
    return null;
  };
  /** Lays out `list` (siblings) from (0, 0): connected ones in layers, the rest in a grid below. */
  const layoutSiblings = (list: Node[]): { w: number; h: number } => {
    for (const n of list) if (n.kind === 'container') contain(n);
    const keys = new Set(list.map((n) => n.key));
    const edges = new Map<string, { from: string; to: string }>();
    for (const l of lines) {
      const a = unitIn(l.from, keys);
      const b = unitIn(l.to, keys);
      if (a && b && a !== b) edges.set(`${a}>${b}`, { from: a, to: b });
    }
    const linked = list.filter((n) => [...edges.values()].some((e) => e.from === n.key || e.to === n.key));
    const loose = list.filter((n) => !linked.includes(n));
    let w = 0;
    let h = 0;
    if (linked.length) {
      const res = layered(
        linked.map((n) => ({ id: n.key, w: n.w, h: n.h })),
        [...edges.values()],
        { direction: 'LR', nodeSep: GAP, rankSep: RANK_GAP },
      );
      for (const n of linked) {
        const p = res.pos.get(n.key) ?? { x: 0, y: 0 };
        n.x = p.x;
        n.y = p.y;
      }
      w = res.w;
      h = res.h + GAP * 2;
    }
    const g = grid(loose, GAP);
    for (const n of loose) n.y += h;
    return { w: Math.max(w, g.w), h: h + g.h };
  };
  function contain(n: Node) {
    const inner = layoutSiblings(children.get(n.key) ?? []);
    n.w = Math.max(320, inner.w + FRAME_PAD * 2);
    n.h = Math.max(200, inner.h + FRAME_TITLE + FRAME_PAD);
  }

  // Pages side by side; each page's top-level items laid out on their own.
  const drafts: ElementDraft[] = [];
  const tags: NonNullable<ImportResult['tags']> = [];
  const rectOf = new Map<string, { x: number; y: number; w: number; h: number; id: string }>();
  const pageKeys = [...new Set([...nodes.values()].filter((n) => !n.parent).map((n) => n.page))];
  const framed = pageKeys.length > 1;
  const groupIds = new Map<string, string>();
  let px = 0;
  const emit = (n: Node, ox: number, oy: number, frameId: string | null) => {
    const x = Math.round(ox + n.x);
    const y = Math.round(oy + n.y);
    let d: ElementDraft;
    if (n.kind === 'container') d = frameDraft(n.id, { x, y, w: n.w, h: n.h }, n.text.split('\n')[0].slice(0, 200) || n.name.slice(0, 200) || tx('frame'));
    else if (n.kind === 'sticky') d = stickyDraft(n.id, x, y, n.text, 'yellow', STICKY_SIZE);
    else if (n.kind === 'text') d = { ...textDraft(n.id, x, y, n.w, n.text), autoWidth: false } as ElementDraft;
    else d = { ...shapeDraft(n.id, n.shape, { x, y, w: n.w, h: n.h }, ''), text: richLabel(n.text) } as ElementDraft;
    if (frameId && d.type !== 'frame') d.frameId = frameId;
    if (n.group && d.type !== 'frame') {
      if (!groupIds.has(n.group)) groupIds.set(n.group, newId());
      d.groupId = groupIds.get(n.group)!;
    }
    drafts.push(d);
    rectOf.set(n.key, { x, y, w: n.w, h: n.h, id: n.id });
    if (n.tags.length && (d.type === 'sticky' || d.type === 'card')) tags.push({ id: n.id, names: n.tags });
    if (n.kind === 'container') for (const c of children.get(n.key) ?? []) emit(c, x + FRAME_PAD, y + FRAME_TITLE, n.id);
  };
  // Frames are created before what they hold (containers emit themselves, then their content).
  for (const page of pageKeys) {
    const top = [...nodes.values()].filter((n) => !n.parent && n.page === page);
    const size = layoutSiblings(top);
    if (framed) {
      const fid = newId();
      drafts.push(frameDraft(fid, { x: px, y: 0, w: size.w + FRAME_PAD * 2, h: size.h + FRAME_TITLE + FRAME_PAD }, (pages.get(page) ?? tx('page', { n: pageKeys.indexOf(page) + 1 })).slice(0, 200)));
      for (const n of top) emit(n, px + FRAME_PAD, FRAME_TITLE, fid);
      px += size.w + FRAME_PAD * 2 + PAGE_GAP;
    } else {
      for (const n of top) emit(n, px, 0, null);
      px += size.w + PAGE_GAP;
    }
  }
  // Frames below everything else (they hold it), in the order they were made.
  drafts.sort((a, b) => (a.type === 'frame' ? 0 : 1) - (b.type === 'frame' ? 0 : 1));

  for (const l of lines) {
    const a = rectOf.get(l.from);
    const b = rectOf.get(l.to);
    if (!a || !b) {
      skips.add(tx('looseLinesLeftOut'));
      continue;
    }
    const s = attachedEnd(a.id, a, null);
    const e = attachedEnd(b.id, b, null);
    drafts.push({
      ...connectorDraft(newId(), { point: { x: 0, y: 0 } }, { point: { x: 0, y: 0 } }),
      ...lineBox(s, e),
      start: s,
      end: e,
      routing: 'elbow',
      startCap: l.startCap,
      endCap: l.endCap,
      label: richLabel(l.text.slice(0, 500)),
      waypoints: [],
    } as ElementDraft);
  }
  if (comments) skips.add(tx('commentsNotImported'), comments);
  const notes = [tx('lucidNoPositions')];
  return { drafts, images: [], tags, report: { source: 'Lucid', imported: drafts.length, skipped: skips.list(), notes } };
}
