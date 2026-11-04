// Icon drawings (#4): what an `icon` element may draw, and how an uploaded SVG becomes one.
//
// An icon's drawing travels inside its board element, written by anyone who can edit the board, so
// every reader — the board, exports, the server's SVG render — draws only what `cleanIconNodes`
// keeps: SVG primitives (path, circle, ellipse, line, polyline, polygon, rect) with attributes whose
// values are numbers, path data, colours, keywords or plain transforms. No element, attribute or
// value that can run script, link, load or style anything survives it: no <script>, no on…
// handlers, no href / xlink:href, no style, no url(…), no <foreignObject>, <use>, <image> or
// <text>.
//
// An uploaded SVG (`sanitizeSvg`) is read here — never by a browser, never with entities expanded —
// and reduced to the same primitives: groups are flattened (their paint, opacity and transforms
// carried onto each shape), simple class rules and gradients become plain colours, everything else
// is dropped. A drawing in one colour becomes `currentColor`, so the board recolours it ('mono');
// one with several colours keeps them ('color').
import type { IconNode } from './elements';

export const ICON_TAGS: readonly string[] = ['path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect'];

export const ICON_LIMITS = {
  /** Shapes one icon may draw. */
  nodes: 300,
  /** Characters of one attribute value (a path's data). */
  value: 20_000,
  /** Characters of one icon's whole drawing. */
  chars: 120_000,
  /** Characters of one uploaded SVG file. */
  svgChars: 512 * 1024,
  /** Characters of an icon's name. */
  name: 64,
} as const;

/** lucide's grid, the coordinate system of icons without a `viewBox`. */
export const ICON_DEFAULT_VIEWBOX = '0 0 24 24';

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+eE-]*$/;
const POINTS = /^[0-9.,\s+eE-]*$/;
const COLOR = /^(none|currentColor|#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/;
const TRANSFORM = /^(\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*[-+0-9.eE,\s]*\)\s*,?)*\s*$/;
const UNIT = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const keywords = (...words: string[]) => new RegExp(`^(${words.join('|')})$`);

/** Every attribute an icon node may carry, with the only values it may have. */
const ATTRS: Record<string, RegExp> = {
  d: PATH,
  points: POINTS,
  cx: NUM, cy: NUM, r: NUM, rx: NUM, ry: NUM,
  x: NUM, y: NUM, width: NUM, height: NUM,
  x1: NUM, y1: NUM, x2: NUM, y2: NUM,
  fill: COLOR,
  stroke: COLOR,
  'stroke-width': UNIT,
  'stroke-miterlimit': UNIT,
  opacity: UNIT,
  'fill-opacity': UNIT,
  'stroke-opacity': UNIT,
  'fill-rule': keywords('nonzero', 'evenodd'),
  'clip-rule': keywords('nonzero', 'evenodd'),
  'stroke-linecap': keywords('butt', 'round', 'square'),
  'stroke-linejoin': keywords('miter', 'round', 'bevel'),
  transform: TRANSFORM,
};
const MAX_TRANSFORM = 600;

/** The drawable part of `nodes` (anything unexpected dropped), as plain data: the one rule every reader applies. */
export function cleanIconNodes(nodes: unknown): IconNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: IconNode[] = [];
  let chars = 0;
  for (const n of nodes.slice(0, ICON_LIMITS.nodes)) {
    if (!Array.isArray(n) || typeof n[0] !== 'string' || !ICON_TAGS.includes(n[0]) || !n[1] || typeof n[1] !== 'object' || Array.isArray(n[1])) continue;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(n[1] as Record<string, unknown>)) {
      const raw = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
      if (typeof raw !== 'string' || raw.length > ICON_LIMITS.value || !Object.prototype.hasOwnProperty.call(ATTRS, k)) continue;
      const s = raw.trim();
      if (k === 'transform' && s.length > MAX_TRANSFORM) continue;
      if (ATTRS[k].test(s)) attrs[k] = s;
    }
    if (!Object.keys(attrs).length) continue;
    chars += JSON.stringify(attrs).length;
    if (chars > ICON_LIMITS.chars) break;
    out.push([n[0], attrs]);
  }
  return out;
}

/** "minX minY width height" with a positive size, normalised; null for anything else. */
export function cleanViewBox(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 200) return null;
  const parts = v.trim().split(/[\s,]+/);
  if (parts.length !== 4 || !parts.every((p) => NUM.test(p))) return null;
  const [x, y, w, h] = parts.map(Number);
  if (![x, y, w, h].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6) || w <= 0 || h <= 0) return null;
  return `${x} ${y} ${w} ${h}`;
}

