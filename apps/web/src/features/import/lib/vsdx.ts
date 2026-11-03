// Visio files (`.vsdx`, also what Lucidchart and draw.io export as "Visio") → Freero element drafts.
// Implemented from the published VSDX format (an Open Packaging zip: visio/document.xml with its
// style sheets, visio/pages/pageN.xml with Shapes and Connects, visio/masters/masterN.xml with
// the stencil shapes instances inherit from, visio/media/* pictures); no Microsoft code, stencil or
// artwork is used. Values are in inches with y up; the board is 96 units an inch, y down.
//
// How shapes map: a master (stencil shape) Freero has a counterpart for becomes that shape kind
// (flowchart, basic, UML, BPMN, ERD, network); a shape without one is recognised from its geometry
// (a rectangle, a rounded rectangle, an ellipse, a diamond, …); anything else becomes a labelled
// rectangle, or its outline as pen strokes when it has no text, and the report says so.
// Connectors stay glued to the shapes the file glues them to (a connection point becomes `at`),
// groups become one Freero group, containers and swimlanes frames, pictures images, and every
// page a frame of its own, side by side.
//
// Untrusted input: the zip is read with entry, size, unpacked-size and time limits (zip.ts),
// any DOCTYPE / ENTITY is refused before parsing, external relationships are never followed, and
// text stays plain text.
import { connectorDraft, frameDraft, shapeDraft, textDraft, type CapStyle, type ConnectorEndpoint, type ElementDraft, type Rect, type ShapeKind } from '@freero/shared';
import {
  attachedEnd,
  boundsOf,
  color,
  coord,
  freeEnd,
  ImportError,
  imageDraft,
  lineBox,
  MAX_FILE_BYTES,
  MAX_ITEMS,
  MAX_UNPACKED_BYTES,
  penDraft,
  richLabel,
  size,
  Skips,
  type ImportResult,
} from './common';
import { ZipPackage } from './zip';
import { base64, kids, OpcPackage, relAttr as relId, sniffImage } from './opc';

/** Board units per inch. */
const IN = 96;
/** Parts a package may hold, pictures one may carry, and how long reading may take. */
export const VSDX_LIMITS = { entries: 2000, imageBytes: 10 * 1024 * 1024, timeMs: 20_000 } as const;
const MAX_ROWS = 4000;

/** A Visio drawing by its name (`.vsdx`, macro-enabled `.vsdm`). */
export const isVsdxName = (name: string) => /\.vsd[xm]$/i.test(name);

// ------------------------------------------------------------------------------------ sheets

interface CellV {
  v: string | null;
  f: string | null;
}
interface Row {
  t: string | null;
  cells: Map<string, CellV>;
  del: boolean;
}
interface Section {
  cells: Map<string, CellV>;
  rows: Map<string, Row>;
  del: boolean;
}
/** A shape, master shape or style sheet as written (only its own, local values). */
interface Sheet {
  id: string;
  type: string;
  name: string;
  master: string | null;
  masterShape: string | null;
  style: { line: string | null; fill: string | null; text: string | null };
  cells: Map<string, CellV>;
  /** By name; geometry sections by `Geometry#<IX>`. */
  sections: Map<string, Section>;
  /** null: no Text element (inherits); '' : empty text. */
  text: string | null;
  foreign: { rel: string | null; type: string; compression: string } | null;
  children: Sheet[];
}

function readCells(el: Element): Map<string, CellV> {
  const out = new Map<string, CellV>();
  for (const c of kids(el, 'Cell')) {
    const n = c.getAttribute('N');
    if (n) out.set(n, { v: c.getAttribute('V'), f: c.getAttribute('F') });
  }
  return out;
}

function readSheet(el: Element, budget: Budget): Sheet {
  budget.tick();
  const sections = new Map<string, Section>();
  for (const s of kids(el, 'Section')) {
    const n = s.getAttribute('N') ?? '';
    const rows = new Map<string, Row>();
    let i = 0;
    for (const r of kids(s, 'Row')) {
      if (rows.size >= MAX_ROWS) throw new ImportError('A shape in this file has more geometry than Freero imports.');
      rows.set(r.getAttribute('IX') ?? r.getAttribute('N') ?? `#${i}`, { t: r.getAttribute('T'), cells: readCells(r), del: r.getAttribute('Del') === '1' });
      i++;
    }
    sections.set(n === 'Geometry' ? `Geometry#${s.getAttribute('IX') ?? '0'}` : n, { cells: readCells(s), rows, del: s.getAttribute('Del') === '1' });
  }
  const textEl = kids(el, 'Text')[0];
  const fd = kids(el, 'ForeignData')[0];
  const rel = fd ? kids(fd, 'Rel')[0] : undefined;
  const shapes = kids(el, 'Shapes')[0];
  return {
    id: el.getAttribute('ID') ?? '',
    type: el.getAttribute('Type') ?? 'Shape',
    name: el.getAttribute('NameU') ?? el.getAttribute('Name') ?? '',
    master: el.getAttribute('Master'),
    masterShape: el.getAttribute('MasterShape'),
    style: { line: el.getAttribute('LineStyle'), fill: el.getAttribute('FillStyle'), text: el.getAttribute('TextStyle') },
    cells: readCells(el),
    sections,
    text: textEl ? (textEl.textContent ?? '').replace(/\u2028|\r\n?/g, '\n').replace(/\n+$/, '') : null,
    foreign: fd ? { rel: rel ? relId(rel) : null, type: fd.getAttribute('ForeignType') ?? '', compression: fd.getAttribute('CompressionType') ?? '' } : null,
    children: shapes ? kids(shapes, 'Shape').map((c) => readSheet(c, budget)) : [],
  };
}

class Budget {
  private n = 0;
  constructor(private readonly zip: ZipPackage) {}
  tick() {
    if (++this.n % 64 === 0) this.zip.checkTime();
    if (this.n > MAX_ITEMS * 4) throw new ImportError(`This drawing has more than ${MAX_ITEMS} items; Freero imports up to ${MAX_ITEMS} at a time.`);
  }
}

// ------------------------------------------------------------------------------------ values

const VISIO_COLORS = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#800000', '#008000', '#000080', '#808000',
  '#800080', '#008080', '#C0C0C0', '#E6E6E6', '#CDCDCD', '#B3B3B3', '#9A9A9A', '#808080', '#666666', '#4D4D4D', '#333333', '#1A1A1A',
];

