// A Miro board read through Miro's REST API (#62; the server's modules/importers answers it as
// @freero/shared MiroImportResponse) → Freero element drafts. Implemented from Miro's documented
// REST API v2 item model; nothing of Miro's code is used. Untrusted input: every string Miro holds
// (sticky content is HTML) becomes plain text, every number is range-checked. Pure: no editor, no DOM.
import {
  cardDraft,
  connectorDraft,
  frameDraft,
  MIRO_MAX_IMAGES,
  MIRO_MAX_ITEMS,
  shapeDraft,
  stickyDraft,
  textDraft,
  type CapStyle,
  type ElementDraft,
  type MiroConnector,
  type MiroImportResponse,
  type MiroItem,
  type Rect,
  type ShapeKind,
  type StickyColor,
} from '@freero/shared';
import { attachedEnd, color, coord, htmlToPlain, imageDraft, lineBox, nearestSticky, richLabel, size, Skips, type ImportResult } from './common';

import { t as tx } from '../messages';

/** Miro's sticky colour names → the nearest Freero paper. */
const STICKY: Record<string, StickyColor> = {
  gray: 'gray',
  light_yellow: 'yellow',
  yellow: 'lemon',
  orange: 'orange',
  light_green: 'lime',
  green: 'green',
  dark_green: 'pine',
  cyan: 'cyan',
  light_pink: 'pink',
  pink: 'magenta',
  violet: 'violet',
  red: 'coral',
  light_blue: 'blue',
  blue: 'royal',
  dark_blue: 'navy',
  black: 'charcoal',
  white: 'white',
};

const SHAPES: Record<string, ShapeKind> = {
  rectangle: 'rect',
  round_rectangle: 'roundRect',
  circle: 'ellipse',
  triangle: 'triangle',
  rhombus: 'diamond',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  pentagon: 'pentagon',
  hexagon: 'hexagon',
  octagon: 'octagon',
  star: 'star',
  cross: 'cross',
  right_arrow: 'arrowRight',
  left_arrow: 'arrowLeft',
  cloud: 'cloud',
  can: 'cylinder',
  wedge_round_rectangle_callout: 'speech',
  flow_chart_process: 'rect',
  flow_chart_decision: 'diamond',
  flow_chart_terminator: 'terminator',
  flow_chart_document: 'document',
  flow_chart_multidocuments: 'multiDocument',
  flow_chart_predefined_process: 'predefinedProcess',
  flow_chart_magnetic_disk: 'cylinder',
  flow_chart_manual_input: 'manualInput',
  flow_chart_manual_operation: 'manualOperation',
  flow_chart_delay: 'delay',
  flow_chart_display: 'display',
  flow_chart_off_page_connector: 'offPageRef',
  flow_chart_merge: 'merge',
  flow_chart_internal_storage: 'internalStorage',
  flow_chart_punched_tape: 'punchedTape',
  flow_chart_collate: 'collate',
  flow_chart_sort: 'sort',
  flow_chart_summing_junction: 'summingJunction',
  flow_chart_or: 'orJunction',
  flow_chart_connector: 'ellipse',
  flow_chart_input_output: 'parallelogram',
  flow_chart_preparation: 'hexagon',
  flow_chart_card: 'punchedCard',
  flow_chart_online_storage: 'storedData',
};

const CAPS: Record<string, CapStyle> = {
  none: 'none',
  stealth: 'arrow',
  rounded_stealth: 'arrow',
  arrow: 'arrow',
  filled_triangle: 'triangle',
  triangle: 'triangleOpen',
  filled_diamond: 'diamond',
  diamond: 'diamondOpen',
  filled_oval: 'circle',
  oval: 'circleOpen',
  erd_one: 'one',
  erd_only_one: 'one',
  erd_many: 'many',
  erd_one_or_many: 'oneOrMany',
  erd_zero_or_many: 'zeroOrMany',
  erd_zero_or_one: 'zeroOrOne',
};

const plain = (html: string | undefined, max = 5000) => htmlToPlain(html ?? '').slice(0, max);
const align = (a: string | undefined) => (a === 'left' || a === 'right' ? a : 'center');
const font = (n: number | undefined, d: number) => Math.round(Math.max(8, Math.min(200, n ?? d)));
const SAFE_LINK = /^https?:\/\//i;

/**
 * Turns a Miro board into Freero drafts: frames → frames holding their children, sticky notes →
 * stickies (square or rectangle, the nearest paper, tags), shapes → the nearest Freero shape with
 * their text and style, text → text boxes, cards → cards (due date, tags), app cards → plain cards,
 * images → the copies the server stored, connectors → connectors attached at both ends (routing,
 * dashes, line ends, the first caption). Embeds and link previews become cards linking to the page;
 * what Miro's API can't give (comments) and what has no counterpart is in the report.
 */
