// draw.io / diagrams.net files (`.drawio`, `.xml`, an mxGraph model) → Freero element drafts.
// Implemented from the documented file format (mxfile > diagram > mxGraphModel > root > mxCell, with
// compressed pages as base64 of raw-deflated, URI-encoded XML); nothing of draw.io's code is used.
//
// Untrusted input: the file is size-capped, compressed pages are unpacked with a byte limit (zip
// bombs), any DOCTYPE / ENTITY is refused before parsing (no external entities, no entity
// expansion), and labels become plain text (HTML labels are reduced to their text).
import {
  connectorDraft,
  frameDraft,
  shapeDraft,
  textDraft,
  type CapStyle,
  type ConnectorEndpoint,
  type ElementDraft,
  type Rect,
  type ShapeKind,
} from '@freero/shared';
import {
  attachedEnd,
  color,
  coord,
  freeEnd,
  htmlToPlain,
  ImportError,
  imageDraft,
  imageSource,
  lineBox,
  MAX_ITEMS,
  MAX_UNPACKED_BYTES,
  richLabel,
  size,
  Skips,
  type ImportResult,
} from './common';

/** Looks like a draw.io file (by its content, whatever its name). */
export function looksLikeDrawio(text: string): boolean {
  const head = text.slice(0, 2000).trimStart();
  return /^(<\?xml[^>]*>\s*)?<(mxfile|mxGraphModel)[\s>]/.test(head);
}

type Style = Map<string, string>;

/** "ellipse;whiteSpace=wrap;fillColor=#fff" → { ellipse: '', whiteSpace: 'wrap', … } (first bare word = the shape). */
export function parseStyle(s: string | null): Style {
  const out: Style = new Map();
  for (const part of (s ?? '').split(';')) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf('=');
    if (i < 0) out.set(t, '');
    else out.set(t.slice(0, i), t.slice(i + 1));
  }
  return out;
}

const SHAPES: Record<string, ShapeKind> = {
  ellipse: 'ellipse',
  doubleEllipse: 'ellipse',
  rhombus: 'diamond',
  triangle: 'triangle',
  hexagon: 'hexagon',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  cylinder: 'cylinder',
  cylinder3: 'cylinder',
  datastore: 'storedData',
  document: 'document',
  process: 'predefinedProcess',
  cloud: 'cloud',
  step: 'chevron',
  singleArrow: 'arrowRight',
  callout: 'callout',
  cross: 'cross',
  star: 'star',
  note: 'umlNote',
  umlActor: 'umlActor',
  delay: 'delay',
  display: 'display',
  offPageConnector: 'offPageRef',
  internalStorage: 'internalStorage',
  manualInput: 'manualInput',
  loopLimit: 'loopLimit',
  sumEllipse: 'summingJunction',
  orEllipse: 'orJunction',
  tape: 'punchedTape',
  card: 'punchedCard',
  collate: 'collate',
  sortShape: 'sort',
  'mxgraph.flowchart.terminator': 'terminator',
  'mxgraph.flowchart.decision': 'diamond',
  'mxgraph.flowchart.process': 'rect',
  'mxgraph.flowchart.document': 'document',
  'mxgraph.flowchart.multi-document': 'multiDocument',
  'mxgraph.flowchart.predefined_process': 'predefinedProcess',
  'mxgraph.flowchart.manual_input': 'manualInput',
  'mxgraph.flowchart.manual_operation': 'manualOperation',
  'mxgraph.flowchart.delay': 'delay',
  'mxgraph.flowchart.display': 'display',
  'mxgraph.flowchart.database': 'cylinder',
  'mxgraph.flowchart.stored_data': 'storedData',
  'mxgraph.flowchart.start_1': 'ellipse',
  'mxgraph.flowchart.start_2': 'ellipse',
  'mxgraph.flowchart.on-page_reference': 'ellipse',
  'mxgraph.flowchart.off-page_reference': 'offPageRef',
  'mxgraph.flowchart.data': 'parallelogram',
  'mxgraph.flowchart.preparation': 'hexagon',
  'mxgraph.flowchart.merge_or_storage': 'merge',
  'mxgraph.flowchart.or': 'orJunction',
  'mxgraph.flowchart.summing_function': 'summingJunction',
  'mxgraph.flowchart.loop_limit': 'loopLimit',
  'mxgraph.flowchart.collate': 'collate',
  'mxgraph.flowchart.sort': 'sort',
  'mxgraph.flowchart.punched_tape': 'punchedTape',
  'mxgraph.flowchart.card': 'punchedCard',
  'mxgraph.flowchart.internal_storage': 'internalStorage',
  'mxgraph.basic.star': 'star',
  'mxgraph.basic.cloud_callout': 'cloud',
};

