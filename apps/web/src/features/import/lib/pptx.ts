// PowerPoint decks (`.pptx`, also `.pptm`, `.ppsx`, `.potx`) → a deck of Freero slides: one frame
// per slide, in the deck's order, side by side. Implemented from the published Office Open XML
// format (ECMA-376: presentation → slides → slide layouts → slide masters → theme, media and notes
// slides joined by relationships); no Microsoft code, template or artwork is used. Units are EMU
// (914,400 an inch); the board is 96 units an inch, so a 13.33 × 7.5 in slide is 1280 × 720.
//
// What lands: text boxes and placeholders as text (paragraphs, bullets, bold / italic / underline /
// strike, colours, size, alignment — a placeholder without its own position or style takes its
// layout's, then its master's), preset shapes as Freero shapes with their text, lines and
// connectors (glued where the slide glues them), pictures (cropped as on the slide), tables, groups
// as one group, the slide's background, and the layout's and master's own artwork (logos, bands).
// Hidden slides are skipped in the presentation. Speaker notes become presenter notes. Charts,
// SmartArt, ink and anything else without a Freero counterpart become a labelled box in their
// place (an embedded object or video with a picture becomes that picture), and the report lists them.
//
// Untrusted input: the zip is read with entry, size, unpacked-size and time limits (zip.ts), any
// DOCTYPE is refused (opc.ts), external relationships (linked pictures) are never followed, and
// text stays text.
import {
  plainToRichText,
  shapeDraft,
  type CapStyle,
  type ElementDraft,
  type FontFamily,
  type Rect,
  type ShapeKind,
  type TableCopyContent,
  type TextAlign,
  type VerticalAlign,
} from '@freero/shared';
import { coord, ImportError, imageDraft, MAX_FILE_BYTES, MAX_ITEMS, MAX_UNPACKED_BYTES, size, Skips, type ImportResult } from './common';
import { base64, kid, kids, OpcPackage, relAttr, sniffImage, type Rel } from './opc';
import { ZipPackage } from './zip';

/** EMU per board unit (96 a inch). */
const EMU = 9525;
/** Parts a package may hold, how big one picture may be, slides one deck may have, reading time. */
export const PPTX_LIMITS = { entries: 2000, imageBytes: 10 * 1024 * 1024, slides: 300, timeMs: 20_000 } as const;
/** Room between slides on the board. */
const SLIDE_GAP = 160;

/** A PowerPoint file by its name. */
export const isPptxName = (name: string) => /\.(pptx|pptm|ppsx|ppsm|potx|potm)$/i.test(name);

const NS_TABLE = '/drawingml/2006/table';
const NS_CHART = '/drawingml/2006/chart';
const NS_DIAGRAM = '/drawingml/2006/diagram';
const NS_OLE = '/presentationml/2006/ole';

// ------------------------------------------------------------------------------------ colours

const PRESET_COLORS: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', gray: '#808080',
  grey: '#808080', orange: '#FFA500', purple: '#800080', navy: '#000080', teal: '#008080', silver: '#C0C0C0', maroon: '#800000',
};
const SCHEME_ALIAS: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Applies DrawingML colour transforms (lumMod / lumOff / tint / shade) to `hex`. */
function transform(hex: string, el: Element): string {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  const val = (c: Element) => Number(c.getAttribute('val')) / 100000;
  for (const m of [...el.children]) {
    const v = val(m);
    if (!Number.isFinite(v)) continue;
    if (m.localName === 'lumMod' || m.localName === 'lumOff') {
      const [h, s, l] = rgbToHsl(r, g, b);
      [r, g, b] = hslToRgb(h, s, m.localName === 'lumMod' ? Math.min(1, l * v) : Math.min(1, Math.max(0, l + v)));
    } else if (m.localName === 'tint') {
      r = 255 - (255 - r) * v;
      g = 255 - (255 - g) * v;
      b = 255 - (255 - b) * v;
    } else if (m.localName === 'shade') {
      r *= v;
      g *= v;
      b *= v;
    }
  }
  return toHex(r, g, b);
}

/** The colour a DrawingML colour holder (solidFill, a fill / line reference, a theme slot) names, or null. */
function colorIn(holder: Element | null, theme: Map<string, string>, depth = 0): string | null {
  if (!holder || depth > 4) return null;
  for (const c of [...holder.children]) {
    let base: string | null = null;
    if (c.localName === 'srgbClr') base = /^[0-9a-f]{6}$/i.test(c.getAttribute('val') ?? '') ? `#${c.getAttribute('val')!.toUpperCase()}` : null;
    else if (c.localName === 'schemeClr') {
      const v = c.getAttribute('val') ?? '';
      base = theme.get(SCHEME_ALIAS[v] ?? v) ?? null;
    } else if (c.localName === 'sysClr') base = /^[0-9a-f]{6}$/i.test(c.getAttribute('lastClr') ?? '') ? `#${c.getAttribute('lastClr')!.toUpperCase()}` : null;
    else if (c.localName === 'prstClr') base = PRESET_COLORS[(c.getAttribute('val') ?? '').toLowerCase()] ?? null;
    else if (c.localName === 'scrgbClr') {
      const pc = (a: string) => (Number(c.getAttribute(a)) / 100000) * 255;
      base = toHex(pc('r'), pc('g'), pc('b'));
    }
    if (base) return transform(base, c);
  }
  return null;
}

