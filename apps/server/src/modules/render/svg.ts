// A board drawn as SVG on the server (#33), from the shared element model alone: no browser, no
// DOM. Each element type is drawn by its own small function below, close to how the app draws it
// (same colours, same proportions), with text wrapped by the shared layout kit's metrics and set in
// the server's font (Inter). What a picture can't show (a video playing, a live embed) is drawn as
// its card. Types without a drawing here fall back to a labelled box, so nothing is ever silently
// missing from the picture.
//
// Pure: the caller hands it the elements (as the reader may see them), the board's collections
// (table cells) and the pictures it may embed (data: URLs by upload URL); nothing is fetched here.
import {
  CHART_CELLS,
  ICON_DEFAULT_VIEWBOX,
  cleanIconNodes,
  cleanViewBox,
  STICKY_COLORS,
  readChart,
  richTextToPlain,
  rotatedBounds,
  tableCellKey,
  unionRects,
  wrapLines,
  type BoardElement,
  type CardElement,
  type ChartElement,
  type EmojiElement,
  type ConnectorElement,
  type EmbedElement,
  type FrameElement,
  type IconElement,
  type ImageElement,
  type KanbanElement,
  type MindmapElement,
  type PenElement,
  type Rect,
  type ShapeElement,
  type StickyElement,
  type TableElement,
  type TextElement,
} from '@freero/shared';

export interface SvgInput {
  elements: readonly BoardElement[];
  collection(name: string): ReadonlyMap<string, unknown>;
  /** A data: URL for an image source the caller read (uploads), or null: drawn as a placeholder. */
  imageData(src: string): string | null;
  /** Only this part of the board (world coordinates); default: everything, with a margin. */
  area?: Rect;
  background?: string;
}

const MARGIN = 40;
const FONT = 'Inter';
const INK = '#17162B';
const MUTED = '#6B6A85';
const LINE = '#D9D8E5';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : d);
/** A colour as SVG may take it (hex, rgb(), a name) — anything else is `fallback`. */
const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(v.trim()) ? v.trim() : fallback);
const plain = (v: unknown) => (typeof v === 'string' ? richTextToPlain(v) : '');