const num = (c: CellV | undefined, d: number) => {
  const n = c?.v === null || c?.v === undefined || c.v === '' ? NaN : Number(c.v);
  return Number.isFinite(n) ? n : d;
};

function colorOf(c: CellV | undefined, fallback: string, table: Map<number, string>): string {
  const v = c?.v?.trim();
  if (!v) return fallback;
  if (/^\d+$/.test(v)) return table.get(Number(v)) ?? VISIO_COLORS[Number(v)] ?? fallback;
  return color(v, fallback) === 'transparent' ? fallback : color(v, fallback);
}

/** Which style sheet a cell inherits from when neither the shape nor its master sets it. */
function styleKind(name: string): 'line' | 'fill' | 'text' {
  if (/^(Line|BeginArrow|EndArrow|Rounding|Compound)/.test(name)) return 'line';
  if (/^(Fill|Shdw)/.test(name)) return 'fill';
  return 'text';
}

// ------------------------------------------------------------------------------------ shapes

const NORM = (s: string) => s.replace(/\.\d+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Stencil shapes (by their universal name) that have a Freero counterpart. */
const MASTERS: Record<string, ShapeKind> = {
  // Basic
  rectangle: 'rect', square: 'rect', roundedrectangle: 'roundRect', roundedsquare: 'roundRect', roundrectangle: 'roundRect',
  ellipse: 'ellipse', circle: 'ellipse', oval: 'ellipse', triangle: 'triangle', pentagon: 'pentagon', hexagon: 'hexagon',
  octagon: 'octagon', diamond: 'diamond', rhombus: 'diamond', parallelogram: 'parallelogram', trapezoid: 'trapezoid',
  star: 'star', '5pointstar': 'star', star5: 'star', cross: 'cross', plus: 'cross', cloud: 'cloud', can: 'cylinder', cylinder: 'cylinder',
  rightarrow: 'arrowRight', arrowright: 'arrowRight', leftarrow: 'arrowLeft', arrowleft: 'arrowLeft', chevron: 'chevron',
  callout: 'callout', speechbubble: 'speech', wordballoon: 'speech',
  // Flowchart
  process: 'rect', decision: 'diamond', terminator: 'terminator', startend: 'terminator', data: 'parallelogram', inputoutput: 'parallelogram',
  document: 'document', multipledocuments: 'multiDocument', multidocument: 'multiDocument', predefinedprocess: 'predefinedProcess',
  subprocess: 'predefinedProcess', storeddata: 'storedData', internalstorage: 'internalStorage', manualinput: 'manualInput',
  manualoperation: 'manualOperation', card: 'punchedCard', papertape: 'punchedTape', punchedtape: 'punchedTape', display: 'display',
  preparation: 'hexagon', looplimit: 'loopLimit', merge: 'merge', extract: 'triangle', collate: 'collate', sort: 'sort', or: 'orJunction',
  summingjunction: 'summingJunction', offpagereference: 'offPageRef', onpagereference: 'ellipse', delay: 'delay', database: 'cylinder',
  // UML
  class: 'umlClass', interface: 'umlClass', actor: 'umlActor', usecase: 'ellipse', package: 'umlPackage', note: 'umlNote',
  comment: 'umlNote', component: 'umlComponent', node: 'umlNode', lifeline: 'umlLifeline', objectlifeline: 'umlLifeline',
  activation: 'umlActivation', fragment: 'umlFragment', combinedfragment: 'umlFragment', action: 'roundRect', activity: 'roundRect',
  state: 'roundRect', finalnode: 'bpmnEnd', finalstate: 'bpmnEnd', initialnode: 'ellipse', initialstate: 'ellipse',
  // BPMN
  task: 'roundRect', collapsedsubprocess: 'bpmnSubprocess', expandedsubprocess: 'bpmnSubprocess', startevent: 'ellipse',
  intermediateevent: 'bpmnIntermediate', endevent: 'bpmnEnd', gateway: 'bpmnGatewayX', exclusivegateway: 'bpmnGatewayX',
  parallelgateway: 'bpmnGatewayPlus', inclusivegateway: 'bpmnGatewayO', dataobject: 'document', datastore: 'cylinder',
  textannotation: 'umlNote',
  // Entity relationship
  entity: 'erdEntity',
  // Network
  server: 'netServer', firewall: 'netFirewall', router: 'netRouter', switch: 'netSwitch', monitor: 'netMonitor', laptop: 'netLaptop',
  phone: 'netPhone', user: 'netUser', pc: 'netMonitor', workstation: 'netMonitor',
};
/** Masters drawn filled with ink (UML initial nodes). */
const SOLID = new Set(['initialnode', 'initialstate']);

/** Visio's line-end gallery (by number) → the nearest Freero end; numbers not listed draw as an arrow, reported. */
const ARROWS: Record<number, CapStyle> = {
  0: 'none', 1: 'arrow', 2: 'triangle', 3: 'arrow', 4: 'triangle', 5: 'triangle', 6: 'triangle', 7: 'arrow', 8: 'triangle',
  9: 'arrow', 10: 'circle', 11: 'triangle', 12: 'bar', 13: 'triangle', 14: 'triangleOpen', 15: 'arrow', 20: 'circleOpen',
  21: 'diamond', 22: 'diamondOpen',
};

interface Pt {
  x: number;
  y: number;
}

/** Local → page coordinates of a sheet, composed with its parents'. */
type Xf = (p: Pt) => Pt;

interface Geo {
  noFill: boolean;
  noLine: boolean;
  /** Subpaths in the shape's local coordinates (inches, y up). */
  paths: Pt[][];
  curved: boolean;
  ellipse: boolean;
}

// ------------------------------------------------------------------------------------ the parser

interface PageInfo {
  name: string;
  path: string;
  w: number;
  h: number;
  scale: number;
}

interface Emitted {
  /** Element id. */
  id: string;
  rect: Rect;
  rotation: number;
}

/**
 * Turns a `.vsdx` package into Freero drafts; `bytes` is the whole file. Throws ImportError (a
 * message for the person) for a file it refuses; nothing is added then.
 */
export async function parseVsdx(bytes: Uint8Array, newId: () => string, opts: { timeLimitMs?: number } = {}): Promise<ImportResult> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ImportError(`That file is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new ImportError('This is an older Visio file (.vsd). Save it as .vsdx in Visio and import that.');
  const zip = ZipPackage.open(bytes, {
    maxEntries: VSDX_LIMITS.entries,
    maxEntryBytes: MAX_UNPACKED_BYTES,
    maxTotalBytes: MAX_UNPACKED_BYTES * 2,
    deadline: Date.now() + (opts.timeLimitMs ?? VSDX_LIMITS.timeMs),
  });
  const budget = new Budget(zip);
  const pkg = new OpcPackage(zip, 'Visio file');
  const docPath = (await pkg.relOfType('_rels/.rels', '/document'))?.target ?? (zip.has('visio/document.xml') ? 'visio/document.xml' : null);
  const docXml = docPath ? await pkg.xml(docPath) : null;
  if (!docPath || !docXml || docXml.documentElement.localName !== 'VisioDocument') throw new ImportError('This isn’t a Visio drawing (.vsdx).');

  // Style sheets and the document's colour table.
  const styles = new Map<string, Sheet>();
  const colors = new Map<number, string>();
  for (const el of [...docXml.getElementsByTagName('*')]) {
    if (el.localName === 'StyleSheet') {
      const s = readSheet(el, budget);
      styles.set(s.id, s);
    } else if (el.localName === 'ColorEntry') {
      const ix = Number(el.getAttribute('IX'));
      const rgb = el.getAttribute('RGB');
      if (Number.isInteger(ix) && rgb) colors.set(ix, color(rgb, '#000000'));
    }
  }

  // Masters (stencil shapes), read when an instance names one.
  const mastersPath = (await pkg.relOfType(docPath, '/masters'))?.target;
  const masterIndex = new Map<string, { name: string; rel: string | null }>();
  if (mastersPath) {
    const mx = await pkg.xml(mastersPath);
    for (const m of mx ? [...mx.documentElement.children].filter((c) => c.localName === 'Master') : []) {
      const rel = kids(m, 'Rel')[0];
      masterIndex.set(m.getAttribute('ID') ?? '', { name: m.getAttribute('NameU') ?? m.getAttribute('Name') ?? '', rel: rel ? relId(rel) : null });
    }
  }
  const masters = new Map<string, { name: string; top: Sheet | null; byId: Map<string, Sheet> } | null>();
  const masterOf = async (id: string) => {
    if (masters.has(id)) return masters.get(id)!;
    const info = masterIndex.get(id);
    let out: { name: string; top: Sheet | null; byId: Map<string, Sheet> } | null = null;
    if (info && mastersPath) {
      const rel = info.rel ? (await pkg.rels(mastersPath)).get(info.rel) : undefined;
      const x = rel && !rel.external ? await pkg.xml(rel.target) : null;
      const shapes = x ? [...x.documentElement.children].find((c) => c.localName === 'Shapes') : undefined;
      const tops = shapes ? kids(shapes, 'Shape').map((s) => readSheet(s, budget)) : [];
      const byId = new Map<string, Sheet>();
      const index = (s: Sheet) => {
        byId.set(s.id, s);
        s.children.forEach(index);
      };
      tops.forEach(index);
      out = { name: info.name, top: tops.length === 1 ? tops[0] : null, byId };
    } else if (info) out = { name: info.name, top: null, byId: new Map() };
    masters.set(id, out);
    return out;
  };

  // Pages.
  const pagesPath = (await pkg.relOfType(docPath, '/pages'))?.target;
  const pagesXml = pagesPath ? await pkg.xml(pagesPath) : null;
  if (!pagesPath || !pagesXml) throw new ImportError('This Visio file has no pages.');
  const skips = new Skips();
  const pages: PageInfo[] = [];
  for (const p of [...pagesXml.documentElement.children].filter((c) => c.localName === 'Page')) {
    if (p.getAttribute('Background') === '1') {
      skips.add('Background pages (left out)');
      continue;
    }
    const rel = kids(p, 'Rel')[0];
    const target = rel ? (await pkg.rels(pagesPath)).get(relId(rel) ?? '') : undefined;
    if (!target || target.external) continue;
    const sheet = kids(p, 'PageSheet')[0];
    const cells = sheet ? readCells(sheet) : new Map<string, CellV>();
    const drawingScale = num(cells.get('DrawingScale'), 1) || 1;
    pages.push({
      name: (p.getAttribute('Name') ?? p.getAttribute('NameU') ?? `Page-${pages.length + 1}`).slice(0, 200),
      path: target.target,
      w: num(cells.get('PageWidth'), 8.5),
      h: num(cells.get('PageHeight'), 11),
      scale: Math.max(1e-4, Math.min(1e4, num(cells.get('PageScale'), 1) / drawingScale)),
    });
  }
  if (!pages.length) throw new ImportError('This Visio file has no pages.');

  const drafts: ElementDraft[] = [];
  const images: ImportResult['images'] = [];
  let pageX = 0;

  for (const page of pages) {
    const x = await pkg.xml(page.path);
    if (!x) continue;
    const root = x.documentElement;
    const shapesEl = [...root.children].find((c) => c.localName === 'Shapes');
    const top = shapesEl ? kids(shapesEl, 'Shape').map((s) => readSheet(s, budget)) : [];
    const pageRels = await pkg.rels(page.path);
    const toBoard = (p: Pt): Pt => ({ x: coord(p.x * page.scale * IN), y: coord((page.h - p.y) * page.scale * IN) });

    // Resolution of a sheet's values: its own, then its master shape's, then its style sheets'.
    interface Node {
      sheet: Sheet;
      master: Sheet | null;
      masterName: string;
      masterId: string | null;
      parent: Node | null;
      xf: Xf;
      parentXf: Xf;
    }
    const styleCell = (styleId: string | null, name: string, kind: 'line' | 'fill' | 'text', depth = 0): CellV | undefined => {
      const s = styleId === null ? undefined : styles.get(styleId);
      if (!s || depth > 20) return undefined;
      return s.cells.get(name) ?? styleCell(s.style[kind], name, kind, depth + 1);
    };
    const styleRow = (styleId: string | null, section: string, row: string, cell: string, depth = 0): CellV | undefined => {
      const s = styleId === null ? undefined : styles.get(styleId);
      if (!s || depth > 20) return undefined;
      return s.sections.get(section)?.rows.get(row)?.cells.get(cell) ?? styleRow(s.style.text, section, row, cell, depth + 1);
    };
    const styleIdOf = (n: Node, kind: 'line' | 'fill' | 'text') => n.sheet.style[kind] ?? n.master?.style[kind] ?? null;
    const cell = (n: Node, name: string): CellV | undefined => n.sheet.cells.get(name) ?? n.master?.cells.get(name) ?? styleCell(styleIdOf(n, styleKind(name)), name, styleKind(name));
    const rowCell = (n: Node, section: string, row: string, name: string): CellV | undefined => {
      const own = n.sheet.sections.get(section)?.rows.get(row);
      if (own?.del) return undefined;
      return own?.cells.get(name) ?? n.master?.sections.get(section)?.rows.get(row)?.cells.get(name) ?? styleRow(styleIdOf(n, 'text'), section, row, name);
    };
    const textOf = (n: Node) => (n.sheet.text ?? n.master?.text ?? '').trim();
    const userValue = (n: Node, row: string) => n.sheet.sections.get('User')?.rows.get(row)?.cells.get('Value')?.v ?? n.master?.sections.get('User')?.rows.get(row)?.cells.get('Value')?.v ?? '';

    const node = async (sheet: Sheet, parent: Node | null): Promise<Node> => {
      let master: Sheet | null = null;
      let masterName = '';
      const masterId = sheet.master ?? parent?.masterId ?? null;
      if (sheet.master) {
        const m = await masterOf(sheet.master);
        masterName = m?.name ?? '';
        master = (sheet.masterShape ? m?.byId.get(sheet.masterShape) : m?.top) ?? null;
      } else if (sheet.masterShape && masterId) {
        const m = await masterOf(masterId);
        master = m?.byId.get(sheet.masterShape) ?? null;
      }
      const n: Node = { sheet, master, masterName, masterId, parent, xf: (p) => p, parentXf: parent ? parent.xf : (p) => p };
      const w = num(cell(n, 'Width'), 0);
      const h = num(cell(n, 'Height'), 0);
      const pinX = num(cell(n, 'PinX'), 0);
      const pinY = num(cell(n, 'PinY'), 0);
      const locX = num(cell(n, 'LocPinX'), w / 2);
      const locY = num(cell(n, 'LocPinY'), h / 2);
      const a = num(cell(n, 'Angle'), 0);
      const fx = num(cell(n, 'FlipX'), 0) === 1;
      const fy = num(cell(n, 'FlipY'), 0) === 1;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const up = n.parentXf;
      n.xf = (p) => {
        let lx = p.x - locX;
        let ly = p.y - locY;
        if (fx) lx = -lx;
        if (fy) ly = -ly;
        return up({ x: pinX + lx * cos - ly * sin, y: pinY + lx * sin + ly * cos });
      };
      return n;
    };

    /** A connection point in the shape's local coordinates (one inherited from the master scaled to this shape's size). */
    const connectionPoint = (n: Node, ix: string): Pt | null => {
      const own = n.sheet.sections.get('Connection')?.rows.get(ix);
      const inh = n.master?.sections.get('Connection')?.rows.get(ix);
      if (own?.del || (!own && !inh)) return null;
      const { w, h } = dims(n);
      const mw = n.master ? num(n.master.cells.get('Width'), w) || w : w;
      const mh = n.master ? num(n.master.cells.get('Height'), h) || h : h;
      const at = (name: 'X' | 'Y', full: number, masterFull: number) => {
        const c = own?.cells.get(name);
        return c ? num(c, 0) : (num(inh?.cells.get(name), 0) * full) / (masterFull || 1);
      };
      return { x: at('X', w, mw), y: at('Y', h, mh) };
    };
    const angleOf = (n: Node | null): number => (n ? num(cell(n, 'Angle'), 0) + angleOf(n.parent) : 0);
    const dims = (n: Node) => ({ w: num(cell(n, 'Width'), 0), h: num(cell(n, 'Height'), 0) });

    /** The shape's geometry sections, its own merged over its master's (by section and row). */
    const geometry = (n: Node): Geo[] => {
      const { w, h } = dims(n);
      const mw = n.master ? num(n.master.cells.get('Width'), w) || w : w;
      const mh = n.master ? num(n.master.cells.get('Height'), h) || h : h;
      const keys = new Set<string>();
      for (const k of [...(n.master?.sections.keys() ?? []), ...n.sheet.sections.keys()]) if (k.startsWith('Geometry#')) keys.add(k);
      const out: Geo[] = [];
      for (const key of [...keys].sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)))) {
        const own = n.sheet.sections.get(key);
        const inh = n.master?.sections.get(key);
        if (own?.del) continue;
        const sc = (name: string) => own?.cells.get(name) ?? inh?.cells.get(name);
        if (num(sc('NoShow'), 0) === 1) continue;
        const rowKeys = [...new Set([...(inh?.rows.keys() ?? []), ...(own?.rows.keys() ?? [])])].sort((a, b) => Number(a) - Number(b));
        const geo: Geo = { noFill: num(sc('NoFill'), 0) === 1, noLine: num(sc('NoLine'), 0) === 1, paths: [], curved: false, ellipse: false };
        let cur: Pt[] = [];
        let last: Pt = { x: 0, y: 0 };
        const flush = () => {
          if (cur.length > 1) geo.paths.push(cur);
          cur = [];
        };
        for (const rk of rowKeys) {
          budget.tick();
          const ownRow = own?.rows.get(rk);
          const inhRow = inh?.rows.get(rk);
          if (ownRow?.del) continue;
          const t = ownRow?.t ?? inhRow?.t ?? '';
          // A value inherited from the master was computed for the master's size: scale it.
          const v = (name: string, axis: 'x' | 'y' | null, d = 0) => {
            const c = ownRow?.cells.get(name);
            if (c) return num(c, d);
            const ic = inhRow?.cells.get(name);
            const raw = num(ic, d);
            return axis === 'x' ? (raw * w) / (mw || 1) : axis === 'y' ? (raw * h) / (mh || 1) : raw;
          };
          const rel = t.startsWith('Rel');
          const X = (name: string) => (rel ? v(name, null) * w : v(name, 'x'));
          const Y = (name: string) => (rel ? v(name, null) * h : v(name, 'y'));
          const end = { x: X('X'), y: Y('Y') };
          switch (t) {
            case 'MoveTo':
            case 'RelMoveTo':
              flush();
              cur = [end];
              break;
            case 'LineTo':
            case 'RelLineTo':
            case 'SplineStart':
            case 'SplineKnot':
              if (!cur.length) cur = [last];
              cur.push(end);
              break;
            case 'ArcTo': {
              if (!cur.length) cur = [last];
              const bow = v('A', 'x');
              if (Math.abs(bow) > 1e-9) {
                const mid = { x: (last.x + end.x) / 2, y: (last.y + end.y) / 2 };
                const dx = end.x - last.x;
                const dy = end.y - last.y;
                const len = Math.hypot(dx, dy) || 1;
                // Positive bow: the arc bulges to the right of the way it is drawn.
                cur.push(...arcThrough(last, { x: mid.x + (dy / len) * bow, y: mid.y - (dx / len) * bow }, end));
                geo.curved = true;
              } else cur.push(end);
              break;
            }
            case 'EllipticalArcTo':
            case 'RelEllipticalArcTo': {
              if (!cur.length) cur = [last];
              const ctrl = { x: X('A'), y: Y('B') };
              cur.push(...ellipticalArc(last, ctrl, end, v('C', null), v('D', null, 1) || 1));
              geo.curved = true;
              break;
            }
            case 'RelCubBezTo':
            case 'RelQuadBezTo': {
              if (!cur.length) cur = [last];
              const c1 = { x: X('A'), y: Y('B') };
              const c2 = t === 'RelCubBezTo' ? { x: X('C'), y: Y('D') } : c1;
              for (let i = 1; i <= 12; i++) {
                const s = i / 12;
                const k = 1 - s;
                cur.push({
                  x: k * k * k * last.x + 3 * k * k * s * c1.x + 3 * k * s * s * c2.x + s * s * s * end.x,
                  y: k * k * k * last.y + 3 * k * k * s * c1.y + 3 * k * s * s * c2.y + s * s * s * end.y,
                });
              }
              geo.curved = true;
              break;
            }
            case 'NURBSTo':
            case 'PolylineTo': {
              // Control points listed in the row's formula (NURBS(…) / POLYLINE(…)): drawn through them.
              if (!cur.length) cur = [last];
              const f = (ownRow?.cells.get(t === 'NURBSTo' ? 'E' : 'A') ?? inhRow?.cells.get(t === 'NURBSTo' ? 'E' : 'A'))?.f ?? '';
              const nums = (/\(([^)]*)\)/.exec(f)?.[1] ?? '').split(',').map(Number);
              if (t === 'NURBSTo' && nums.length >= 8) {
                const [, , xType, yType] = nums;
                for (let i = 4; i + 3 < nums.length && i < 4 * 500; i += 4)
                  cur.push({ x: xType === 0 ? nums[i] * w : nums[i], y: yType === 0 ? nums[i + 1] * h : nums[i + 1] });
                geo.curved = true;
              } else if (t === 'PolylineTo' && nums.length >= 4) {
                const [xType, yType] = nums;
                for (let i = 2; i + 1 < nums.length && i < 2 * 1000; i += 2) cur.push({ x: xType === 0 ? nums[i] * w : nums[i], y: yType === 0 ? nums[i + 1] * h : nums[i + 1] });
              }
              cur.push(end);
              break;
            }
            case 'Ellipse': {
              flush();
              const c = end;
              const a = { x: X('A') - c.x, y: Y('B') - c.y };
              const b = { x: X('C') - c.x, y: Y('D') - c.y };
              const ring: Pt[] = [];
              for (let i = 0; i <= 32; i++) {
                const s = (i / 32) * 2 * Math.PI;
                ring.push({ x: c.x + a.x * Math.cos(s) + b.x * Math.sin(s), y: c.y + a.y * Math.cos(s) + b.y * Math.sin(s) });
              }
              geo.paths.push(ring);
              geo.ellipse = true;
              geo.curved = true;
              continue;
            }
            default:
              continue; // InfiniteLine and unknown rows draw nothing here
          }
          last = end;
        }
        flush();
        if (geo.paths.length) out.push(geo);
      }
      return out;
    };

    // What each Visio shape became (element ids by shape id; a shape inside a group drawn as one
    // shape points at the group's element).
    const emitted = new Map<string, Emitted>();
    const pageDrafts: ElementDraft[] = [];
    const connectors: Array<{ n: Node }> = [];
    const containers: Array<{ id: string; rect: Rect }> = [];
    /** Shapes by id, to find a connection point on the shape a line is glued to. */
    const nodes = new Map<string, Node>();

    const charStyle = (n: Node) => {
      const style = num(rowCell(n, 'Character', '0', 'Style'), 0);
      return {
        bold: (style & 1) === 1,
        italic: (style & 2) === 2,
        underline: (style & 4) === 4,
        size: Math.max(8, Math.min(200, Math.round(num(rowCell(n, 'Character', '0', 'Size'), 12 / 72) * IN))),
        color: colorOf(rowCell(n, 'Character', '0', 'Color'), '#17162B', colors),
      };
    };
    const alignOf = (n: Node) => {
      const a = num(rowCell(n, 'Paragraph', '0', 'HorzAlign'), 1);
      return a === 0 ? 'left' : a === 2 ? 'right' : 'center';
    };
    const lineOf = (n: Node) => {
      const pattern = num(cell(n, 'LinePattern'), 1);
      const px = num(cell(n, 'LineWeight'), 0.01) * IN;
      return {
        stroke: pattern === 0 ? 'transparent' : colorOf(cell(n, 'LineColor'), '#2B2A44', colors),
        strokeWidth: Math.max(1, Math.min(24, Math.round(px * 10) / 10)),
        strokeStyle: (pattern === 3 || pattern === 10 ? 'dotted' : pattern >= 2 ? 'dashed' : 'solid') as 'solid' | 'dashed' | 'dotted',
      };
    };
    const fillOf = (n: Node) => {
      const pattern = num(cell(n, 'FillPattern'), 1);
      const trans = num(cell(n, 'FillForegndTrans'), 0);
      return { fill: pattern === 0 ? 'transparent' : colorOf(cell(n, 'FillForegnd'), '#FFFFFF', colors), fillOpacity: pattern === 0 ? 0 : Math.max(0, Math.min(1, 1 - trans)) };
    };

    /** The element rect (unrotated, around the shape's centre) and its rotation on the board. */
    const placement = (n: Node): { rect: Rect; rotation: number } => {
      const { w, h } = dims(n);
      const c = toBoard(n.xf({ x: w / 2, y: h / 2 }));
      const bw = size(w * page.scale * IN);
      const bh = size(h * page.scale * IN);
      const deg = ((((-angleOf(n) * 180) / Math.PI) % 360) + 360) % 360;
      return { rect: { x: Math.round(c.x - bw / 2), y: Math.round(c.y - bh / 2), w: Math.round(bw), h: Math.round(bh) }, rotation: Math.round(deg * 100) / 100 };
    };

    /** Freero's kind for a geometry it recognises (normalised to the shape's box), else null. */
    const recognise = (geo: Geo[], w: number, h: number, rounding: number): ShapeKind | null => {
      if (geo.length !== 1 || geo[0].paths.length !== 1 || w <= 0 || h <= 0) return null;
      const g = geo[0];
      if (g.ellipse) return 'ellipse';
      const pts = g.paths[0].map((p) => ({ u: p.x / w, v: 1 - p.y / h }));
      const closed = Math.hypot(pts[0].u - pts[pts.length - 1].u, pts[0].v - pts[pts.length - 1].v) < 0.02;
      if (!closed || pts.length < 4) return null;
      const tol = 0.03;
      const onBorder = pts.every((p) => Math.min(Math.abs(p.u), Math.abs(1 - p.u), Math.abs(p.v), Math.abs(1 - p.v)) < tol);
      const fills = Math.min(...pts.map((p) => p.u)) < tol && Math.max(...pts.map((p) => p.u)) > 1 - tol && Math.min(...pts.map((p) => p.v)) < tol && Math.max(...pts.map((p) => p.v)) > 1 - tol;
      if (!fills) return null;
      const corner = (u: number, v: number) => pts.some((p) => Math.abs(p.u - u) < tol && Math.abs(p.v - v) < tol);
      const corners = corner(0, 0) && corner(1, 0) && corner(1, 1) && corner(0, 1);
      if (onBorder && !g.curved && corners) return rounding > 0 ? 'roundRect' : 'rect';
      if (onBorder && g.curved && !corners) return 'roundRect';
      if (g.curved && pts.length >= 8 && pts.every((p) => Math.abs((2 * p.u - 1) ** 2 + (2 * p.v - 1) ** 2 - 1) < 0.08)) return 'ellipse';
      if (g.curved) return null;
      const verts = pts.slice(0, -1);
      if (verts.length === 4 && pts.every((p) => Math.abs(Math.abs(2 * p.u - 1) + Math.abs(2 * p.v - 1) - 1) < tol * 2)) return 'diamond';
      if (verts.length === 3 && corner(0.5, 0) && corner(0, 1) && corner(1, 1)) return 'triangle';
      if (verts.length === 6 && corner(0, 0.5) && corner(1, 0.5) && verts.filter((p) => Math.abs(p.v) < tol || Math.abs(1 - p.v) < tol).length === 4) return 'hexagon';
      if (verts.length === 4) {
        const top = verts.filter((p) => Math.abs(p.v) < tol).map((p) => p.u).sort((a, b) => a - b);
        const bottom = verts.filter((p) => Math.abs(1 - p.v) < tol).map((p) => p.u).sort((a, b) => a - b);
        if (top.length === 2 && bottom.length === 2) {
          const [t0, t1] = top;
          const [b0, b1] = bottom;
          if (Math.abs(t1 - t0 - (b1 - b0)) < tol && Math.abs(t0 - b0) > tol) return 'parallelogram';
          if (Math.abs(t0 - (1 - t1)) < tol && b0 < tol && b1 > 1 - tol && t0 > tol) return 'trapezoid';
        }
      }
      return null;
    };

    const isContainer = (n: Node) => /container|list/i.test(userValue(n, 'msvStructureType')) || /swimlane/i.test(userValue(n, 'msvShapeCategories'));
    const is1D = (n: Node) => cell(n, 'BeginX') !== undefined && cell(n, 'EndX') !== undefined;
    const allText = (n: Node): string[] => [textOf(n), ...n.sheet.children.flatMap((c) => allTextOfSheet(c))].filter(Boolean);
    const allTextOfSheet = (s: Sheet): string[] => [(s.text ?? '').trim(), ...s.children.flatMap(allTextOfSheet)].filter(Boolean);

    const markInside = (s: Sheet, e: Emitted) => {
      for (const c of s.children) {
        emitted.set(c.id, e);
        markInside(c, e);
      }
    };

    const visit = async (sheet: Sheet, parent: Node | null, groupId: string | null): Promise<void> => {
      budget.tick();
      const n = await node(sheet, parent);
      nodes.set(sheet.id, n);
      if (sheet.type === 'Guide') return;
      if (is1D(n)) {
        connectors.push({ n });
        return;
      }
      const { rect, rotation } = placement(n);
      const masterKey = NORM(n.masterName || (n.master ? '' : sheet.name));
      const known = (masterKey && MASTERS[masterKey]) || null;

      if (sheet.foreign) {
        const id = newId();
        const pic = await picture(sheet.foreign);
        if (!pic) return;
        pageDrafts.push({ ...imageDraft(id, rect, rotation, textOf(n).slice(0, 200)), ...(groupId ? { groupId } : {}) } as ElementDraft);
        images.push({ id, source: pic });
        emitted.set(sheet.id, { id, rect, rotation });
        return;
      }
      if (isContainer(n)) {
        const id = newId();
        // A container's heading names it; its members are the shapes drawn inside it.
        pageDrafts.push(frameDraft(id, rect, textOf(n).split('\n')[0].slice(0, 200) || 'Container'));
        containers.push({ id, rect });
        emitted.set(sheet.id, { id, rect, rotation: 0 });
        return;
      }
      // A group drawn by a stencil shape Freero has (a UML class, an entity): one shape, all its text.
      const group = sheet.type === 'Group' && sheet.children.length > 0;
      if (group && !known) {
        const gid = groupId ?? newId();
        const geo = geometry(n);
        if (geo.some((g) => !g.noFill || !g.noLine) || textOf(n)) await drawShape(n, rect, rotation, gid, null, geo);
        for (const c of sheet.children) await visit(c, n, gid);
        return;
      }
      const e = await drawShape(n, rect, rotation, groupId, known, geometry(n), group ? allText(n).join('\n') : undefined, masterKey);
      if (e && group) markInside(sheet, e);
    };

    const drawShape = async (
      n: Node,
      rect: Rect,
      rotation: number,
      groupId: string | null,
      known: ShapeKind | null,
      geo: Geo[],
      text = textOf(n),
      masterKey = '',
    ): Promise<Emitted | null> => {
      const { w, h } = dims(n);
      const what = `“${(n.masterName || n.sheet.name).replace(/\.\d+$/, '') || 'Unnamed'}”`;
      const visible = geo.some((g) => !g.noFill || !g.noLine);
      const ch = charStyle(n);
      const id = newId();
      const put = (d: ElementDraft) => {
        if (groupId) d.groupId = groupId;
        pageDrafts.push(d);
        const e = { id: d.id, rect, rotation };
        emitted.set(n.sheet.id, e);
        return e;
      };
      if (!known && !visible) {
        // Only text (a text block, a title): a text box.
        if (!text) return null;
        const d = { ...textDraft(id, rect.x, rect.y, Math.max(rect.w, 40), text.slice(0, 5000), { size: ch.size, bold: ch.bold, color: ch.color }), align: alignOf(n), rotation } as ElementDraft;
        return put(d);
      }
      let kind = known ?? recognise(geo, w, h, num(cell(n, 'Rounding'), 0));
      if (!kind && !text) {
        // Geometry Freero has no shape for, and nothing written on it: its outline as pen strokes.
        const line = lineOf(n);
        const strokes = geo.flatMap((g) => g.paths).map((path) => penDraft(newId(), path.map((p) => ({ ...toBoard(n.xf(p)), p: 0.5 })), line.stroke === 'transparent' ? '#2B2A44' : line.stroke, line.strokeWidth));
        const ok = strokes.filter((s): s is ElementDraft => !!s);
        if (!ok.length) return null;
        const gid = groupId ?? (ok.length > 1 ? newId() : null);
        for (const s of ok) {
          if (gid) s.groupId = gid;
          pageDrafts.push(s);
        }
        skips.add(`${what} shapes (drawn as outlines)`);
        const e = { id: ok[0].id, rect, rotation };
        emitted.set(n.sheet.id, e);
        return e;
      }
      if (!kind) {
        skips.add(`${what} shapes (drawn as rectangles)`);
        kind = 'rect';
      }
      const fill = SOLID.has(masterKey) ? { fill: '#17162B', fillOpacity: 1 } : fillOf(n);
      const line = lineOf(n);
      const d = {
        ...shapeDraft(id, kind, rect, '', { fill: fill.fill, stroke: line.stroke, strokeWidth: line.strokeWidth, fontSize: ch.size }),
        text: richLabel(text, ch),
        textColor: ch.color,
        strokeStyle: line.strokeStyle,
        align: alignOf(n),
        vAlign: (() => {
          const v = num(cell(n, 'VerticalAlign'), 1);
          return v === 0 ? 'top' : v === 2 ? 'bottom' : 'middle';
        })(),
        fillOpacity: fill.fill === 'transparent' ? 0 : fill.fillOpacity,
        rotation,
      } as ElementDraft;
      return put(d);
    };

    const picture = async (f: NonNullable<Sheet['foreign']>): Promise<string | null> => {
      const rel = f.rel ? pageRels.get(f.rel) : undefined;
      if (rel?.external) {
        skips.add('Linked pictures (left out)');
        return null;
      }
      if (f.type !== 'Bitmap' || !rel) {
        skips.add(f.type === 'Object' ? 'Embedded objects (left out)' : 'Pictures in formats Freero doesn’t show (left out)');
        return null;
      }
      const b = await zip.read(rel.target, VSDX_LIMITS.imageBytes).catch((e: unknown) => {
        if (e instanceof ImportError && /takes too long/.test(e.message)) throw e;
        return null;
      });
      const mime = b ? sniffImage(b) : null;
      if (!b || !mime) {
        skips.add('Pictures in formats Freero doesn’t show (left out)');
        return null;
      }
      return `data:${mime};base64,${base64(b)}`;
    };

    for (const s of top) await visit(s, null, null);

    // Glue: which end of which connector is attached to what (Connects), by connector id.
    const glue = new Map<string, { begin?: { to: string; cell: string }; end?: { to: string; cell: string } }>();
    const connectsEl = [...root.children].find((c) => c.localName === 'Connects');
    for (const c of connectsEl ? kids(connectsEl, 'Connect') : []) {
      const from = c.getAttribute('FromSheet');
      const to = c.getAttribute('ToSheet');
      if (!from || !to) continue;
      const fromCell = c.getAttribute('FromCell') ?? (c.getAttribute('FromPart') === '9' ? 'BeginX' : c.getAttribute('FromPart') === '12' ? 'EndX' : '');
      const g = glue.get(from) ?? {};
      const toCell = c.getAttribute('ToCell') ?? (Number(c.getAttribute('ToPart')) >= 100 ? `Connections.X${Number(c.getAttribute('ToPart')) - 99}` : 'PinX');
      if (/^Begin/.test(fromCell)) g.begin = { to, cell: toCell };
      else if (/^End/.test(fromCell)) g.end = { to, cell: toCell };
      glue.set(from, g);
    }

    let oddEnds = 0;
    for (const { n } of connectors) {
      budget.tick();
      const g = glue.get(n.sheet.id) ?? {};
      const endOf = (which: 'Begin' | 'End'): ConnectorEndpoint => {
        const at = toBoard(n.parentXf({ x: num(cell(n, `${which}X`), 0), y: num(cell(n, `${which}Y`), 0) }));
        const link = which === 'Begin' ? g.begin : g.end;
        const target = link ? emitted.get(link.to) : undefined;
        if (!link || !target) return freeEnd(at);
        // A connection point: where on the shape (fractions of its box, before rotation).
        const m = /^Connections\.(?:Row_)?X?(\d+)/.exec(link.cell);
        const tn = nodes.get(link.to);
        if (m && tn) {
          const local = connectionPoint(tn, String(Number(m[1]) - 1));
          if (local) {
            const p = toBoard(tn.xf(local));
            const r = target.rect;
            const cx = r.x + r.w / 2;
            const cy = r.y + r.h / 2;
            const t = (-target.rotation * Math.PI) / 180;
            const lx = cx + (p.x - cx) * Math.cos(t) - (p.y - cy) * Math.sin(t);
            const ly = cy + (p.x - cx) * Math.sin(t) + (p.y - cy) * Math.cos(t);
            return attachedEnd(target.id, r, { u: (lx - r.x) / (r.w || 1), v: (ly - r.y) / (r.h || 1) });
          }
        }
        return attachedEnd(target.id, target.rect, null);
      };
      const a = endOf('Begin');
      const b = endOf('End');
      const geo = geometry(n);
      const pts = geo.flatMap((x) => x.paths).flat();
      const curved = geo.some((x) => x.curved) || num(cell(n, 'LineRouteExt'), 0) === 2;
      // Right-angled bends (a dynamic connector) route as an elbow line; anything else as drawn.
      const rightAngled = pts.length > 2 && pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 1e-6 || Math.abs(p.y - pts[i - 1].y) < 1e-6);
      const dynamic = /dynamicconnector/.test(NORM(n.masterName || n.sheet.name));
      const routing = curved ? 'curved' : dynamic || rightAngled ? 'elbow' : 'straight';
      const cap = (which: 'BeginArrow' | 'EndArrow'): CapStyle => {
        const i = num(cell(n, which), 0);
        if (ARROWS[i] === undefined) oddEnds++;
        return ARROWS[i] ?? 'arrow';
      };
      const line = lineOf(n);
      const id = newId();
      pageDrafts.push({
        ...connectorDraft(id, { point: { x: 0, y: 0 } }, { point: { x: 0, y: 0 } }, { routing }),
        ...lineBox(a, b),
        start: a,
        end: b,
        stroke: line.stroke === 'transparent' ? '#2B2A44' : line.stroke,
        strokeWidth: line.strokeWidth,
        strokeStyle: line.strokeStyle,
        startCap: cap('BeginArrow'),
        endCap: cap('EndArrow'),
        label: richLabel(textOf(n)),
        waypoints: [],
      } as ElementDraft);
    }
    if (oddEnds) skips.add('Line ends drawn as the nearest Freero end', oddEnds);

    // Members of containers: what is drawn inside one (the smallest that holds it).
    const holder = (r: Rect, self?: string) => {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      let best: { id: string; rect: Rect } | null = null;
      for (const c of containers) {
        if (c.id === self || cx < c.rect.x || cx > c.rect.x + c.rect.w || cy < c.rect.y || cy > c.rect.y + c.rect.h) continue;
        if (self && c.rect.w * c.rect.h <= r.w * r.h) continue;
        if (!best || c.rect.w * c.rect.h < best.rect.w * best.rect.h) best = c;
      }
      return best?.id ?? null;
    };
    if (containers.length) {
      for (const d of pageDrafts) {
        if (d.type === 'connector') continue;
        const f = holder(d, d.type === 'frame' ? d.id : undefined);
        if (f) d.frameId = f;
      }
      // A line belongs to a container when both shapes it joins do.
      const frameOf = new Map(pageDrafts.map((d) => [d.id, d.frameId ?? null]));
      for (const d of pageDrafts) {
        if (d.type !== 'connector') continue;
        const fa = d.start.elementId ? frameOf.get(d.start.elementId) : null;
        if (fa && fa === (d.end.elementId ? frameOf.get(d.end.elementId) : null)) d.frameId = fa;
      }
    }

    // Every page: a frame of its own holding what is on it, pages side by side.
    if (!pageDrafts.length) continue;
    const b = boundsOf(pageDrafts);
    const pad = 40;
    const dx = pageX - (b.x - pad);
    const dy = -(b.y - pad);
    const pageFrame = frameDraft(newId(), { x: pageX, y: 0, w: b.w + 2 * pad, h: b.h + 2 * pad }, page.name);
    drafts.push(pageFrame);
    for (const d of pageDrafts) {
      const moved = shift(d, dx, dy);
      if (!moved.frameId) moved.frameId = pageFrame.id;
      drafts.push(moved);
    }
    pageX += b.w + 2 * pad + 160;
  }
  if (!drafts.length) throw new ImportError('Nothing in this Visio file could be put on the board.');
  if (drafts.length > MAX_ITEMS) throw new ImportError(`This drawing has ${drafts.length} items; Freero imports up to ${MAX_ITEMS} at a time.`);
  // Frames first: they are drawn beneath everything anyway, and children name them.
  drafts.sort((a, b) => Number(b.type === 'frame') - Number(a.type === 'frame'));
  return { drafts, images, report: { source: 'Visio', imported: drafts.length, skipped: skips.list() } };
}

function shift(d: ElementDraft, dx: number, dy: number): ElementDraft {
  const out = { ...d, x: d.x + dx, y: d.y + dy } as ElementDraft;
  if (out.type === 'connector') {
    out.start = { ...out.start, x: out.start.x + dx, y: out.start.y + dy };
    out.end = { ...out.end, x: out.end.x + dx, y: out.end.y + dy };
  }
  return out;
}

// ------------------------------------------------------------------------------------ curves

/** Points along the circular arc from `a` through `m` to `b` (a straight line when they are in a row). */
function arcThrough(a: Pt, m: Pt, b: Pt, steps = 12): Pt[] {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-12) return [b];
  const sq = (p: Pt) => p.x * p.x + p.y * p.y;
  const c = { x: (sq(a) * (m.y - b.y) + sq(m) * (b.y - a.y) + sq(b) * (a.y - m.y)) / d, y: (sq(a) * (b.x - m.x) + sq(m) * (a.x - b.x) + sq(b) * (m.x - a.x)) / d };
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const ang = (p: Pt) => Math.atan2(p.y - c.y, p.x - c.x);
  const a0 = ang(a);
  let a1 = ang(b);
  const am = ang(m);
  // Sweep the way that passes through m.
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(am - a0) < norm(a1 - a0);
  if (ccw) a1 = a0 + norm(a1 - a0);
  else a1 = a0 - norm(a0 - a1);
  const out: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return out;
}

/** An elliptical arc from `a` through `ctrl` to `b`; its major axis at `angle`, `ratio` = major / minor. */
function ellipticalArc(a: Pt, ctrl: Pt, b: Pt, angle: number, ratio: number): Pt[] {
  // Into a space where the ellipse is a circle, through the arc there, and back.
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const to = (p: Pt) => ({ x: p.x * cos - p.y * sin, y: (p.x * sin + p.y * cos) * ratio });
  const back = (p: Pt) => {
    const y = p.y / ratio;
    return { x: p.x * Math.cos(angle) - y * Math.sin(angle), y: p.x * Math.sin(angle) + y * Math.cos(angle) };
  };
  return arcThrough(to(a), to(ctrl), to(b)).map(back);
}