/** A file name as an icon name: no extension, no folders, no control characters. */
export function iconNameOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const name = base.replace(/\.svg$/i, '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return name.slice(0, ICON_LIMITS.name) || 'icon';
}

/** Lower-case words of a name to search ("Arch_Amazon-EC2_64" → "arch amazon ec2 64"). */
export const iconWords = (name: string): string =>
  name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_.\-–—/]+/)
    .filter(Boolean)
    .join(' ');

// ---- reading an uploaded SVG ----

export type SanitizedSvg =
  | { ok: true; nodes: IconNode[]; viewBox: string; art: 'mono' | 'color' }
  | { ok: false; reason: 'too_large' | 'not_svg' | 'empty' };

type Tok =
  | { kind: 'open'; name: string; attrs: Record<string, string>; selfClose: boolean }
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The five XML entities and character references; any other entity stays as written (never expanded). */
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Tag names as SVG means them: 'svg:path' is 'path'; other namespaces stay foreign (and are dropped). */
const localName = (name: string) => name.replace(/^svg:/i, '');

/** A tolerant tokenizer: comments, CDATA, processing instructions and DOCTYPEs (internal subsets too) are skipped. */
function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const n = src.length;
  let i = 0;
  const text = (t: string) => t && out.push({ kind: 'text', text: t });
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      text(src.slice(i));
      break;
    }
    if (lt > i) text(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      out.push({ kind: 'text', text: src.slice(lt + 9, e < 0 ? n : e) });
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      let j = lt + 2;
      let depth = 0;
      for (; j < n; j++) {
        const c = src[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      out.push({ kind: 'close', name: localName(src.slice(lt + 2, e < 0 ? n : e).trim()) });
      i = e < 0 ? n : e + 1;
      continue;
    }
    const m = /^<([A-Za-z_][\w:.-]*)/.exec(src.slice(lt, lt + 256));
    if (!m) {
      text('<');
      i = lt + 1;
      continue;
    }
    let j = lt + m[0].length;
    const attrs: Record<string, string> = {};
    let selfClose = false;
    while (j < n) {
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] === '>') {
        j++;
        break;
      }
      if (src.startsWith('/>', j)) {
        selfClose = true;
        j += 2;
        break;
      }
      const an = /^[^\s=/>"']+/.exec(src.slice(j, j + 256));
      if (!an) {
        j++;
        continue;
      }
      j += an[0].length;
      while (j < n && /\s/.test(src[j])) j++;
      let value = '';
      if (src[j] === '=') {
        j++;
        while (j < n && /\s/.test(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, j + 1);
          value = src.slice(j + 1, e < 0 ? n : e);
          j = e < 0 ? n : e + 1;
        } else {
          const uv = /^[^\s>]+/.exec(src.slice(j, j + ICON_LIMITS.value));
          value = uv ? uv[0] : '';
          j += value.length;
        }
      }
      if (!(an[0] in attrs)) attrs[an[0]] = decode(value);
    }
    out.push({ kind: 'open', name: localName(m[1]), attrs, selfClose });
    i = j;
  }
  return out;
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080',
  teal: '#008080', maroon: '#800000', lime: '#00ff00', aqua: '#00ffff', fuchsia: '#ff00ff', olive: '#808000',
};

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** A paint value as the colours icons keep; undefined = not a colour we read (inherit instead). */
function paint(raw: string | undefined, gradients: ReadonlyMap<string, string>): string | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  const lower = v.toLowerCase();
  if (!v || lower === 'inherit') return undefined;
  if (lower === 'none' || lower === 'transparent') return 'none';
  if (lower === 'currentcolor') return 'currentColor';
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return lower;
  const rgb = /^rgba?\(\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i.exec(v);
  if (rgb) {
    const ch = (x: string, pct: string) => (pct ? (Number(x) * 255) / 100 : Number(x));
    const alpha = rgb[7] === undefined ? 1 : rgb[8] ? Number(rgb[7]) / 100 : Number(rgb[7]);
    if (alpha === 0) return 'none';
    return `#${hex2(ch(rgb[1], rgb[2]))}${hex2(ch(rgb[3], rgb[4]))}${hex2(ch(rgb[5], rgb[6]))}`;
  }
  // A gradient paints as its middle colour (fallback colour after the url, if any, first).
  const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/i.exec(v);
  if (url) return paint(url[2] || undefined, gradients) ?? gradients.get(url[1]) ?? undefined;
  return NAMED[lower];
}

/** Presentation properties read from attributes, class rules and inline styles. */
const PROPS = [
  'fill', 'stroke', 'stroke-width', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity',
  'fill-rule', 'clip-rule', 'stroke-linecap', 'stroke-linejoin', 'display', 'visibility', 'stop-color',
] as const;
type Props = Partial<Record<(typeof PROPS)[number], string>>;