/** Text lines inside a box: wrapped, shrunk for 'auto' sizes until they fit, aligned. */
function textBlock(
  text: string,
  box: Rect,
  o: { size?: number | 'auto'; color?: string; align?: string; vAlign?: string; bold?: boolean; pad?: number; lineHeight?: number; maxSize?: number },
): string {
  if (!text.trim()) return '';
  const pad = o.pad ?? 12;
  const w = Math.max(4, box.w - pad * 2);
  const h = Math.max(4, box.h - pad * 2);
  const lh = o.lineHeight ?? 1.3;
  let size = typeof o.size === 'number' ? o.size : Math.min(o.maxSize ?? 28, 48);
  let lines = wrapLines(text, size, w, o.bold);
  if (o.size === 'auto' || o.size === undefined) {
    while (size > 8 && lines.length * size * lh > h) {
      size = Math.max(8, Math.floor(size * 0.88));
      lines = wrapLines(text, size, w, o.bold);
    }
  }
  const maxLines = Math.max(1, Math.floor(h / (size * lh)));
  if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]}…`];
  const total = lines.length * size * lh;
  const top = o.vAlign === 'top' ? box.y + pad : o.vAlign === 'bottom' ? box.y + box.h - pad - total : box.y + (box.h - total) / 2;
  const anchor = o.align === 'left' ? 'start' : o.align === 'right' ? 'end' : 'middle';
  const x = anchor === 'start' ? box.x + pad : anchor === 'end' ? box.x + box.w - pad : box.x + box.w / 2;
  const spans = lines.map((l, i) => `<tspan x="${n(x)}" y="${n(top + size * (i * lh + (lh + 0.7) / 2))}">${esc(l)}</tspan>`).join('');
  return `<text font-family="${FONT}" font-size="${size}"${o.bold ? ' font-weight="700"' : ''} fill="${color(o.color, INK)}" text-anchor="${anchor}">${spans}</text>`;
}

/** The outline of a shape kind in its box (the common ones; the rest read as a rounded box). */
function shapePath(kind: string, r: Rect): string {
  const { x, y, w, h } = r;
  const pts = (list: Array<[number, number]>) => `<polygon points="${list.map(([a, b]) => `${n(x + a * w)},${n(y + b * h)}`).join(' ')}"`;
  switch (kind) {
    case 'rect':
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"`;
    case 'ellipse':
    case 'cloud':
      return `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}"`;
    case 'triangle':
      return pts([[0.5, 0], [1, 1], [0, 1]]);
    case 'diamond':
      return pts([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case 'parallelogram':
      return pts([[0.2, 0], [1, 0], [0.8, 1], [0, 1]]);
    case 'trapezoid':
      return pts([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]);
    case 'pentagon':
      return pts([[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]]);
    case 'hexagon':
      return pts([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
    case 'octagon':
      return pts([[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]]);
    case 'star':
      return pts([[0.5, 0], [0.62, 0.38], [1, 0.38], [0.69, 0.6], [0.81, 1], [0.5, 0.76], [0.19, 1], [0.31, 0.6], [0, 0.38], [0.38, 0.38]]);
    case 'cross':
      return pts([[0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67], [0.67, 0.67], [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33]]);
    case 'arrowRight':
      return pts([[0, 0.25], [0.65, 0.25], [0.65, 0], [1, 0.5], [0.65, 1], [0.65, 0.75], [0, 0.75]]);
    case 'arrowLeft':
      return pts([[1, 0.25], [0.35, 0.25], [0.35, 0], [0, 0.5], [0.35, 1], [0.35, 0.75], [1, 0.75]]);
    case 'chevron':
      return pts([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1], [0.25, 0.5]]);
    case 'speech':
      return pts([[0, 0], [1, 0], [1, 0.75], [0.35, 0.75], [0.15, 1], [0.2, 0.75], [0, 0.75]]);
    case 'document':
      return `<path d="M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h * 0.85)}Q${n(x + w * 0.75)} ${n(y + h * 0.7)} ${n(x + w / 2)} ${n(y + h * 0.85)}T${n(x)} ${n(y + h * 0.85)}Z"`;
    case 'cylinder':
      return `<path d="M${n(x)} ${n(y + h * 0.1)}A${n(w / 2)} ${n(h * 0.1)} 0 0 1 ${n(x + w)} ${n(y + h * 0.1)}V${n(y + h * 0.9)}A${n(w / 2)} ${n(h * 0.1)} 0 0 1 ${n(x)} ${n(y + h * 0.9)}Z"`;
    case 'terminator':
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}"`;
    default:
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(w, h) * 0.12)}"`;
  }
}

const dash = (style: unknown, width: number) => (style === 'dashed' ? ` stroke-dasharray="${n(width * 4)} ${n(width * 3)}"` : style === 'dotted' ? ` stroke-dasharray="${n(width)} ${n(width * 2)}" stroke-linecap="round"` : '');

function sticky(el: StickyElement): string {
  const fill = STICKY_COLORS[el.color as keyof typeof STICKY_COLORS] ?? STICKY_COLORS.yellow;
  return (
    `<rect x="${n(el.x + 2)}" y="${n(el.y + 4)}" width="${n(el.w)}" height="${n(el.h)}" fill="#000" opacity="0.08" rx="3"/>` +
    `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="${fill}" rx="3"/>` +
    textBlock(plain(el.text), el, { size: el.fontSize, color: el.textColor, align: el.align, vAlign: el.vAlign, pad: el.w * 0.08 })
  );
}

function shape(el: ShapeElement): string {
  const fill = el.fill === 'transparent' ? 'none' : color(el.fill, '#FFFFFF');
  const sw = n(el.strokeWidth, 2);
  return (
    `${shapePath(el.shape, el)} fill="${fill}" fill-opacity="${n(el.fillOpacity, 1)}" stroke="${el.stroke === 'transparent' ? 'none' : color(el.stroke, INK)}" stroke-width="${sw}"${dash(el.strokeStyle, sw)}/>` +
    textBlock(plain(el.text), el, { size: el.fontSize, color: el.textColor, align: el.align, vAlign: el.vAlign })
  );
}