/** What a style draws: its `shape=…`, else its first bare word ("ellipse;…"), else null (a rectangle). */
function shapeName(style: Style): string | null {
  if (style.has('shape')) return style.get('shape')!;
  for (const [k, v] of style) if (v === '') return k;
  return null;
}

/** The Freero shape kind for a vertex style, or null for one we don't know. */
function shapeKind(style: Style): ShapeKind | null {
  const name = shapeName(style);
  if (name === null || name === 'rect' || name === 'rectangle' || name === 'label') return style.get('rounded') === '1' ? 'roundRect' : 'rect';
  return SHAPES[name] ?? null;
}

const CAPS: Record<string, CapStyle> = {
  none: 'none',
  classic: 'arrow',
  classicThin: 'arrow',
  open: 'arrow',
  openThin: 'arrow',
  openAsync: 'arrow',
  async: 'arrow',
  block: 'triangle',
  blockThin: 'triangle',
  diamond: 'diamond',
  diamondThin: 'diamond',
  oval: 'circle',
  circle: 'circle',
  dash: 'bar',
  ERone: 'one',
  ERmandOne: 'one',
  ERmany: 'many',
  ERzeroToOne: 'zeroOrOne',
  ERoneToMany: 'oneOrMany',
  ERzeroToMany: 'zeroOrMany',
};

function cap(style: Style, key: 'startArrow' | 'endArrow', dflt: CapStyle): CapStyle {
  const v = style.get(key);
  if (v === undefined) return dflt;
  const c = CAPS[v] ?? (v ? 'arrow' : 'none');
  // Hollow (fill=0) blocks / diamonds / ovals are UML's open variants.
  if (style.get(`${key === 'startArrow' ? 'start' : 'end'}Fill`) === '0') {
    if (c === 'triangle') return 'triangleOpen';
    if (c === 'diamond') return 'diamondOpen';
    if (c === 'circle') return 'circleOpen';
  }
  return c;
}

const num = (v: string | null | undefined, d: number) => {
  const n = v === null || v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Unpacks a compressed page: base64 → raw inflate (capped) → URI-decoded XML. */
export async function inflatePage(b64: string, maxBytes = MAX_UNPACKED_BYTES): Promise<string> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  } catch {
    throw new ImportError('A page of this draw.io file is damaged (not valid base64).');
  }
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  const stream = input.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ImportError('A page of this draw.io file unpacks to more than Freero imports.');
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('A page of this draw.io file is damaged (it could not be unpacked).');
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.byteLength;
  }
  const text = new TextDecoder().decode(all);
  try {
    return decodeURIComponent(text);
  } catch {
    return text; // very old files store the XML without URI encoding
  }
}