function declarations(css: string): Props {
  const out: Props = {};
  for (const decl of css.split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const k = decl.slice(0, at).trim().toLowerCase() as (typeof PROPS)[number];
    const v = decl.slice(at + 1).replace(/!important/i, '').trim();
    if ((PROPS as readonly string[]).includes(k) && v) out[k] = v;
  }
  return out;
}

/** `.cls-1, .cls-2 { fill: #232f3e }` rules (class selectors only; anything else in a stylesheet is ignored). */
function classRules(css: string): Map<string, Props> {
  const rules = new Map<string, Props>();
  // Comments and @-statements (@import, @charset…) out first, so the rules after them still read.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[^{};]*;/g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = declarations(m[2]);
    for (const sel of m[1].split(',')) {
      const c = /^\s*\.([\w-]+)\s*$/.exec(sel);
      if (c) rules.set(c[1], { ...rules.get(c[1]), ...decls });
    }
  }
  return rules;
}

/** CSS precedence: presentation attributes, then class rules (in class order), then the inline style. */
function propsOf(attrs: Record<string, string>, rules: ReadonlyMap<string, Props>): Props {
  const out: Props = {};
  for (const k of PROPS) if (attrs[k] !== undefined) out[k] = attrs[k];
  for (const c of (attrs.class ?? '').split(/\s+/)) if (c && rules.has(c)) Object.assign(out, rules.get(c));
  if (attrs.style) Object.assign(out, declarations(attrs.style));
  return out;
}

// <switch>: Illustrator wraps the drawing in one, next to a <foreignObject> (dropped like any other).
const CONTAINERS = new Set(['svg', 'g', 'a', 'switch']);
const GRADIENTS = new Set(['linearGradient', 'radialGradient']);
const GEOMETRY: Record<string, readonly string[]> = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
};

/** What each shape needs to draw anything (one of each inner list). */
const REQUIRED: Record<string, string[][]> = {
  path: [['d']],
  polyline: [['points']],
  polygon: [['points']],
  circle: [['r']],
  ellipse: [['rx'], ['ry']],
  rect: [['width'], ['height']],
  line: [['x1', 'y1', 'x2', 'y2']],
};

interface Paint {
  fill: string;
  stroke: string;
  'stroke-width'?: string;
  'stroke-miterlimit'?: string;
  'fill-opacity'?: string;
  'stroke-opacity'?: string;
  'fill-rule'?: string;
  'clip-rule'?: string;
  'stroke-linecap'?: string;
  'stroke-linejoin'?: string;
  opacity: number;
  transform: string;
}