function text(el: TextElement): string {
  const bg = el.background && el.background !== 'transparent' ? `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="${color(el.background, 'none')}"/>` : '';
  return bg + textBlock(plain(el.text), el, { size: n(el.fontSize, 18), color: el.textColor, align: el.align ?? 'left', vAlign: 'top', pad: 4, lineHeight: 1.4 });
}

function frame(el: FrameElement): string {
  const title = (el.title ?? '').trim();
  return (
    `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="${color(el.fill, '#FFFFFF')}" stroke="${LINE}" stroke-width="1"/>` +
    (title ? `<text x="${n(el.x)}" y="${n(el.y - 10)}" font-family="${FONT}" font-size="16" font-weight="600" fill="${MUTED}">${esc(title.slice(0, 200))}</text>` : '')
  );
}

function card(el: CardElement): string {
  const pad = 16;
  const title = plain(el.title);
  const desc = plain(el.description);
  const head = wrapLines(title, 16, el.w - 40, true).length * 16 * 1.35;
  const status = el.status ? { todo: 'To do', doing: 'Doing', done: 'Done' }[el.status] : null;
  return (
    `<rect x="${n(el.x)}" y="${n(el.y + 2)}" width="${n(el.w)}" height="${n(el.h)}" rx="10" fill="#000" opacity="0.06"/>` +
    `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="10" fill="#FFFFFF" stroke="${LINE}"/>` +
    `<rect x="${n(el.x)}" y="${n(el.y)}" width="6" height="${n(el.h)}" rx="3" fill="${color(el.color, '#5B3FF0')}"/>` +
    textBlock(title, { x: el.x + 8, y: el.y + 4, w: el.w - 8, h: head + pad * 2 }, { size: 16, bold: true, align: 'left', vAlign: 'top', pad }) +
    (desc ? textBlock(desc, { x: el.x + 8, y: el.y + head + pad, w: el.w - 8, h: Math.max(0, el.h - head - pad - 34) }, { size: 14, color: MUTED, align: 'left', vAlign: 'top', pad }) : '') +
    (status ? `<text x="${n(el.x + 24)}" y="${n(el.y + el.h - 14)}" font-family="${FONT}" font-size="12" font-weight="600" fill="${MUTED}">${status}</text>` : '')
  );
}

function image(el: ImageElement, data: string | null): string {
  if (!data) return placeholder(el, el.alt || 'Picture');
  const crop = el.crop;
  const nw = Math.max(1, n(el.naturalW, el.w));
  const nh = Math.max(1, n(el.naturalH, el.h));
  const vb = crop ? `${n(crop.x * nw)} ${n(crop.y * nh)} ${n(crop.w * nw)} ${n(crop.h * nh)}` : `0 0 ${nw} ${nh}`;
  return `<svg x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" viewBox="${vb}" preserveAspectRatio="none"><image width="${nw}" height="${nh}" href="${esc(data)}" preserveAspectRatio="none"/></svg>`;
}