/** A shape property's fill: a colour, 'transparent' (noFill), or null (not said here). */
function fillOf(spPr: Element | null, theme: Map<string, string>): string | null {
  if (!spPr) return null;
  if (kid(spPr, 'noFill')) return 'transparent';
  const solid = kid(spPr, 'solidFill');
  if (solid) return colorIn(solid, theme);
  const grad = kid(spPr, 'gradFill');
  if (grad) return colorIn(kid(kid(grad, 'gsLst'), 'gs'), theme); // its first stop
  return null;
}

// ------------------------------------------------------------------------------------ shapes

const PRESETS: Record<string, ShapeKind> = {
  rect: 'rect', roundRect: 'roundRect', snipRoundRect: 'roundRect', round1Rect: 'roundRect', round2SameRect: 'roundRect', ellipse: 'ellipse',
  triangle: 'triangle', rtTriangle: 'triangle', diamond: 'diamond', parallelogram: 'parallelogram', trapezoid: 'trapezoid',
  pentagon: 'pentagon', homePlate: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', star5: 'star', star4: 'star', star6: 'star',
  plus: 'cross', mathPlus: 'cross', rightArrow: 'arrowRight', leftArrow: 'arrowLeft', chevron: 'chevron', cloud: 'cloud',
  cloudCallout: 'cloud', can: 'cylinder', wedgeRectCallout: 'speech', wedgeRoundRectCallout: 'speech', wedgeEllipseCallout: 'speech',
  flowChartProcess: 'rect', flowChartAlternateProcess: 'roundRect', flowChartDecision: 'diamond', flowChartTerminator: 'terminator',
  flowChartInputOutput: 'parallelogram', flowChartDocument: 'document', flowChartPredefinedProcess: 'predefinedProcess',
  flowChartManualInput: 'manualInput', flowChartManualOperation: 'manualOperation', flowChartDelay: 'delay', flowChartDisplay: 'display',
  flowChartOffpageConnector: 'offPageRef', flowChartMerge: 'merge', flowChartInternalStorage: 'internalStorage',
  flowChartMagneticDisk: 'cylinder', flowChartConnector: 'ellipse', flowChartPreparation: 'hexagon',
};
const LINES = /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/;

const SERIF = /(times|georgia|garamond|cambria|palatino|book antiqua|baskerville|serif|didot|bodoni|minion|constantia)/i;
const MONO = /(courier|consolas|mono|menlo|lucida console)/i;

function fontFamily(face: string | null | undefined): FontFamily {
  if (!face) return 'sans';
  if (MONO.test(face)) return 'mono';
  if (SERIF.test(face) && !/sans/i.test(face)) return 'serif';
  return 'sans';
}

interface Theme {
  colors: Map<string, string>;
  major: string | null;
  minor: string | null;
}

async function readTheme(pkg: OpcPackage, masterPath: string): Promise<Theme> {
  const out: Theme = { colors: new Map(), major: null, minor: null };
  const rel = await pkg.relOfType(masterPath, '/theme');
  const x = rel ? await pkg.xml(rel.target) : null;
  if (!x) return out;
  for (const el of [...x.getElementsByTagName('*')]) {
    if (el.localName === 'clrScheme') {
      for (const slot of [...el.children]) {
        const c = colorIn(slot, out.colors);
        if (c) out.colors.set(slot.localName, c);
      }
    } else if (el.localName === 'majorFont') out.major = kid(el, 'latin')?.getAttribute('typeface') ?? null;
    else if (el.localName === 'minorFont') out.minor = kid(el, 'latin')?.getAttribute('typeface') ?? null;
  }
  return out;
}

/** A part a shape comes from: where its pictures and charts are (relationships). */
interface Part {
  path: string;
  rels: Map<string, Rel>;
}

interface Placeholder {
  type: string;
  idx: string | null;
}

/** Placeholders of a layout or master, by `idx:<n>` and `type:<t>`. */
function placeholderIndex(tree: Element | null): Map<string, Element> {
  const out = new Map<string, Element>();
  for (const sp of tree ? kids(tree, 'sp') : []) {
    const ph = placeholderOf(sp);
    if (!ph) continue;
    if (ph.idx !== null && !out.has(`idx:${ph.idx}`)) out.set(`idx:${ph.idx}`, sp);
    if (!out.has(`type:${ph.type}`)) out.set(`type:${ph.type}`, sp);
  }
  return out;
}

function placeholderOf(sp: Element): Placeholder | null {
  const ph = kid(kid(kid(sp, 'nvSpPr') ?? kid(sp, 'nvPicPr') ?? kid(sp, 'nvGraphicFramePr'), 'nvPr'), 'ph');
  if (!ph) return null;
  return { type: ph.getAttribute('type') ?? 'obj', idx: ph.getAttribute('idx') };
}

const isTitle = (t: string | undefined) => t === 'title' || t === 'ctrTitle';

/** What a master calls a slide's placeholder type. */
const masterType = (t: string) => (isTitle(t) ? 'title' : t === 'dt' || t === 'ftr' || t === 'sldNum' ? t : 'body');

// ------------------------------------------------------------------------------------ text

interface TextOut {
  html: string;
  plain: string;
  /** Element-level values: the first run's. */
  size: number | null;
  color: string | null;
  font: string | null;
  align: TextAlign;
  vAlign: VerticalAlign;
}

const escape = (t: string) => plainToRichText(t);