const unit = (v: string | undefined) => (v !== undefined ? /^([-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?)(px)?$/i.exec(v.trim())?.[1] : undefined);

/** Reduces an uploaded SVG to an icon's drawing (see the top of this file). Pure; never throws. */
export function sanitizeSvg(src: string): SanitizedSvg {
  if (typeof src !== 'string' || src.length > ICON_LIMITS.svgChars) return { ok: false, reason: 'too_large' };
  const toks = tokenize(src.replace(/^﻿/, ''));

  // Pass 1: class rules from <style> and a colour per gradient (its middle stop), wherever they are.
  let css = '';
  const stops = new Map<string, string[]>();
  const inherits = new Map<string, string>();
  {
    const stack: string[] = [];
    let gradient: string | null = null;
    for (const t of toks) {
      if (t.kind === 'open') {
        if (GRADIENTS.has(t.name)) {
          gradient = t.attrs.id ?? null;
          const ref = (t.attrs.href ?? t.attrs['xlink:href'] ?? '').trim();
          if (gradient && ref.startsWith('#')) inherits.set(gradient, ref.slice(1));
          if (gradient && !stops.has(gradient)) stops.set(gradient, []);
        } else if (t.name === 'stop' && gradient) {
          const c = paint(propsOf(t.attrs, new Map())['stop-color'] ?? '#000000', new Map());
          if (c && c !== 'none') stops.get(gradient)!.push(c);
        }
        if (!t.selfClose) stack.push(t.name);
        else if (GRADIENTS.has(t.name)) gradient = null;
      } else if (t.kind === 'close') {
        const at = stack.lastIndexOf(t.name);
        if (at >= 0) stack.length = at;
        if (GRADIENTS.has(t.name)) gradient = null;
      } else if (stack[stack.length - 1] === 'style') css += `${t.text}\n`;
    }
  }
  const rules = classRules(css);
  const gradients = new Map<string, string>();
  for (const id of stops.keys()) {
    let cur: string | undefined = id;
    for (let hops = 0; cur && hops < 8; hops++) {
      const s = stops.get(cur);
      if (s?.length) {
        gradients.set(id, s[Math.floor((s.length - 1) / 2)]);
        break;
      }
      cur = inherits.get(cur);
    }
  }

  // Pass 2: draw. Each open tag gets a frame: its inherited paint, or null when nothing under it is drawn.
  const root: Paint = { fill: '#000000', stroke: 'none', opacity: 1, transform: '' };
  const stack: Array<{ name: string; paint: Paint | null }> = [];
  const nodes: IconNode[] = [];
  let viewBox: string | null = null;
  let sawRoot = false;
  for (const t of toks) {
    if (t.kind === 'close') {
      const at = stack.map((f) => f.name).lastIndexOf(t.name);
      if (at >= 0) stack.length = at;
      continue;
    }
    if (t.kind !== 'open') continue;
    const parent = stack.length ? stack[stack.length - 1].paint : root;
    let frame: Paint | null = null;
    const isRoot = !sawRoot && t.name === 'svg' && stack.length === 0;
    if (parent && (isRoot || (sawRoot && ((CONTAINERS.has(t.name) && t.name !== 'svg') || !!GEOMETRY[t.name])))) {
      const p = propsOf(t.attrs, rules);
      const hidden = p.display?.trim() === 'none' || /^(hidden|collapse)$/.test(p.visibility?.trim() ?? '');
      if (!hidden) {
        const fill = paint(p.fill, gradients);
        const stroke = paint(p.stroke, gradients);
        const op = Number(unit(p.opacity));
        const tr = (t.attrs.transform ?? '').trim();
        frame = {
          ...parent,
          fill: fill ?? parent.fill,
          stroke: stroke ?? parent.stroke,
          opacity: parent.opacity * (Number.isFinite(op) ? Math.max(0, Math.min(1, op)) : 1),
          transform: tr && TRANSFORM.test(tr) ? `${parent.transform} ${tr}`.trim() : parent.transform,
        };
        for (const k of ['stroke-width', 'stroke-miterlimit', 'fill-opacity', 'stroke-opacity'] as const) {
          const v = unit(p[k]);
          if (v !== undefined) frame[k] = v;
        }
        for (const k of ['fill-rule', 'clip-rule', 'stroke-linecap', 'stroke-linejoin'] as const) if (p[k]) frame[k] = p[k]!.trim();
      }
      if (isRoot) {
        sawRoot = true;
        viewBox = cleanViewBox(t.attrs.viewBox);
        const w = unit(t.attrs.width);
        const h = unit(t.attrs.height);
        if (!viewBox && w && h) viewBox = cleanViewBox(`0 0 ${w} ${h}`);
      } else if (frame && GEOMETRY[t.name]) {
        const attrs: Record<string, string> = {};
        for (const k of GEOMETRY[t.name]) if (t.attrs[k] !== undefined) attrs[k] = unit(t.attrs[k]) ?? t.attrs[k];
        attrs.fill = frame.fill;
        attrs.stroke = frame.stroke;
        for (const k of ['stroke-width', 'stroke-miterlimit', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'stroke-linecap', 'stroke-linejoin'] as const)
          if (frame[k] !== undefined) attrs[k] = frame[k]!;
        if (frame.opacity < 1) attrs.opacity = String(Math.round(frame.opacity * 1000) / 1000);
        if (frame.transform) attrs.transform = frame.transform;
        if (attrs.fill !== 'none' || attrs.stroke !== 'none') nodes.push([t.name, attrs]);
        // Nothing inside a shape is drawn (<title>, <animate>…).
        frame = null;
      }
    }
    if (!t.selfClose) stack.push({ name: t.name, paint: frame });
    if (nodes.length >= ICON_LIMITS.nodes) break;
  }
  if (!sawRoot) return { ok: false, reason: 'not_svg' };
  // A shape whose geometry didn't survive draws nothing (a path without data, a circle without r).
  let clean = cleanIconNodes(nodes).filter(([tag, a]) => (REQUIRED[tag] ?? []).every((ks) => ks.some((k) => a[k] !== undefined)));
  if (!clean.length) return { ok: false, reason: 'empty' };

  // One colour: the board recolours it.
  const colours = new Set<string>();
  for (const [, a] of clean) for (const k of ['fill', 'stroke']) if (a[k] && a[k] !== 'none') colours.add(String(a[k]));
  const mono = colours.size <= 1;
  if (mono) clean = clean.map(([tag, a]) => [tag, Object.fromEntries(Object.entries(a).map(([k, v]) => [k, (k === 'fill' || k === 'stroke') && v !== 'none' ? 'currentColor' : v]))]);
  return { ok: true, nodes: clean, viewBox: viewBox ?? ICON_DEFAULT_VIEWBOX, art: mono ? 'mono' : 'color' };
}