function embed(el: EmbedElement, data: string | null): string {
  const host = (() => {
    try {
      return new URL(el.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const imgH = data ? Math.min(el.h * 0.6, (el.w * 9) / 16) : 0;
  return (
    `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="10" fill="#FFFFFF" stroke="${LINE}"/>` +
    (data ? `<svg x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(imgH)}" preserveAspectRatio="xMidYMid slice" viewBox="0 0 ${n(el.w)} ${n(imgH)}"><image width="${n(el.w)}" height="${n(imgH)}" href="${esc(data)}" preserveAspectRatio="xMidYMid slice"/></svg>` : '') +
    textBlock(el.title ?? el.url, { x: el.x, y: el.y + imgH, w: el.w, h: Math.max(30, el.h - imgH - 24) }, { size: 15, bold: true, align: 'left', vAlign: 'top', pad: 14 }) +
    `<text x="${n(el.x + 14)}" y="${n(el.y + el.h - 12)}" font-family="${FONT}" font-size="12" fill="${MUTED}">${esc((el.siteName ?? host).slice(0, 80))}</text>`
  );
}

function pen(el: PenElement): string {
  const p = Array.isArray(el.points) ? el.points : [];
  const sx = el.baseW ? el.w / el.baseW : 1;
  const sy = el.baseH ? el.h / el.baseH : 1;
  const pts: string[] = [];
  for (let i = 0; i + 1 < p.length; i += 3) pts.push(`${n(el.x + p[i] * sx)},${n(el.y + p[i + 1] * sy)}`);
  if (pts.length < 2) return '';
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${color(el.stroke, INK)}" stroke-width="${n(el.strokeWidth, 3)}" stroke-linecap="round" stroke-linejoin="round"${el.highlighter ? ' opacity="0.4"' : ''}/>`;
}

function mindmap(el: MindmapElement): string {
  return (
    `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="${n(Math.min(el.h / 2, 18))}" fill="#FFFFFF" stroke="${color(el.color, '#5B3FF0')}" stroke-width="2"/>` +
    textBlock(plain(el.text), el, { size: 'auto', maxSize: 18, pad: 10 })
  );
}

function kanban(el: KanbanElement): string {
  const cols = Array.isArray(el.columns) ? el.columns : [];
  const colW = cols.length ? el.w / cols.length : el.w;
  return (
    `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="12" fill="#F4F3FA" stroke="${LINE}"/>` +
    textBlock(plain(el.title), { x: el.x, y: el.y, w: el.w, h: 40 }, { size: 16, bold: true, align: 'left', vAlign: 'middle', pad: 14 }) +
    cols
      .map((c, i) => {
        const x = el.x + i * colW;
        return (
          `<rect x="${n(x + 8)}" y="${n(el.y + 44)}" width="${n(colW - 16)}" height="4" rx="2" fill="${color(c.color, '#8A89A3')}"/>` +
          textBlock(plain(c.title), { x, y: el.y + 50, w: colW, h: 30 }, { size: 13, bold: true, color: MUTED, align: 'left', vAlign: 'middle', pad: 10 })
        );
      })
      .join('')
  );
}

function table(el: TableElement, cells: ReadonlyMap<string, unknown>): string {
  const rows = Array.isArray(el.rows) ? el.rows : [];
  const cols = Array.isArray(el.cols) ? el.cols : [];
  const parts = [`<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" fill="#FFFFFF" stroke="${LINE}"/>`];
  let y = el.y;
  rows.forEach((r, ri) => {
    let x = el.x;
    const h = n(r.h, 40);
    if (ri === 0 && el.header) parts.push(`<rect x="${n(el.x)}" y="${n(y)}" width="${n(el.w)}" height="${h}" fill="#F4F3FA"/>`);
    for (const c of cols) {
      const w = n(c.w, 120);
      const raw = cells.get(tableCellKey('t', el.id, r.id, c.id));
      parts.push(`<rect x="${n(x)}" y="${n(y)}" width="${w}" height="${h}" fill="none" stroke="${LINE}"/>`);
      parts.push(textBlock(typeof raw === 'string' ? plain(raw) : '', { x, y, w, h }, { size: Math.min(n(el.fontSize, 14), 14), bold: ri === 0 && el.header, align: 'left', pad: 8 }));
      x += w;
    }
    y += h;
  });
  return parts.join('');
}

function icon(el: IconElement): string {
  // The element is written by anyone who can edit: only what the shared icon rule keeps is drawn
  // (primitives with geometric and paint values; never a link, script, handler, style or url()).
  const ink = color(el.color, INK);
  const body = cleanIconNodes(el.nodes)
    .map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${esc(v === 'currentColor' ? ink : String(v))}"`).join(' ')}/>`)
    .join('');
  const box = `x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}"`;
  // Uploaded drawings (#4) carry their own paint; 'mono' ones in the element's colour.
  if (el.art === 'mono' || el.art === 'color')
    return `<svg ${box} viewBox="${cleanViewBox(el.viewBox) ?? ICON_DEFAULT_VIEWBOX}" fill="none" stroke="none">${body}</svg>`;
  return `<svg ${box} viewBox="${ICON_DEFAULT_VIEWBOX}" fill="none" stroke="${ink}" stroke-width="${n(el.strokeWidth, 2)}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** Round axis values covering [lo, hi] (about five). */
function ticksFor(lo: number, hi: number): number[] {
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

const PIE_COLORS = ['#5B3FF0', '#1FBF96', '#F5A524', '#F0645A', '#3B8BF0', '#E2559B', '#8A6A00', '#4B4A63', '#A794FF', '#7FD9C0'];

/** A chart (#137) from its cells, drawn like the app's: title, axes and bars / lines / areas, or a pie, and a legend. */
function chart(el: ChartElement, cells: ReadonlyMap<string, unknown>): string {
  const data = readChart(
    { id: el.id, rows: Array.isArray(el.rows) ? el.rows : [], series: Array.isArray(el.series) ? el.series : [] },
    (k) => {
      const v = cells.get(k);
      return typeof v === 'string' ? v : undefined;
    },
  );
  const pad = 14;
  const title = typeof el.title === 'string' ? el.title : '';
  const titleH = title ? 26 : 0;
  const pie = el.kind === 'pie';
  const legend = (el.legend ?? (pie || data.series.length > 1)) ? (pie ? data.labels.map((l, i) => ({ name: l || `Slice ${i + 1}`, color: PIE_COLORS[i % PIE_COLORS.length] })) : data.series) : [];
  const legendH = legend.length ? 24 : 0;
  const box = { x: el.x + pad, y: el.y + pad + titleH, w: Math.max(10, el.w - 2 * pad), h: Math.max(10, el.h - 2 * pad - titleH - legendH) };
  const parts: string[] = [];
  if (title) parts.push(`<text x="${n(el.x + el.w / 2)}" y="${n(el.y + pad + 15)}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="600" fill="${INK}">${esc(title.slice(0, 120))}</text>`);
  if (pie) {
    const values = (data.series[0]?.values ?? []).map((v) => (v && v > 0 ? v : 0));
    const total = values.reduce((a, b) => a + b, 0);
    const r = Math.max(4, Math.min(box.w, box.h) / 2 - 2);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    let a = -Math.PI / 2;
    values.forEach((v, i) => {
      if (!v || !total) return;
      const da = (v / total) * Math.PI * 2;
      const c = PIE_COLORS[i % PIE_COLORS.length];
      if (da >= Math.PI * 2 - 1e-6) parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${c}"/>`);
      else
        parts.push(
          `<path d="M${n(cx)} ${n(cy)}L${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}A${n(r)} ${n(r)} 0 ${da > Math.PI ? 1 : 0} 1 ${n(cx + Math.cos(a + da) * r)} ${n(cy + Math.sin(a + da) * r)}Z" fill="${c}" stroke="#FFFFFF" stroke-width="1.5"/>`,
        );
      a += da;
    });
  } else {
    const stacked = el.kind === 'stackedBar';
    let lo = 0;
    let hi = 0;
    data.labels.forEach((_, i) => {
      let pos = 0;
      let neg = 0;
      for (const s of data.series) {
        const v = s.values[i];
        if (v === null || v === undefined) continue;
        if (stacked) {
          if (v >= 0) pos += v;
          else neg += v;
        } else {
          hi = Math.max(hi, v);
          lo = Math.min(lo, v);
        }
      }
      if (stacked) {
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
      }
    });
    const ticks = ticksFor(lo, hi);
    const t0 = ticks[0];
    const t1 = ticks[ticks.length - 1];
    const axisW = Math.max(...ticks.map((t) => String(+t.toFixed(2)).length)) * 6.6 + 8;
    const plot = { x: box.x + axisW, y: box.y + 6, w: Math.max(4, box.w - axisW), h: Math.max(4, box.h - 24) };
    const y = (v: number) => plot.y + plot.h - ((v - t0) / (t1 - t0 || 1)) * plot.h;
    const band = plot.w / Math.max(1, data.labels.length);
    const cx = (i: number) => plot.x + band * (i + 0.5);
    for (const t of ticks)
      parts.push(
        `<line x1="${n(plot.x)}" x2="${n(plot.x + plot.w)}" y1="${n(y(t))}" y2="${n(y(t))}" stroke="${MUTED}" stroke-opacity="${t === 0 ? 0.7 : 0.18}"/>` +
          `<text x="${n(plot.x - 6)}" y="${n(y(t) + 4)}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}">${+t.toFixed(2)}</text>`,
      );
    data.labels.forEach((l, i) => parts.push(`<text x="${n(cx(i))}" y="${n(plot.y + plot.h + 14)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${INK}">${esc(l.slice(0, Math.max(2, Math.floor(band / 6.6))))}</text>`));
    if (el.kind === 'bar' || stacked) {
      const groupW = band * 0.72;
      const barW = stacked ? groupW : groupW / Math.max(1, data.series.length);
      data.labels.forEach((_, i) => {
        let pos = 0;
        let neg = 0;
        data.series.forEach((s, j) => {
          const v = s.values[i];
          if (!v) return;
          const from = stacked ? (v >= 0 ? pos : neg) : 0;
          const to = from + v;
          if (stacked) {
            if (v >= 0) pos = to;
            else neg = to;
          }
          const x = cx(i) - groupW / 2 + (stacked ? 0 : j * barW);
          parts.push(`<rect x="${n(x + (stacked ? 0 : 1))}" y="${n(Math.min(y(from), y(to)))}" width="${n(Math.max(1, barW - (stacked ? 0 : 2)))}" height="${n(Math.max(0.5, Math.abs(y(to) - y(from))))}" rx="${stacked ? 0 : n(Math.min(4, barW / 4))}" fill="${color(s.color, INK)}"/>`);
        });
      });
    } else {
      const base = y(Math.max(t0, Math.min(0, t1)));
      for (const s of data.series) {
        const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [cx(i), y(v)]));
        const runs: number[][][] = [];
        let run: number[][] = [];
        for (const p of pts) {
          if (p) run.push(p);
          else if (run.length) (runs.push(run), (run = []));
        }
        if (run.length) runs.push(run);
        const c = color(s.color, INK);
        for (const r of runs) {
          if (el.kind === 'area') parts.push(`<path d="M${n(r[0][0])} ${n(base)}${r.map(([px, py]) => `L${n(px)} ${n(py)}`).join('')}L${n(r[r.length - 1][0])} ${n(base)}Z" fill="${c}" fill-opacity="0.22"/>`);
          parts.push(`<path d="${r.map(([px, py], i) => `${i ? 'L' : 'M'}${n(px)} ${n(py)}`).join('')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
          for (const [px, py] of r) parts.push(`<circle cx="${n(px)}" cy="${n(py)}" r="3.5" fill="${c}" stroke="#FFFFFF" stroke-width="1.5"/>`);
        }
      }
    }
  }
  if (legend.length) {
    let lx = el.x + pad;
    const ly = el.y + el.h - pad - 12;
    for (const it of legend.slice(0, 12)) {
      const name = it.name.slice(0, 24);
      parts.push(`<rect x="${n(lx)}" y="${n(ly)}" width="11" height="11" rx="3" fill="${color(it.color, INK)}"/><text x="${n(lx + 17)}" y="${n(ly + 9.5)}" font-family="${FONT}" font-size="11" fill="${INK}">${esc(name)}</text>`);
      lx += 32 + name.length * 6.6;
    }
  }
  return parts.join('');
}

/** An emoji item: a team sticker (#138) is its picture; a stamp or emoji is its name in a box. */
function emoji(el: EmojiElement, data: string | null): string {
  if (data) return `<image x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" href="${esc(data)}" preserveAspectRatio="xMidYMid meet"/>`;
  const v = String(el.emoji ?? '');
  return placeholder(el, v.startsWith('stamp:') ? v.slice('stamp:'.length).replace(/[-_]/g, ' ') : v.startsWith('img:') ? (el.name ?? 'Sticker') : v);
}

/** The upload a team sticker shows (`img:/uploads/<name>`), or null. */
export const stickerSrc = (el: BoardElement): string | null => {
  const v = el.type === 'emoji' ? String((el as EmojiElement).emoji ?? '') : '';
  return v.startsWith('img:/uploads/') ? v.slice('img:'.length) : null;
};

/** What a picture can't show (a player, a live embed, a type drawn nowhere else): a labelled box. */
function placeholder(el: BoardElement, label: string): string {
  return (
    `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="8" fill="#F4F3FA" stroke="${LINE}"/>` +
    textBlock(label, el, { size: 'auto', maxSize: 16, color: MUTED, pad: 10 })
  );
}

/** A connector's route: straight, or with its waypoints, or an elbow through the middle. */
function connector(el: ConnectorElement): string {
  const a = { x: n(el.start?.x), y: n(el.start?.y) };
  const b = { x: n(el.end?.x), y: n(el.end?.y) };
  const way = Array.isArray(el.waypoints) ? el.waypoints.map((p) => ({ x: n(p.x), y: n(p.y) })) : [];
  let pts = [a, ...way, b];
  if (el.routing === 'elbow' && !way.length) {
    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    pts = horizontal ? [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b] : [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
  }
  const sw = n(el.strokeWidth, 2);
  const stroke = color(el.stroke, INK);
  const d =
    el.routing === 'curved' && pts.length === 2
      ? `M${a.x} ${a.y}C${n((a.x + b.x) / 2)} ${a.y} ${n((a.x + b.x) / 2)} ${b.y} ${b.x} ${b.y}`
      : `M${pts.map((p) => `${p.x} ${p.y}`).join('L')}`;
  const cap = (tip: { x: number; y: number }, from: { x: number; y: number }, style: unknown) => {
    if (!style || style === 'none') return '';
    const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
    const ux = (tip.x - from.x) / len;
    const uy = (tip.y - from.y) / len;
    const s = 6 + sw * 2;
    const back = { x: tip.x - ux * s, y: tip.y - uy * s };
    const l = { x: back.x - uy * s * 0.6, y: back.y + ux * s * 0.6 };
    const r = { x: back.x + uy * s * 0.6, y: back.y - ux * s * 0.6 };
    if (style === 'circle') return `<circle cx="${n(back.x + ux * s * 0.5)}" cy="${n(back.y + uy * s * 0.5)}" r="${n(s * 0.45)}" fill="${stroke}"/>`;
    if (style === 'bar') return `<line x1="${n(tip.x - uy * s * 0.6)}" y1="${n(tip.y + ux * s * 0.6)}" x2="${n(tip.x + uy * s * 0.6)}" y2="${n(tip.y - ux * s * 0.6)}" stroke="${stroke}" stroke-width="${sw}"/>`;
    if (style === 'diamond') {
      const mid = { x: tip.x - ux * s * 2, y: tip.y - uy * s * 2 };
      return `<polygon points="${n(tip.x)},${n(tip.y)} ${n(l.x)},${n(l.y)} ${n(mid.x)},${n(mid.y)} ${n(r.x)},${n(r.y)}" fill="${stroke}"/>`;
    }
    if (style === 'arrow') return `<polyline points="${n(l.x)},${n(l.y)} ${n(tip.x)},${n(tip.y)} ${n(r.x)},${n(r.y)}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `<polygon points="${n(tip.x)},${n(tip.y)} ${n(l.x)},${n(l.y)} ${n(r.x)},${n(r.y)}" fill="${stroke}"/>`;
  };
  const label = plain(el.label);
  const mid = pts[Math.floor((pts.length - 1) / 2)];
  const mid2 = pts[Math.floor((pts.length - 1) / 2) + 1] ?? mid;
  const lx = (mid.x + mid2.x) / 2;
  const ly = (mid.y + mid2.y) / 2;
  const lw = Math.min(260, label.length * 7.5 + 16);
  return (
    `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash(el.strokeStyle, sw)} stroke-linejoin="round"/>` +
    cap(b, pts[pts.length - 2] ?? a, el.endCap) +
    cap(a, pts[1] ?? b, el.startCap) +
    (label ? `<rect x="${n(lx - lw / 2)}" y="${n(ly - 12)}" width="${n(lw)}" height="24" rx="6" fill="#FFFFFF"/>` + textBlock(label, { x: lx - lw / 2, y: ly - 12, w: lw, h: 24 }, { size: 13, pad: 4 }) : '')
  );
}

const PLACEHOLDER_LABEL: Partial<Record<BoardElement['type'], (el: BoardElement) => string>> = {
  media: (el) => `▶ ${(el as { name?: string }).name ?? 'Video'}`,
  file: (el) => (el as { name?: string }).name ?? 'File',
  pdf: () => 'PDF',
  objectlink: () => 'Linked item',
  doc: () => 'Doc',
  code: (el) => String((el as { code?: string }).code ?? '').slice(0, 400),
};

function draw(el: BoardElement, input: SvgInput): string {
  switch (el.type) {
    case 'sticky':
      return sticky(el as StickyElement);
    case 'shape':
      return shape(el as ShapeElement);
    case 'text':
      return text(el as TextElement);
    case 'frame':
      return frame(el as FrameElement);
    case 'card':
      return card(el as CardElement);
    case 'image':
      return image(el as ImageElement, input.imageData((el as ImageElement).src));
    case 'embed':
      return embed(el as EmbedElement, (el as EmbedElement).image ? input.imageData((el as EmbedElement).image!) : null);
    case 'pen':
      return pen(el as PenElement);
    case 'mindmap':
      return mindmap(el as MindmapElement);
    case 'kanban':
      return kanban(el as KanbanElement);
    case 'table':
      return table(el as TableElement, input.collection('tableCells'));
    case 'icon':
      return icon(el as IconElement);
    case 'connector':
      return connector(el as ConnectorElement);
    case 'chart':
      return chart(el as ChartElement, input.collection(CHART_CELLS));
    case 'emoji': {
      const src = stickerSrc(el);
      return emoji(el as EmojiElement, src ? input.imageData(src) : null);
    }
    default:
      return placeholder(el, PLACEHOLDER_LABEL[el.type]?.(el) ?? el.type);
  }
}

/** Frames first (they sit behind), then the rest by z, connectors over the items they join. */
function paintOrder(els: readonly BoardElement[]): BoardElement[] {
  const rank = (e: BoardElement) => (e.type === 'frame' ? 0 : e.type === 'kanban' || e.type === 'swimlane' || e.type === 'timeline' ? 1 : e.type === 'connector' ? 3 : 2);
  return [...els].sort((a, b) => rank(a) - rank(b) || n(a.z) - n(b.z) || a.id.localeCompare(b.id));
}

/** The board (or `area` of it) as an SVG document in world units; empty boards are a small blank page. */
export function boardSvg(input: SvgInput): { svg: string; width: number; height: number } {
  const els = input.elements;
  const content = input.area ?? unionRects(els.map((e) => rotatedBounds(e)));
  // Frame titles sit above their frame: leave room for them.
  const area = content ? { x: content.x - MARGIN, y: content.y - MARGIN - (input.area ? 0 : 24), w: content.w + MARGIN * 2, h: content.h + MARGIN * 2 + (input.area ? 0 : 24) } : { x: 0, y: 0, w: 400, h: 300 };
  const body = paintOrder(els)
    .map((el) => {
      const svg = draw(el, input);
      const rot = n(el.rotation);
      return rot && el.type !== 'connector' ? `<g transform="rotate(${rot} ${n(el.x + el.w / 2)} ${n(el.y + el.h / 2)})">${svg}</g>` : svg;
    })
    .join('\n');
  const width = Math.max(1, Math.ceil(area.w));
  const height = Math.max(1, Math.ceil(area.h));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(area.x)} ${n(area.y)} ${width} ${height}">` +
    `<rect x="${n(area.x)}" y="${n(area.y)}" width="${width}" height="${height}" fill="${color(input.background, '#FFFFFF')}"/>\n${body}\n</svg>`;
  return { svg, width, height };
}