class Budget {
  private n = 0;
  constructor(private readonly zip: ZipPackage) {}
  tick() {
    if (++this.n % 64 === 0) this.zip.checkTime();
    if (this.n > MAX_ITEMS * 4) throw new ImportError(`This deck has more than ${MAX_ITEMS} items; Freero imports up to ${MAX_ITEMS} at a time.`);
  }
}

// ------------------------------------------------------------------------------------ the deck

interface Xf {
  (r: Rect): Rect;
}

export async function parsePptx(bytes: Uint8Array, newId: () => string, opts: { timeLimitMs?: number } = {}): Promise<ImportResult> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ImportError(`That file is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new ImportError('This is an older PowerPoint file (.ppt). Save it as .pptx in PowerPoint and import that.');
  const zip = ZipPackage.open(bytes, {
    maxEntries: PPTX_LIMITS.entries,
    maxEntryBytes: MAX_UNPACKED_BYTES,
    maxTotalBytes: MAX_UNPACKED_BYTES * 2,
    deadline: Date.now() + (opts.timeLimitMs ?? PPTX_LIMITS.timeMs),
  });
  const budget = new Budget(zip);
  const pkg = new OpcPackage(zip, 'PowerPoint file');
  const presPath = (await pkg.relOfType('_rels/.rels', '/officeDocument'))?.target ?? (zip.has('ppt/presentation.xml') ? 'ppt/presentation.xml' : null);
  const pres = presPath ? await pkg.xml(presPath) : null;
  if (!presPath || !pres || pres.documentElement.localName !== 'presentation') throw new ImportError('This isn’t a PowerPoint deck (.pptx).');
  const root = pres.documentElement;

  const sz = kid(root, 'sldSz');
  const slideW = Math.round(size(Number(sz?.getAttribute('cx') ?? 12192000) / EMU, 40));
  const slideH = Math.round(size(Number(sz?.getAttribute('cy') ?? 6858000) / EMU, 40));
  const presRels = await pkg.rels(presPath);
  const slideRefs = kids(kid(root, 'sldIdLst') ?? root, 'sldId')
    .map((s) => presRels.get(relAttr(s) ?? ''))
    .filter((r): r is Rel => !!r && !r.external);
  if (!slideRefs.length) throw new ImportError('This deck has no slides.');
  if (slideRefs.length > PPTX_LIMITS.slides) throw new ImportError(`This deck has ${slideRefs.length} slides; Freero imports up to ${PPTX_LIMITS.slides} at a time.`);
  const defaultStyle = kid(root, 'defaultTextStyle');

  const skips = new Skips();
  const drafts: ElementDraft[] = [];
  const images: ImportResult['images'] = [];
  const notes: NonNullable<ImportResult['notes']> = [];
  const content: NonNullable<ImportResult['content']> = {};
  const pictureCache = new Map<string, string | null>();
  const themes = new Map<string, Theme>();
  const preset = Math.abs(slideW / slideH - 16 / 9) < 0.02 ? '16:9' : Math.abs(slideW / slideH - 4 / 3) < 0.02 ? '4:3' : 'custom';

  const picture = async (part: Part, blip: Element | null): Promise<string | null> => {
    if (!blip) return null;
    if (relAttr(blip, 'link') && !relAttr(blip, 'embed')) {
      skips.add('Linked pictures (left out)');
      return null;
    }
    const rel = part.rels.get(relAttr(blip, 'embed') ?? '');
    if (!rel || rel.external) {
      if (rel?.external) skips.add('Linked pictures (left out)');
      return null;
    }
    if (pictureCache.has(rel.target)) return pictureCache.get(rel.target)!;
    const b = await zip.read(rel.target, PPTX_LIMITS.imageBytes).catch((e: unknown) => {
      if (e instanceof ImportError && /takes too long/.test(e.message)) throw e;
      return null;
    });
    const mime = b ? sniffImage(b) : null;
    const url = b && mime ? `data:${mime};base64,${base64(b)}` : null;
    if (!url) skips.add('Pictures in formats Freero doesn’t show, such as EMF (left out)');
    pictureCache.set(rel.target, url);
    return url;
  };

  for (let si = 0; si < slideRefs.length; si++) {
    const slidePath = slideRefs[si].target;
    const sx = await pkg.xml(slidePath);
    if (!sx) continue;
    budget.tick();
    const sld = sx.documentElement;
    const slidePart: Part = { path: slidePath, rels: await pkg.rels(slidePath) };
    const layoutPath = (await pkg.relOfType(slidePath, '/slideLayout'))?.target ?? null;
    const layout = layoutPath ? await pkg.xml(layoutPath) : null;
    const masterPath = layoutPath ? ((await pkg.relOfType(layoutPath, '/slideMaster'))?.target ?? null) : null;
    const master = masterPath ? await pkg.xml(masterPath) : null;
    let theme = masterPath ? themes.get(masterPath) : undefined;
    if (!theme) {
      theme = masterPath ? await readTheme(pkg, masterPath) : { colors: new Map(), major: null, minor: null };
      if (masterPath) themes.set(masterPath, theme);
    }
    const colors = theme.colors;
    const layoutTree = layout ? kid(kid(layout.documentElement, 'cSld'), 'spTree') : null;
    const masterTree = master ? kid(kid(master.documentElement, 'cSld'), 'spTree') : null;
    const layoutPh = placeholderIndex(layoutTree);
    const masterPh = placeholderIndex(masterTree);
    const txStyles = master ? kid(master.documentElement, 'txStyles') : null;

    const ox = si * (slideW + SLIDE_GAP);
    const frameId = newId();
    const slideItems: ElementDraft[] = [];
    let title = '';
    /** Shapes of this slide by their id in the file (connectors glue to them). */
    const byShapeId = new Map<string, { id: string; rect: Rect }>();
    const glue: Array<{ draft: ElementDraft & { type: 'connector' }; start: string | null; end: string | null }> = [];

    const put = (d: ElementDraft, groupId: string | null) => {
      budget.tick();
      slideItems.push({ ...d, frameId, ...(groupId ? { groupId } : {}) } as ElementDraft);
    };

    const inherited = (ph: Placeholder | null) => {
      if (!ph) return { layout: null, master: null };
      const l = (ph.idx !== null ? layoutPh.get(`idx:${ph.idx}`) : undefined) ?? layoutPh.get(`type:${ph.type}`) ?? null;
      const mt = masterType(ph.type);
      const m = masterPh.get(`type:${mt}`) ?? (l ? (masterPh.get(`type:${masterType(placeholderOf(l)?.type ?? mt)}`) ?? null) : null);
      return { layout: l, master: m };
    };

    /** Lists of level styles a shape's text takes values from, most specific first. */
    const styleChain = (sp: Element, ph: Placeholder | null, from: { layout: Element | null; master: Element | null }): Element[] => {
      const lst = (s: Element | null) => kid(kid(s, 'txBody'), 'lstStyle');
      const out = [lst(sp), lst(from.layout), lst(from.master)];
      if (ph) out.push(kid(txStyles, isTitle(ph.type) ? 'titleStyle' : ph.type === 'dt' || ph.type === 'ftr' || ph.type === 'sldNum' ? 'otherStyle' : 'bodyStyle'));
      else out.push(kid(txStyles, 'otherStyle'), defaultStyle);
      return out.filter((e): e is Element => !!e);
    };

    const textOf = (sp: Element, chain: Element[], bullets: boolean, bodyFrom: Element[]): TextOut | null => {
      const body = kid(sp, 'txBody') ?? kid(sp, 'textBody');
      if (!body) return null;
      const bodyPr = [kid(body, 'bodyPr'), ...bodyFrom].find((b) => b?.getAttribute('anchor')) ?? null;
      const scale = Number(kid(kid(body, 'bodyPr'), 'normAutofit')?.getAttribute('fontScale') ?? 100000) / 100000 || 1;
      const lvlStyle = (lvl: number) => chain.map((c) => kid(c, `lvl${lvl + 1}pPr`)).filter((e): e is Element => !!e);
      let first: { size: number | null; color: string | null; font: string | null } | null = null;
      let align: TextAlign | null = null;
      const blocks: Array<{ kind: 'p' | 'ul' | 'ol'; html: string }> = [];
      const plain: string[] = [];
      for (const p of kids(body, 'p')) {
        const pPr = kid(p, 'pPr');
        const lvl = Math.max(0, Math.min(8, Number(pPr?.getAttribute('lvl') ?? 0) || 0));
        const styles = [pPr, ...lvlStyle(lvl)].filter((e): e is Element => !!e);
        const pick = <T,>(fn: (e: Element) => T | null | undefined): T | null => {
          for (const e of styles) {
            const v = fn(e);
            if (v !== null && v !== undefined) return v;
          }
          return null;
        };
        const algn = pick((e) => e.getAttribute('algn'));
        if (align === null) align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left';
        // Bullets: said on the paragraph or the shape's own level style; a body placeholder also
        // takes its layout's and master's (titles and subtitles never inherit the master's body bullets).
        const bullet = (e: Element) => (kid(e, 'buNone') ? 'none' : kid(e, 'buAutoNum') ? 'num' : kid(e, 'buChar') ? 'char' : null);
        const ownLvl = kid(kid(kid(sp, 'txBody'), 'lstStyle'), `lvl${lvl + 1}pPr`);
        const bu =
          [pPr, ownLvl].reduce<string | null>((v, e) => v ?? (e ? bullet(e) : null), null) ??
          (bullets ? (styles.reduce<string | null>((v, e) => v ?? bullet(e), null) ?? 'char') : 'none');
        let html = '';
        let text = '';
        for (const r of [...p.children]) {
          if (r.localName === 'br') {
            html += '<br>';
            text += '\n';
            continue;
          }
          if (r.localName !== 'r' && r.localName !== 'fld') continue;
          const t = kid(r, 't')?.textContent ?? '';
          if (!t) continue;
          const rPr = kid(r, 'rPr');
          const runStyles = [rPr, ...styles.map((s) => kid(s, 'defRPr'))].filter((e): e is Element => !!e);
          const rv = <T,>(fn: (e: Element) => T | null | undefined): T | null => {
            for (const e of runStyles) {
              const v = fn(e);
              if (v !== null && v !== undefined) return v;
            }
            return null;
          };
          const szv = rv((e) => (e.getAttribute('sz') ? Number(e.getAttribute('sz')) : null));
          const color = rv((e) => colorIn(kid(e, 'solidFill'), colors));
          let face = rv((e) => kid(e, 'latin')?.getAttribute('typeface'));
          if (face === '+mj-lt') face = theme!.major;
          else if (face === '+mn-lt') face = theme!.minor;
          if (!first) first = { size: szv ? (szv / 100) * (96 / 72) * scale : null, color, font: face ?? (chain.some((c) => c.localName === 'titleStyle') ? theme!.major : theme!.minor) };
          let piece = escape(t);
          if (rv((e) => e.getAttribute('strike'))?.startsWith('sng') || rv((e) => e.getAttribute('strike')) === 'dblStrike') piece = `<s>${piece}</s>`;
          const u = rv((e) => e.getAttribute('u'));
          if (u && u !== 'none') piece = `<u>${piece}</u>`;
          if (rv((e) => e.getAttribute('i')) === '1') piece = `<i>${piece}</i>`;
          if (rv((e) => e.getAttribute('b')) === '1') piece = `<b>${piece}</b>`;
          if (color && color !== first.color) piece = `<span style="color: ${color}">${piece}</span>`;
          html += piece;
          text += t;
        }
        plain.push(text);
        const kind = bu === 'none' || !text ? 'p' : bu === 'num' ? 'ol' : 'ul';
        blocks.push({ kind, html: kind === 'p' ? `<p>${html}</p>` : `<li>${html}</li>` });
      }
      if (!plain.some((t) => t.trim())) return null;
      let html = '';
      for (let i = 0; i < blocks.length; ) {
        const b = blocks[i];
        if (b.kind === 'p') {
          html += b.html;
          i++;
          continue;
        }
        let items = '';
        while (i < blocks.length && blocks[i].kind === b.kind) items += blocks[i++].html;
        html += `<${b.kind}>${items}</${b.kind}>`;
      }
      const anchor = bodyPr?.getAttribute('anchor');
      return {
        html,
        plain: plain.join('\n'),
        size: first?.size ?? null,
        color: first?.color ?? null,
        font: first?.font ?? null,
        align: align ?? 'left',
        vAlign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
      };
    };

    /** Where a shape is: its own transform, else its placeholder's on the layout, then the master. */
    const rectOf = (xfrm: Element | null): { r: Rect; rot: number; flipH: boolean; flipV: boolean } | null => {
      const off = kid(xfrm, 'off');
      const ext = kid(xfrm, 'ext');
      if (!xfrm || !off || !ext) return null;
      const n = (e: Element, a: string) => Number(e.getAttribute(a)) / EMU;
      return {
        r: { x: coord(n(off, 'x')), y: coord(n(off, 'y')), w: Math.max(0, coord(n(ext, 'cx'))), h: Math.max(0, coord(n(ext, 'cy'))) },
        rot: (((Number(xfrm.getAttribute('rot') ?? 0) / 60000) % 360) + 360) % 360 || 0,
        flipH: xfrm.getAttribute('flipH') === '1',
        flipV: xfrm.getAttribute('flipV') === '1',
      };
    };

    const labelledBox = (r: Rect, what: string, rot: number, groupId: string | null) => {
      const d = shapeDraft(newId(), 'rect', r, '', { fill: '#F4F3F8', stroke: '#B9B7CC', strokeWidth: 2, fontSize: Math.max(12, Math.min(24, r.h / 6)) });
      put({ ...d, rotation: rot, text: `<p>${escape(what)}</p>`, strokeStyle: 'dashed', textColor: '#6B6A80' } as ElementDraft, groupId);
    };

    const visit = async (el: Element, part: Part, xf: Xf, groupId: string | null, layer: 'slide' | 'layout' | 'master'): Promise<void> => {
      budget.tick();
      const local = el.localName;
      if (local === 'AlternateContent') {
        // Newer content with an older equivalent: the fallback is what Freero can read.
        const alt = kid(el, 'Fallback') ?? kid(el, 'Choice');
        for (const c of alt ? [...alt.children] : []) await visit(c, part, xf, groupId, layer);
        return;
      }
      if (local === 'grpSp') {
        const g = kid(kid(el, 'grpSpPr'), 'xfrm');
        const off = kid(g, 'off');
        const ext = kid(g, 'ext');
        const choff = kid(g, 'chOff');
        const chext = kid(g, 'chExt');
        let inner: Xf = xf;
        if (off && ext && choff && chext) {
          const n = (e: Element, a: string) => Number(e.getAttribute(a)) / EMU;
          const kx = n(chext, 'cx') > 0 ? n(ext, 'cx') / n(chext, 'cx') : 1;
          const ky = n(chext, 'cy') > 0 ? n(ext, 'cy') / n(chext, 'cy') : 1;
          inner = (r) => xf({ x: n(off, 'x') + (r.x - n(choff, 'x')) * kx, y: n(off, 'y') + (r.y - n(choff, 'y')) * ky, w: r.w * kx, h: r.h * ky });
        }
        const gid = groupId ?? newId();
        for (const c of [...el.children]) if (c.localName !== 'nvGrpSpPr' && c.localName !== 'grpSpPr') await visit(c, part, inner, gid, layer);
        return;
      }
      if (local === 'contentPart') {
        skips.add('Ink drawings (left out)');
        return;
      }
      if (local === 'sp' || local === 'cxnSp') {
        const ph = local === 'sp' ? placeholderOf(el) : null;
        // A layout's and master's placeholders are the slides' to fill, not artwork.
        if (ph && layer !== 'slide') return;
        const from = inherited(ph);
        const spPr = kid(el, 'spPr');
        const at = rectOf(kid(spPr, 'xfrm')) ?? rectOf(kid(kid(from.layout, 'spPr'), 'xfrm')) ?? rectOf(kid(kid(from.master, 'spPr'), 'xfrm'));
        if (!at) return;
        const r = xf(at.r);
        const geom = kid(spPr, 'prstGeom')?.getAttribute('prst') ?? (kid(spPr, 'custGeom') ? 'custom' : 'rect');
        const style = kid(el, 'style');
        const ln = kid(spPr, 'ln');
        const lineColor = ln && kid(ln, 'noFill') ? 'transparent' : (colorIn(kid(ln, 'solidFill'), colors) ?? colorIn(kid(style, 'lnRef'), colors));
        const lineW = ln?.getAttribute('w') ? Math.max(1, Math.min(48, Number(ln.getAttribute('w')) / EMU)) : 2;
        const dash = kid(ln, 'prstDash')?.getAttribute('val') ?? 'solid';
        const strokeStyle = /dot/i.test(dash) && !/dash/i.test(dash) ? 'dotted' : dash === 'solid' ? 'solid' : 'dashed';
        const cNvPr = kid(kid(el, local === 'sp' ? 'nvSpPr' : 'nvCxnSpPr'), 'cNvPr');
        const fileId = cNvPr?.getAttribute('id') ?? null;

        if (local === 'cxnSp' || LINES.test(geom)) {
          const a = { x: ox + (at.flipH ? r.x + r.w : r.x), y: at.flipV ? r.y + r.h : r.y };
          const b = { x: ox + (at.flipH ? r.x : r.x + r.w), y: at.flipV ? r.y : r.y + r.h };
          const cap = (e: Element | null): CapStyle => (e && e.getAttribute('type') && e.getAttribute('type') !== 'none' ? 'arrow' : 'none');
          const d = {
            id: newId(),
            type: 'connector',
            x: Math.round(Math.min(a.x, b.x)),
            y: Math.round(Math.min(a.y, b.y)),
            w: Math.max(1, Math.round(Math.abs(b.x - a.x))),
            h: Math.max(1, Math.round(Math.abs(b.y - a.y))),
            rotation: 0,
            start: { elementId: null, x: Math.round(a.x), y: Math.round(a.y) },
            end: { elementId: null, x: Math.round(b.x), y: Math.round(b.y) },
            routing: /^bent/.test(geom) ? 'elbow' : /^curved/.test(geom) ? 'curved' : 'straight',
            stroke: lineColor && lineColor !== 'transparent' ? lineColor : '#17162B',
            strokeWidth: lineW,
            strokeStyle,
            startCap: cap(kid(ln, 'headEnd')),
            endCap: cap(kid(ln, 'tailEnd')),
            label: '',
          } as unknown as ElementDraft & { type: 'connector' };
          put(d, groupId);
          const cx = kid(kid(el, 'nvCxnSpPr'), 'cNvCxnSpPr');
          glue.push({ draft: slideItems[slideItems.length - 1] as ElementDraft & { type: 'connector' }, start: kid(cx, 'stCxn')?.getAttribute('id') ?? null, end: kid(cx, 'endCxn')?.getAttribute('id') ?? null });
          return;
        }

        const isBodyPh = !!ph && !isTitle(ph.type) && ph.type !== 'subTitle' && ph.type !== 'dt' && ph.type !== 'ftr' && ph.type !== 'sldNum';
        const chain = styleChain(el, ph, from);
        const bodyFrom = [kid(kid(from.layout, 'txBody'), 'bodyPr'), kid(kid(from.master, 'txBody'), 'bodyPr')].filter((e): e is Element => !!e);
        const text = textOf(el, chain, isBodyPh, bodyFrom);
        if (ph && isTitle(ph.type) && text && !title) title = text.plain.split('\n')[0].trim().slice(0, 200);
        // Pictures inside a shape (a picture fill): the picture, cropped to the box.
        const blipFill = kid(spPr, 'blipFill');
        const fill = fillOf(spPr, colors) ?? (blipFill ? null : colorIn(kid(style, 'fillRef'), colors));
        const hasLine = !!lineColor && lineColor !== 'transparent' && !(ln === null && !style);
        if (blipFill) {
          const src = await picture(part, kid(blipFill, 'blip'));
          if (src) {
            const id = newId();
            images.push({ id, source: src });
            put({ ...imageDraft(id, { ...r, x: r.x + ox }, at.rot, ''), naturalW: Math.max(1, Math.round(r.w)), naturalH: Math.max(1, Math.round(r.h)) } as ElementDraft, groupId);
          }
          if (!text) return;
        }
        if (!text && (!fill || fill === 'transparent') && !hasLine) return; // an empty placeholder or an invisible box
        const kind = geom === 'custom' ? null : (PRESETS[geom] ?? null);
        if (!kind) skips.add(geom === 'custom' ? 'Freeform shapes (drawn as rectangles)' : `“${geom}” shapes (drawn as rectangles)`);
        const fontSize = Math.max(8, Math.min(400, Math.round(text?.size ?? (ph && isTitle(ph.type) ? 44 : 18) * (96 / 72))));
        const box = { x: Math.round(r.x + ox), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
        const id = newId();
        if (fileId) byShapeId.set(fileId, { id, rect: box });
        if ((kind ?? 'rect') === 'rect' && !hasLine && !blipFill) {
          // A text box (or a filled box without an outline): text with its background.
          put(
            {
              id,
              type: 'text',
              ...box,
              rotation: at.rot,
              text: text?.html ?? '',
              fontFamily: fontFamily(text?.font),
              fontSize,
              textColor: text?.color ?? colors.get('dk1') ?? '#000000',
              align: text?.align ?? 'left',
              background: fill ?? 'transparent',
              autoWidth: false,
            } as ElementDraft,
            groupId,
          );
          return;
        }
        put(
          {
            ...shapeDraft(id, kind ?? 'rect', box, ''),
            rotation: at.rot,
            text: text?.html ?? '',
            fill: blipFill ? 'transparent' : (fill ?? 'transparent'),
            stroke: hasLine ? lineColor! : 'transparent',
            strokeWidth: lineW,
            strokeStyle,
            fontFamily: fontFamily(text?.font),
            fontSize,
            textColor: text?.color ?? (style ? (colorIn(kid(style, 'fontRef'), colors) ?? colors.get('lt1')) : colors.get('dk1')) ?? '#000000',
            align: text?.align ?? 'center',
            vAlign: text?.vAlign ?? 'middle',
          } as ElementDraft,
          groupId,
        );
        return;
      }
      if (local === 'pic') {
        const ph = placeholderOf(el);
        if (ph && layer !== 'slide') return;
        const from = inherited(ph);
        const at = rectOf(kid(kid(el, 'spPr'), 'xfrm')) ?? rectOf(kid(kid(from.layout, 'spPr'), 'xfrm'));
        if (!at) return;
        const r = xf(at.r);
        const nvPr = kid(kid(el, 'nvPicPr'), 'nvPr');
        const media = [...(nvPr?.getElementsByTagName('*') ?? [])].find((e) => e.localName === 'videoFile' || e.localName === 'audioFile' || e.localName === 'media');
        const blipFill = kid(el, 'blipFill');
        const src = await picture(part, kid(blipFill, 'blip'));
        if (media) skips.add(src ? 'Videos and sounds (placed as their poster picture)' : 'Videos and sounds (placed as a labelled box)');
        if (!src) {
          if (media) labelledBox({ ...r, x: r.x + ox }, 'Video (not imported)', at.rot, groupId);
          return;
        }
        const crop = kid(blipFill, 'srcRect');
        const f = (a: string) => Math.max(0, Math.min(1, Number(crop?.getAttribute(a) ?? 0) / 100000 || 0));
        const c = { x: f('l'), y: f('t'), w: 1 - f('l') - f('r'), h: 1 - f('t') - f('b') };
        const cropped = crop && c.w > 0.01 && c.h > 0.01 && (c.x > 0 || c.y > 0 || c.w < 1 || c.h < 1);
        const id = newId();
        images.push({ id, source: src });
        const alt = (kid(kid(el, 'nvPicPr'), 'cNvPr')?.getAttribute('descr') ?? '').slice(0, 500);
        put(
          {
            ...imageDraft(id, { ...r, x: r.x + ox }, at.rot, alt),
            naturalW: Math.max(1, Math.round(r.w / (cropped ? c.w : 1))),
            naturalH: Math.max(1, Math.round(r.h / (cropped ? c.h : 1))),
            ...(cropped ? { crop: c } : {}),
          } as ElementDraft,
          groupId,
        );
        return;
      }
      if (local === 'graphicFrame') {
        const at = rectOf(kid(el, 'xfrm'));
        if (!at) return;
        const r = xf(at.r);
        const data = kid(kid(el, 'graphic'), 'graphicData');
        const uri = data?.getAttribute('uri') ?? '';
        if (uri.endsWith(NS_TABLE)) return table(kid(data, 'tbl'), { ...r, x: r.x + ox }, groupId);
        if (uri.endsWith(NS_OLE)) {
          // An embedded object: its picture, when the file keeps one.
          const pic = [...(data?.getElementsByTagName('*') ?? [])].find((e) => e.localName === 'pic');
          const src = pic ? await picture(part, kid(kid(pic, 'blipFill'), 'blip')) : null;
          if (src) {
            const id = newId();
            images.push({ id, source: src });
            put({ ...imageDraft(id, { ...r, x: r.x + ox }, 0, ''), naturalW: Math.max(1, Math.round(r.w)), naturalH: Math.max(1, Math.round(r.h)) } as ElementDraft, groupId);
            skips.add('Embedded objects (placed as their picture)');
          } else {
            labelledBox({ ...r, x: r.x + ox }, 'Embedded object (not imported)', 0, groupId);
            skips.add('Embedded objects (placed as a labelled box)');
          }
          return;
        }
        const what = uri.endsWith(NS_CHART) ? 'Chart' : uri.endsWith(NS_DIAGRAM) ? 'SmartArt' : 'Object';
        labelledBox({ ...r, x: r.x + ox }, `${what} (not imported)`, 0, groupId);
        skips.add(what === 'Chart' ? 'Charts (placed as a labelled box)' : what === 'SmartArt' ? 'SmartArt (placed as a labelled box)' : 'Other objects (placed as a labelled box)');
      }
    };

    const table = (tbl: Element | null, r: Rect, groupId: string | null) => {
      if (!tbl) return;
      const cols = kids(kid(tbl, 'tblGrid') ?? tbl, 'gridCol').map((c) => ({ id: newId(), w: Math.max(24, Math.round(Number(c.getAttribute('w')) / EMU) || 96) }));
      const trs = kids(tbl, 'tr');
      if (!cols.length || !trs.length) return;
      if (cols.length * trs.length > MAX_ITEMS) throw new ImportError('A table in this deck is larger than Freero imports.');
      const rows = trs.map((tr) => ({ id: newId(), h: Math.max(24, Math.round(Number(tr.getAttribute('h')) / EMU) || 40) }));
      const cells: TableCopyContent = {};
      let fontSize: number | null = null;
      let merged = false;
      trs.forEach((tr, ri) => {
        kids(tr, 'tc')
          .slice(0, cols.length)
          .forEach((tc, ci) => {
            budget.tick();
            if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1' || Number(tc.getAttribute('gridSpan') ?? 1) > 1 || Number(tc.getAttribute('rowSpan') ?? 1) > 1) merged = true;
            const t = textOf(tc, [], false, []);
            const f = fillOf(kid(tc, 'tcPr'), colors);
            if (t && fontSize === null && t.size) fontSize = Math.round(t.size);
            if (t || (f && f !== 'transparent')) cells[`${rows[ri].id}:${cols[ci].id}`] = { ...(t ? { t: t.html } : {}), ...(f && f !== 'transparent' ? { f } : {}) };
          });
      });
      if (merged) skips.add('Merged table cells (split again)');
      const id = newId();
      const w = cols.reduce((s, c) => s + c.w, 0);
      const h = rows.reduce((s, c) => s + c.h, 0);
      content[id] = cells;
      put({ id, type: 'table', x: Math.round(r.x), y: Math.round(r.y), w, h, rotation: 0, rows, cols, header: kid(tbl, 'tblPr')?.getAttribute('firstRow') === '1', fontSize: fontSize ?? 18 } as ElementDraft, groupId);
    };

    // The background: the slide's, else its layout's, else its master's.
    const bgOf = (doc: Element | null) => kid(kid(kid(doc, 'cSld'), 'bg'), 'bgPr') ?? kid(kid(kid(doc, 'cSld'), 'bg'), 'bgRef');
    const bgSources: Array<[Element | null, Part | null]> = [
      [bgOf(sld), slidePart],
      [bgOf(layout?.documentElement ?? null), layoutPath ? { path: layoutPath, rels: await pkg.rels(layoutPath) } : null],
      [bgOf(master?.documentElement ?? null), masterPath ? { path: masterPath, rels: await pkg.rels(masterPath) } : null],
    ];
    let background = '#FFFFFF';
    for (const [bg, part] of bgSources) {
      if (!bg || !part) continue;
      const blip = kid(kid(bg, 'blipFill'), 'blip');
      if (blip) {
        const src = await picture(part, blip);
        if (src) {
          const id = newId();
          images.push({ id, source: src });
          put({ ...imageDraft(id, { x: ox, y: 0, w: slideW, h: slideH }, 0, ''), naturalW: slideW, naturalH: slideH } as ElementDraft, null);
        }
        break;
      }
      const c = bg.localName === 'bgRef' ? colorIn(bg, colors) : fillOf(bg, colors);
      if (c && c !== 'transparent') {
        background = c;
        break;
      }
    }

    // The master's and layout's own artwork (logos, bands) under the slide's, unless switched off.
    const id: Xf = (r) => r;
    const showLayoutArt = sld.getAttribute('showMasterSp') !== '0';
    const showMasterArt = showLayoutArt && layout?.documentElement.getAttribute('showMasterSp') !== '0';
    if (showMasterArt && masterTree && masterPath) for (const c of [...masterTree.children]) await visit(c, { path: masterPath, rels: await pkg.rels(masterPath) }, id, null, 'master');
    if (showLayoutArt && layoutTree && layoutPath) for (const c of [...layoutTree.children]) await visit(c, { path: layoutPath, rels: await pkg.rels(layoutPath) }, id, null, 'layout');
    const tree = kid(kid(sld, 'cSld'), 'spTree');
    for (const c of tree ? [...tree.children] : []) await visit(c, slidePart, id, null, 'slide');

    // Lines glued to shapes stay glued to them.
    for (const g of glue) {
      const a = g.start ? byShapeId.get(g.start) : undefined;
      const b = g.end ? byShapeId.get(g.end) : undefined;
      const d = g.draft as unknown as { start: Record<string, unknown>; end: Record<string, unknown> };
      if (a) d.start = { ...d.start, elementId: a.id, anchor: 'auto' };
      if (b) d.end = { ...d.end, elementId: b.id, anchor: 'auto' };
    }

    drafts.push({
      id: frameId,
      type: 'frame',
      x: ox,
      y: 0,
      w: slideW,
      h: slideH,
      rotation: 0,
      title: title || `Slide ${si + 1}`,
      fill: background,
      index: si,
      preset,
      ...(sld.getAttribute('show') === '0' ? { skip: true } : {}),
    } as ElementDraft);
    drafts.push(...slideItems);

    // Speaker notes: the notes slide's body text.
    const notesPath = (await pkg.relOfType(slidePath, '/notesSlide'))?.target;
    const nx = notesPath ? await pkg.xml(notesPath) : null;
    const ntree = nx ? kid(kid(nx.documentElement, 'cSld'), 'spTree') : null;
    const lines: string[] = [];
    for (const sp of ntree ? kids(ntree, 'sp') : []) {
      if (placeholderOf(sp)?.type !== 'body') continue;
      for (const p of kids(kid(sp, 'txBody') ?? sp, 'p')) lines.push([...p.getElementsByTagName('*')].filter((e) => e.localName === 't').map((t) => t.textContent ?? '').join(''));
    }
    const note = lines.join('\n').trim();
    if (note) notes.push({ frameId, text: note.slice(0, 10_000) });
  }

  if (drafts.length > MAX_ITEMS) throw new ImportError(`This deck has more than ${MAX_ITEMS} items; Freero imports up to ${MAX_ITEMS} at a time.`);
  return { drafts, images, notes, content, report: { source: 'PowerPoint', imported: 0, skipped: skips.list() } };
}