export function parseMiro(board: MiroImportResponse, newId: () => string): ImportResult {
  const skips = new Skips();
  const notes: string[] = [];
  const items = board.items.slice(0, MIRO_MAX_ITEMS);
  const drafts: ElementDraft[] = [];
  const tags: NonNullable<ImportResult['tags']> = [];
  const idOf = new Map<string, string>();
  const rectOf = new Map<string, Rect>();
  const tagName = new Map(board.tags.map((t) => [t.id, plain(t.title, 40)]));
  const byId = new Map(items.map((i) => [i.id, i]));

  // Board coordinates of an item's box: Miro gives centres, a frame's children from its top left.
  const boxOf = (it: MiroItem, w: number, h: number): Rect => {
    let cx = coord(it.x);
    let cy = coord(it.y);
    const parent = it.parentId ? byId.get(it.parentId) : undefined;
    if (parent) {
      cx += coord(parent.x) - size(parent.w ?? 0, 0) / 2;
      cy += coord(parent.y) - size(parent.h ?? 0, 0) / 2;
    }
    return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) };
  };
  const frameOf = (it: MiroItem) => {
    const parent = it.parentId ? byId.get(it.parentId) : undefined;
    return parent?.type === 'frame' ? idOf.get(parent.id) : undefined;
  };
  const tagsOf = (id: string, it: MiroItem) => {
    const names = (it.tagIds ?? []).map((t) => tagName.get(t)).filter((n): n is string => !!n);
    if (names.length) tags.push({ id, names });
  };

  // Frames first (they hold the rest), then everything in Miro's order.
  const ordered = [...items.filter((i) => i.type === 'frame'), ...items.filter((i) => i.type !== 'frame')];
  for (const it of ordered) {
    const id = newId();
    const frameId = it.type === 'frame' ? undefined : frameOf(it);
    let d: ElementDraft | null = null;
    switch (it.type) {
      case 'frame': {
        const r = boxOf(it, size(it.w ?? 800, 20), size(it.h ?? 600, 20));
        d = { ...frameDraft(id, r, plain(it.content, 200) || tx('frame')), fill: color(it.fill, '#FFFFFF') } as ElementDraft;
        break;
      }
      case 'sticky_note': {
        const w = size(it.w ?? 200, 40);
        const shape = it.shape === 'rectangle' ? 'rect' : 'square';
        const h = shape === 'rect' ? Math.round(w / 1.5) : w;
        const r = boxOf(it, w, h);
        d = { ...stickyDraft(id, r.x, r.y, plain(it.content), STICKY[it.fill ?? ''] ?? nearestSticky(it.fill), { w: r.w, h: r.h }, frameId), align: align(it.textAlign) } as ElementDraft;
        tagsOf(id, it);
        break;
      }
      case 'shape': {
        const kind = SHAPES[it.shape ?? 'rectangle'];
        if (!kind) skips.add(tx('replaceShapesDrawnAsRectangles', { replace: (it.shape ?? '').replace(/_/g, ' ').slice(0, 40) }));
        const r = boxOf(it, size(it.w ?? 160, 4), size(it.h ?? 100, 4));
        const fill = color(it.fill, '#FFFFFF');
        d = {
          ...shapeDraft(id, kind ?? 'rect', r, '', { fill, stroke: color(it.border, '#1A1A1A'), strokeWidth: Math.max(0, Math.min(24, it.borderWidth ?? 2)), fontSize: font(it.fontSize, 16) }, frameId),
          text: richLabel(plain(it.content)),
          fillOpacity: fill === 'transparent' ? 0 : 1,
          strokeStyle: it.borderStyle === 'dashed' ? 'dashed' : it.borderStyle === 'dotted' ? 'dotted' : 'solid',
          textColor: color(it.color, '#1A1A1A'),
          align: align(it.textAlign),
        } as ElementDraft;
        break;
      }
      case 'text': {
        const text = plain(it.content);
        if (!text.trim()) continue;
        const fontSize = font(it.fontSize, 18);
        const w = size(it.w ?? 300, 20);
        const est = textDraft(id, 0, 0, w, text, { size: fontSize, color: color(it.color, '#1A1A1A') }, frameId);
        const r = boxOf(it, w, est.h);
        d = { ...est, x: r.x, y: r.y, align: it.textAlign === 'center' || it.textAlign === 'right' ? it.textAlign : 'left', background: color(it.fill, 'transparent') } as ElementDraft;
        break;
      }
      case 'card':
      case 'app_card': {
        if (it.type === 'app_card') skips.add(tx('miroAppCards'));
        const w = size(it.w ?? 320, 120);
        const fill = color(it.fill, '');
        const c = cardDraft({ text: plain(it.content, 500) || tx('untitledCard'), description: plain(it.description), dueDate: it.dueDate ?? null, ...(/^#[0-9A-F]{6}$/.test(fill) ? { color: fill } : {}) }, id, 0, 0, Math.round(w), frameId ?? null);
        const r = boxOf(it, c.w, c.h);
        d = { ...c, x: r.x, y: r.y } as ElementDraft;
        tagsOf(id, it);
        break;
      }
      case 'image': {
        if (!it.image) {
          skips.add(tx('imagesThatCouldnTBe'));
          break;
        }
        const w = size(it.w ?? it.image.w, 4);
        const h = size(it.h ?? (it.image.h * w) / Math.max(1, it.image.w), 4);
        const r = boxOf(it, w, h);
        d = { ...imageDraft(id, r, 0, plain(it.content, 200)), src: it.image.url, naturalW: it.image.w, naturalH: it.image.h, ...(frameId ? { frameId } : {}) } as ElementDraft;
        break;
      }
      case 'embed':
      case 'preview': {
        if (!it.link || !SAFE_LINK.test(it.link) || it.link.length > 2000) {
          skips.add(tx('sliceItemsLeftOut', { slice: it.type }));
          break;
        }
        skips.add(tx('miroEmbeds'));
        const c = cardDraft({ text: it.link.slice(0, 300), link: it.link }, id, 0, 0, 320, frameId ?? null);
        const r = boxOf(it, c.w, c.h);
        d = { ...c, x: r.x, y: r.y } as ElementDraft;
        break;
      }
      case 'document':
        skips.add(tx('miroDocuments'));
        break;
      default:
        skips.add(tx('sliceItemsLeftOut', { slice: it.type.replace(/_/g, ' ').slice(0, 40) }));
    }
    if (!d) continue;
    if (it.rotation && d.type !== 'frame' && d.type !== 'card') d.rotation = Math.round(it.rotation * 100) / 100;
    idOf.set(it.id, id);
    rectOf.set(it.id, { x: d.x, y: d.y, w: d.w, h: d.h });
    drafts.push(d);
  }

  for (const c of board.connectors.slice(0, MIRO_MAX_ITEMS)) {
    const d = connectorOf(c, newId(), idOf, rectOf, skips);
    if (d) drafts.push(d);
  }

  if (board.truncated) notes.push(tx('miroTruncated', { n: MIRO_MAX_ITEMS }));
  if (board.imagesOverCap > 0) skips.add(tx('miroPicturesOverCap', { n: MIRO_MAX_IMAGES }), board.imagesOverCap);
  notes.push(tx('miroNoComments'));
  return { drafts, images: [], tags, report: { source: 'Miro', imported: drafts.length, skipped: skips.list(), notes } };
}

function connectorOf(c: MiroConnector, id: string, idOf: Map<string, string>, rectOf: Map<string, Rect>, skips: Skips): ElementDraft | null {
  const from = c.from ? idOf.get(c.from) : undefined;
  const to = c.to ? idOf.get(c.to) : undefined;
  if (!from || !to) {
    skips.add(tx('looseLinesLeftOut'));
    return null;
  }
  const a = attachedEnd(from, rectOf.get(c.from!)!, c.fromAt ?? null);
  const b = attachedEnd(to, rectOf.get(c.to!)!, c.toAt ?? null);
  const cap = (v: string | undefined, d: CapStyle): CapStyle => {
    if (!v) return d;
    const known = CAPS[v];
    if (!known) skips.add(tx('lineEndsDrawnAsThe'));
    return known ?? 'arrow';
  };
  return {
    ...connectorDraft(id, { point: { x: 0, y: 0 } }, { point: { x: 0, y: 0 } }),
    ...lineBox(a, b),
    start: a,
    end: b,
    routing: c.shape === 'elbowed' ? 'elbow' : c.shape === 'curved' ? 'curved' : 'straight',
    stroke: color(c.color, '#2B2A44'),
    strokeWidth: Math.max(1, Math.min(24, c.width ?? 2)),
    strokeStyle: c.style === 'dashed' ? 'dashed' : c.style === 'dotted' ? 'dotted' : 'solid',
    startCap: cap(c.startCap, 'none'),
    endCap: cap(c.endCap, 'arrow'),
    label: richLabel(htmlToPlain(c.caption).slice(0, 500)),
    waypoints: [],
  } as ElementDraft;
}