function parseXml(text: string): Document {
  // No DTDs at all: nothing to resolve (external entities) and nothing to expand (billion laughs).
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ImportError('This draw.io file declares a DOCTYPE, which Freero doesn’t accept.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ImportError('This isn’t a readable draw.io file (the XML is malformed).');
  return doc;
}

interface Cell {
  id: string;
  parent: string | null;
  label: string;
  style: Style;
  vertex: boolean;
  edge: boolean;
  source: string | null;
  target: string | null;
  geo: Element | null;
}

/** The cells of one mxGraphModel; `<object>` / `<UserObject>` wrappers carry the id and label. */
function cellsOf(model: Element): Cell[] {
  const root = [...model.children].find((c) => c.tagName === 'root');
  if (!root) return [];
  const out: Cell[] = [];
  for (const node of [...root.children]) {
    const cell = node.tagName === 'mxCell' ? node : [...node.children].find((c) => c.tagName === 'mxCell');
    if (!cell) continue;
    const wrapper = node === cell ? null : node;
    const id = (wrapper ?? cell).getAttribute('id') ?? cell.getAttribute('id');
    if (!id) continue;
    const style = parseStyle(cell.getAttribute('style'));
    const raw = wrapper ? (wrapper.getAttribute('label') ?? '') : (cell.getAttribute('value') ?? '');
    out.push({
      id,
      parent: cell.getAttribute('parent'),
      label: style.get('html') === '1' || /<[a-z][^>]*>/i.test(raw) ? htmlToPlain(raw) : raw.trim(),
      style,
      vertex: cell.getAttribute('vertex') === '1',
      edge: cell.getAttribute('edge') === '1',
      source: cell.getAttribute('source'),
      target: cell.getAttribute('target'),
      geo: [...cell.children].find((c) => c.tagName === 'mxGeometry') ?? null,
    });
  }
  return out;
}

const point = (el: Element | undefined | null) => (el ? { x: coord(Number(el.getAttribute('x') ?? 0)), y: coord(Number(el.getAttribute('y') ?? 0)) } : null);
const asPoint = (geo: Element | null, as: string) => point(geo ? [...geo.children].find((c) => c.tagName === 'mxPoint' && c.getAttribute('as') === as) : null);

interface Page {
  name: string;
  model: Element;
}

async function pagesOf(text: string): Promise<Page[]> {
  const doc = parseXml(text);
  const top = doc.documentElement;
  if (top.tagName === 'mxGraphModel') return [{ name: 'Page-1', model: top }];
  if (top.tagName !== 'mxfile') throw new ImportError('This isn’t a draw.io file.');
  const pages: Page[] = [];
  for (const d of [...top.getElementsByTagName('diagram')]) {
    const name = d.getAttribute('name') || `Page-${pages.length + 1}`;
    const inline = [...d.children].find((c) => c.tagName === 'mxGraphModel');
    if (inline) pages.push({ name, model: inline });
    else if (d.textContent?.trim()) {
      const inner = parseXml(await inflatePage(d.textContent.trim())).documentElement;
      if (inner.tagName === 'mxGraphModel') pages.push({ name, model: inner });
    }
  }
  return pages;
}

/**
 * Turns a draw.io file into Freero drafts: vertices → shapes / text / images, swimlanes and
 * containers → frames (their children inside), groups → one Freero group, edges → connectors
 * attached to the shapes they connect (labels kept, edge-label cells folded into their line),
 * several pages → one frame per page side by side. What has no Freero counterpart is counted in
 * the report; unknown shapes become rectangles with their label.
 */
export async function parseDrawio(text: string, newId: () => string): Promise<ImportResult> {
  const pages = await pagesOf(text);
  if (!pages.length) throw new ImportError('This draw.io file has no diagram in it.');
  const skips = new Skips();
  const drafts: ElementDraft[] = [];
  const images: ImportResult['images'] = [];
  let pageX = 0;

  for (const page of pages) {
    const cells = cellsOf(page.model);
    if (cells.length > MAX_ITEMS * 2) throw new ImportError(`This diagram has ${cells.length} items; Freero imports up to ${MAX_ITEMS} at a time.`);
    const byId = new Map(cells.map((c) => [c.id, c]));
    // Layers are the root's children (parent "0"); everything else is placed relative to its parent vertex.
    const isLayer = (c: Cell | undefined) => !!c && !c.vertex && !c.edge;
    const rects = new Map<string, Rect>();
    const absRect = (c: Cell, depth = 0): Rect => {
      const known = rects.get(c.id);
      if (known) return known;
      const g = c.geo;
      const local = { x: coord(num(g?.getAttribute('x'), 0)), y: coord(num(g?.getAttribute('y'), 0)), w: size(num(g?.getAttribute('width'), 0)), h: size(num(g?.getAttribute('height'), 0)) };
      const parent = c.parent ? byId.get(c.parent) : undefined;
      const r = parent && parent.vertex && depth < 50 ? { ...local, x: local.x + absRect(parent, depth + 1).x, y: local.y + absRect(parent, depth + 1).y } : local;
      rects.set(c.id, r);
      return r;
    };

    const pageDrafts: ElementDraft[] = [];
    const idOf = new Map<string, string>(); // cell id → element id
    const groupOf = new Map<string, string>(); // group cell id → Freero group id
    const frameOf = new Map<string, string>(); // container cell id → frame element id
    const edgeLabels = new Map<string, string[]>();
    const isContainer = (c: Cell) => shapeName(c.style) === 'swimlane' || c.style.get('container') === '1';
    const isGroup = (c: Cell) => shapeName(c.style) === 'group' && !c.label;

    // Where a vertex belongs: the innermost container frame and the outermost group above it.
    const placeOf = (c: Cell) => {
      let frameId: string | null = null;
      let groupId: string | null = null;
      let p = c.parent ? byId.get(c.parent) : undefined;
      for (let depth = 0; p && !isLayer(p) && depth < 50; depth++) {
        if (!frameId && frameOf.has(p.id)) frameId = frameOf.get(p.id)!;
        if (isGroup(p)) groupId = groupOf.get(p.id) ?? null;
        p = p.parent ? byId.get(p.parent) : undefined;
      }
      return { frameId, groupId };
    };

    for (const c of cells) {
      if (!c.vertex) continue;
      // An edge's label lives in a child cell of the edge.
      const parent = c.parent ? byId.get(c.parent) : undefined;
      if (parent?.edge) {
        if (c.label) edgeLabels.set(parent.id, [...(edgeLabels.get(parent.id) ?? []), c.label]);
        continue;
      }
      const r = absRect(c);
      if (isGroup(c)) {
        groupOf.set(c.id, newId());
        continue;
      }
      const id = newId();
      const { frameId, groupId } = placeOf(c);
      const rotation = num(c.style.get('rotation'), 0) % 360;
      let d: ElementDraft;
      if (isContainer(c)) {
        d = frameDraft(id, r, c.label.slice(0, 200) || 'Container', frameId);
        frameOf.set(c.id, id);
      } else if (shapeName(c.style) === 'text') {
        if (!c.label) continue;
        d = { ...textDraft(id, r.x, r.y, Math.max(r.w, 40), c.label.slice(0, 5000), { size: Math.max(8, num(c.style.get('fontSize'), 12)), bold: (num(c.style.get('fontStyle'), 0) & 1) === 1, color: color(c.style.get('fontColor'), '#17162B') }, frameId), align: alignOf(c.style) } as ElementDraft;
      } else if (shapeName(c.style) === 'image') {
        const src = imageSource(c.style.get('image'));
        if (!src) {
          skips.add('Images that aren’t embedded or linked (left out)');
          continue;
        }
        d = imageDraft(id, r, rotation, c.label.slice(0, 200));
        images.push({ id, source: src });
      } else {
        let kind = shapeKind(c.style);
        if (!kind) {
          skips.add(`“${(shapeName(c.style) ?? 'unknown').replace(/^mxgraph\./, '')}” shapes (drawn as rectangles)`);
          kind = 'rect';
        }
        const fs = num(c.style.get('fontStyle'), 0);
        const fill = color(c.style.get('fillColor'), '#FFFFFF');
        d = {
          ...shapeDraft(id, kind, r, '', { fill, stroke: color(c.style.get('strokeColor'), '#2B2A44'), strokeWidth: num(c.style.get('strokeWidth'), 1) + 1, fontSize: Math.max(8, Math.round(num(c.style.get('fontSize'), 12))) }, frameId),
          text: richLabel(c.label, { bold: (fs & 1) === 1, italic: (fs & 2) === 2, underline: (fs & 4) === 4 }),
          textColor: color(c.style.get('fontColor'), '#17162B'),
          strokeStyle: c.style.get('dashed') === '1' ? 'dashed' : 'solid',
          align: alignOf(c.style),
          vAlign: c.style.get('verticalAlign') === 'top' ? 'top' : c.style.get('verticalAlign') === 'bottom' ? 'bottom' : 'middle',
          ...(c.style.get('opacity') ? { fillOpacity: Math.max(0, Math.min(1, num(c.style.get('opacity'), 100) / 100)) } : {}),
        } as ElementDraft;
        if (fill === 'transparent') (d as { fillOpacity: number }).fillOpacity = 0;
      }
      d.rotation = d.type === 'frame' ? 0 : rotation;
      if (groupId) d.groupId = groupId;
      idOf.set(c.id, id);
      pageDrafts.push(d);
    }

    for (const c of cells) {
      if (!c.edge) continue;
      const source = c.source ? byId.get(c.source) : undefined;
      const target = c.target ? byId.get(c.target) : undefined;
      const end = (cell: Cell | undefined, x: string, y: string, as: string): ConnectorEndpoint | null => {
        const id = cell ? idOf.get(cell.id) : undefined;
        if (cell && id) {
          const u = c.style.get(x);
          const v = c.style.get(y);
          return attachedEnd(id, absRect(cell), u !== undefined && v !== undefined ? { u: num(u, 0.5), v: num(v, 0.5) } : null);
        }
        const p = asPoint(c.geo, as);
        const parent = c.parent ? byId.get(c.parent) : undefined;
        const off = parent?.vertex ? absRect(parent) : { x: 0, y: 0 };
        return p ? freeEnd({ x: p.x + off.x, y: p.y + off.y }) : null;
      };
      const a = end(source, 'exitX', 'exitY', 'sourcePoint');
      const b = end(target, 'entryX', 'entryY', 'targetPoint');
      if (!a || !b) {
        skips.add('Lines with a loose end that has no position (left out)');
        continue;
      }
      const label = [c.label, ...(edgeLabels.get(c.id) ?? [])].filter(Boolean).join('\n');
      const box = lineBox(a, b);
      const routing = c.style.get('edgeStyle')?.includes('orthogonal') || c.style.get('edgeStyle') === 'elbowEdgeStyle' ? 'elbow' : c.style.get('curved') === '1' ? 'curved' : 'straight';
      const bends = [...(c.geo?.children ?? [])].some((ch) => ch.tagName === 'Array' && ch.getAttribute('as') === 'points' && ch.children.length > 0);
      if (bends && routing !== 'elbow') skips.add('Hand-placed bends of lines (drawn as straight or curved lines)');
      const id = newId();
      const draft = {
        ...connectorDraft(id, { point: { x: 0, y: 0 } }, { point: { x: 0, y: 0 } }, { routing }),
        ...box,
        start: a,
        end: b,
        stroke: color(c.style.get('strokeColor'), '#2B2A44'),
        strokeWidth: Math.max(1, Math.min(24, num(c.style.get('strokeWidth'), 1) + 1)),
        strokeStyle: c.style.get('dashed') === '1' ? 'dashed' : 'solid',
        startCap: cap(c.style, 'startArrow', 'none'),
        endCap: cap(c.style, 'endArrow', 'arrow'),
        label: richLabel(label),
        waypoints: [],
      } as ElementDraft;
      const { frameId, groupId } = placeOf(c);
      if (frameId) draft.frameId = frameId;
      if (groupId) draft.groupId = groupId;
      pageDrafts.push(draft);
    }

    // One page: as drawn. Several: each in a frame of its own, side by side.
    if (pages.length > 1 && pageDrafts.length) {
      const xs = pageDrafts.map((d) => d.x);
      const ys = pageDrafts.map((d) => d.y);
      const minX = Math.min(...xs) - 40;
      const minY = Math.min(...ys) - 40;
      const maxX = Math.max(...pageDrafts.map((d) => d.x + d.w)) + 40;
      const maxY = Math.max(...pageDrafts.map((d) => d.y + d.h)) + 40;
      const dx = pageX - minX;
      const pageFrame = frameDraft(newId(), { x: pageX, y: 0, w: maxX - minX, h: maxY - minY }, page.name.slice(0, 200));
      drafts.push(pageFrame);
      for (const d of pageDrafts) {
        const moved = shift(d, dx, -minY);
        if (!moved.frameId) moved.frameId = pageFrame.id;
        drafts.push(moved);
      }
      pageX += maxX - minX + 160;
    } else drafts.push(...pageDrafts);
  }
  if (drafts.length > MAX_ITEMS) throw new ImportError(`This diagram has ${drafts.length} items; Freero imports up to ${MAX_ITEMS} at a time.`);
  // Frames first: they are drawn beneath everything anyway, and children name them.
  drafts.sort((a, b) => Number(b.type === 'frame') - Number(a.type === 'frame'));
  return { drafts, images, report: { source: 'draw.io', imported: drafts.length, skipped: skips.list() } };
}

function alignOf(style: Style): 'left' | 'center' | 'right' {
  const a = style.get('align');
  return a === 'left' ? 'left' : a === 'right' ? 'right' : 'center';
}

function shift(d: ElementDraft, dx: number, dy: number): ElementDraft {
  const out = { ...d, x: d.x + dx, y: d.y + dy } as ElementDraft;
  if (out.type === 'connector') {
    out.start = { ...out.start, x: out.start.x + dx, y: out.start.y + dy };
    out.end = { ...out.end, x: out.end.x + dx, y: out.end.y + dy };
  }
  return out;
}
