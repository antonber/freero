// What both importers share: the result they build (Freero element drafts in the source file's
// coordinates, images still to upload, a report of what could not be mapped), and small helpers.
// Pure: no editor, no DOM — the parsers run in tests as they run on the board.
import { plainToRichText, type Anchor, type ConnectorEndpoint, type ElementDraft, type Rect } from '@freero/shared';

/** Whole files this large or larger are refused before they are read. */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** A compressed draw.io page may unpack to this much at most (zip bombs). */
export const MAX_UNPACKED_BYTES = 30 * 1024 * 1024;
/** Items one import may create (the same cap as text-built structure). */
export const MAX_ITEMS = 2000;

export type SourceTool = 'draw.io' | 'Excalidraw';

export interface ImportReport {
  source: SourceTool;
  /** Items created on the board. */
  imported: number;
  /** What could not be mapped (or was simplified), with how often. */
  skipped: Array<{ what: string; count: number }>;
}

export interface ImportResult {
  /** In stacking order (first = bottom), coordinates as in the file. */
  drafts: ElementDraft[];
  /** Image drafts whose picture must be stored first: a data: URL or an http(s) URL. */
  images: Array<{ id: string; source: string }>;
  report: ImportReport;
}

/** A file we refuse, with a message for the person. Nothing is added. */
export class ImportError extends Error {}

/** Counts what was skipped, by description. */
export class Skips {
  private counts = new Map<string, number>();
  add(what: string, n = 1): void {
    this.counts.set(what, (this.counts.get(what) ?? 0) + n);
  }
  list(): ImportReport['skipped'] {
    return [...this.counts].map(([what, count]) => ({ what, count }));
  }
}

const NAMED: Record<string, string> = { black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', gray: '#808080', grey: '#808080', yellow: '#FFFF00', orange: '#FFA500' };

/** A CSS colour we store as is (#rgb / #rrggbb, a few names), 'transparent', or `fallback`. */
export function color(v: string | null | undefined, fallback: string): string {
  if (!v) return fallback;
  const s = v.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return 'transparent';
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(s)) return s.toUpperCase();
  return NAMED[s] ?? fallback;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text of an HTML label (line breaks kept, tags and scripts dropped, entities decoded). Never HTML. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Rich text of a plain label, bold / italic / underlined as a whole when asked. */
export function richLabel(text: string, style: { bold?: boolean; italic?: boolean; underline?: boolean } = {}): string {
  let html = plainToRichText(text.slice(0, 5000));
  if (!html) return '';
  if (style.underline) html = `<u>${html}</u>`;
  if (style.italic) html = `<i>${html}</i>`;
  if (style.bold) html = `<b>${html}</b>`;
  return html;
}

const finite = (n: unknown, d = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
/** A coordinate we accept from a file (finite, within a sane range). */
export const coord = (n: unknown): number => Math.max(-1e7, Math.min(1e7, finite(n)));
export const size = (n: unknown, min = 1): number => Math.max(min, Math.min(1e6, finite(n, min)));

/** The side of `r` nearest to `p` (older clients attach a line end there). */
export function nearestSide(r: Rect, p: { x: number; y: number }): Exclude<Anchor, 'auto'> {
  const d = { top: Math.abs(p.y - r.y), bottom: Math.abs(p.y - (r.y + r.h)), left: Math.abs(p.x - r.x), right: Math.abs(p.x - (r.x + r.w)) };
  return (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => (d[a] <= d[b] ? a : b));
}

/**
 * A line end attached to `id` (box `r`): at the spot `uv` (fractions of the box) when the file
 * says where, else wherever faces the other end ('auto').
 */
export function attachedEnd(id: string, r: Rect, uv: { u: number; v: number } | null): ConnectorEndpoint {
  if (!uv) return { elementId: id, anchor: 'auto', x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
  const u = Math.max(0, Math.min(1, uv.u));
  const v = Math.max(0, Math.min(1, uv.v));
  const p = { x: r.x + u * r.w, y: r.y + v * r.h };
  return { elementId: id, anchor: nearestSide(r, p), at: { u, v }, x: Math.round(p.x), y: Math.round(p.y) };
}

export const freeEnd = (p: { x: number; y: number }): ConnectorEndpoint => ({ elementId: null, x: Math.round(p.x), y: Math.round(p.y) });

/** The bounding box of a connector's ends (its stored x/y/w/h). */
export function lineBox(a: ConnectorEndpoint, b: ConnectorEndpoint): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(1, Math.max(a.x, b.x) - x), h: Math.max(1, Math.max(a.y, b.y) - y) };
}

/** A pen stroke through `pts` (world points, pressure 0..1). */
export function penDraft(id: string, pts: Array<{ x: number; y: number; p: number }>, stroke: string, strokeWidth: number): ElementDraft | null {
  if (pts.length < 2) return null;
  const x = Math.min(...pts.map((p) => p.x));
  const y = Math.min(...pts.map((p) => p.y));
  const w = Math.max(1, Math.max(...pts.map((p) => p.x)) - x);
  const h = Math.max(1, Math.max(...pts.map((p) => p.y)) - y);
  return {
    id,
    type: 'pen',
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w) || 1,
    h: Math.round(h) || 1,
    rotation: 0,
    points: pts.flatMap((p) => [Math.round((p.x - x) * 10) / 10, Math.round((p.y - y) * 10) / 10, Math.max(0, Math.min(1, p.p))]),
    stroke,
    strokeWidth: Math.max(1, Math.min(48, strokeWidth)),
    highlighter: false,
    baseW: Math.round(w) || 1,
    baseH: Math.round(h) || 1,
  };
}

/** An image to be filled in once its picture is stored. */
export function imageDraft(id: string, r: Rect, rotation: number, alt: string): ElementDraft {
  return { id, type: 'image', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), rotation, src: '', naturalW: Math.round(r.w), naturalH: Math.round(r.h), alt };
}

/** Pictures we store: data: URLs of raster images / SVG, or http(s) URLs the server fetches. */
export function imageSource(src: string | null | undefined): string | null {
  if (!src) return null;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return src;
  return null;
}

/** Bounding box of drafts. */
export function boundsOf(drafts: ElementDraft[]): Rect {
  if (!drafts.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...drafts.map((d) => d.x));
  const y = Math.min(...drafts.map((d) => d.y));
  return { x, y, w: Math.max(...drafts.map((d) => d.x + d.w)) - x, h: Math.max(...drafts.map((d) => d.y + d.h)) - y };
}
