// Excalidraw scenes (`.excalidraw` JSON) → Freero element drafts. Implemented from the documented
// scene format (`{ type: "excalidraw", elements, files }`); nothing of Excalidraw's code is used.
// Untrusted input: size-capped by the caller, every field type-checked, text becomes plain text.
import { connectorDraft, frameDraft, shapeDraft, textDraft, type CapStyle, type ConnectorEndpoint, type ElementDraft, type FontFamily, type Rect, type ShapeKind } from '@freero/shared';
import { attachedEnd, color, coord, freeEnd, ImportError, imageDraft, imageSource, lineBox, MAX_ITEMS, penDraft, richLabel, size, Skips, type ImportResult } from './common';

/** Looks like an Excalidraw scene (by its content, whatever its name). */
export function looksLikeExcalidraw(text: string): boolean {
  return /^\s*\{[\s\S]{0,400}"type"\s*:\s*"excalidraw(\/clipboard)?"/.test(text.slice(0, 2000));
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const deg = (rad: unknown) => Math.round(((n(rad) * 180) / Math.PI) * 100) / 100;

const FONTS: Record<number, FontFamily> = { 1: 'hand', 2: 'sans', 3: 'mono', 5: 'hand', 6: 'sans', 7: 'sans', 8: 'mono' };
const ARROWHEADS: Record<string, CapStyle> = { arrow: 'arrow', triangle: 'triangle', triangle_outline: 'triangleOpen', bar: 'bar', dot: 'circle', circle: 'circle', circle_outline: 'circleOpen', diamond: 'diamond', diamond_outline: 'diamondOpen', crowfoot_one: 'one', crowfoot_many: 'many', crowfoot_one_or_many: 'oneOrMany' };
const SHAPES: Record<string, ShapeKind> = { rectangle: 'rect', ellipse: 'ellipse', diamond: 'diamond' };

/** Points of a linear element in world coordinates. */
function worldPoints(el: Raw): Array<{ x: number; y: number }> {
  const pts = Array.isArray(el.points) ? el.points : [];
  return pts
    .filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')
    .slice(0, 20_000)
    .map((p) => ({ x: coord(n(el.x) + p[0]), y: coord(n(el.y) + p[1]) }));
}

/**
 * Turns an Excalidraw scene into Freero drafts: rectangles / ellipses / diamonds → shapes (text bound
 * inside them becomes their label), free text → text boxes, arrows → connectors attached to the
 * shapes they are bound to (arrowheads, dashes and a bound label kept), straight lines → lines,
 * freehand and multi-point lines → pen strokes, images → images (from the scene's files), frames →
 * frames with their children, groups → one Freero group. Deleted elements are ignored; the rest
 * (embeds, …) is counted in the report.
 */
export function parseExcalidraw(text: string, newId: () => string): ImportResult {
  let scene: unknown;
  try {
    scene = JSON.parse(text);
  } catch {
    throw new ImportError('This isn’t a readable Excalidraw file (the JSON is malformed).');
  }
  if (!isObj(scene) || (scene.type !== 'excalidraw' && scene.type !== 'excalidraw/clipboard') || !Array.isArray(scene.elements)) throw new ImportError('This isn’t an Excalidraw file.');
  const all = scene.elements.filter((e): e is Raw => isObj(e) && typeof e.id === 'string' && typeof e.type === 'string' && e.isDeleted !== true);
  if (all.length > MAX_ITEMS) throw new ImportError(`This drawing has ${all.length} items; Freero imports up to ${MAX_ITEMS} at a time.`);
  const files = isObj(scene.files) ? scene.files : {};
  const skips = new Skips();
  const drafts: ElementDraft[] = [];
  const images: ImportResult['images'] = [];
  const idOf = new Map<string, string>();
  const rectOf = new Map<string, Rect>();
  const groups = new Map<string, string>();
  for (const el of all) idOf.set(el.id as string, newId());

  // Text bound to a container (a shape's label, an arrow's label) is that container's text.
  const boundText = new Map<string, Raw>();
  for (const el of all) if (el.type === 'text' && typeof el.containerId === 'string' && idOf.has(el.containerId)) boundText.set(el.containerId, el);
  const textOf = (el: Raw) => {
    const t = boundText.get(el.id as string);
    return t ? str(t.originalText, str(t.text)) : '';
  };
  // What an arrow may stay attached to: items that become a Freero item of their own.
  const attachable = new Set(
    all
      .filter(
        (e) =>
          ['rectangle', 'ellipse', 'diamond', 'frame', 'magicframe'].includes(e.type as string) ||
          (e.type === 'image' && typeof e.fileId === 'string' && isObj(files[e.fileId]) && !!imageSource(str((files[e.fileId] as Raw).dataURL))) ||
          (e.type === 'text' && !(typeof e.containerId === 'string' && idOf.has(e.containerId)) && !!str(e.originalText, str(e.text)).trim()),
      )
      .map((e) => e.id as string),
  );
  const fontOf = (t: Raw | undefined) => ({ family: FONTS[n(t?.fontFamily, 1)] ?? 'hand', size: Math.max(8, Math.min(200, n(t?.fontSize, 20))) });

  const placeOf = (el: Raw) => {
    const out: { frameId?: string; groupId?: string } = {};
    if (typeof el.frameId === 'string' && idOf.has(el.frameId)) out.frameId = idOf.get(el.frameId)!;
    const gs = Array.isArray(el.groupIds) ? el.groupIds.filter((g): g is string => typeof g === 'string') : [];
    // Excalidraw lists groups innermost first; Freero has one level: the outermost moves it all.
    const outer = gs[gs.length - 1];
    if (outer) {
      if (!groups.has(outer)) groups.set(outer, newId());
      out.groupId = groups.get(outer)!;
    }
    return out;
  };

  // Frames, then everything else in the scene's own order (its stacking order).
  const ordered = [...all.filter((e) => e.type === 'frame' || e.type === 'magicframe'), ...all.filter((e) => e.type !== 'frame' && e.type !== 'magicframe')];
  for (const el of ordered) {
    const id = idOf.get(el.id as string)!;
    const r: Rect = { x: coord(el.x), y: coord(el.y), w: size(el.width), h: size(el.height) };
    rectOf.set(el.id as string, r);
    const stroke = color(str(el.strokeColor), '#1E1E1E');
    const dashed = el.strokeStyle === 'dashed' ? 'dashed' : el.strokeStyle === 'dotted' ? 'dotted' : 'solid';
    const place = placeOf(el);
    let d: ElementDraft | null = null;
    switch (el.type) {
      case 'frame':
      case 'magicframe':
        d = frameDraft(id, r, str(el.name, 'Frame').slice(0, 200) || 'Frame');
        break;
      case 'rectangle':
      case 'ellipse':
      case 'diamond': {
        const kind: ShapeKind = el.type === 'rectangle' && isObj(el.roundness) ? 'roundRect' : SHAPES[el.type as string];
        const label = boundText.get(el.id as string);
        const font = fontOf(label);
        const fill = color(str(el.backgroundColor), 'transparent');
        d = {
          ...shapeDraft(id, kind, r, '', { fill, stroke, strokeWidth: Math.max(1, n(el.strokeWidth, 2)), fontSize: Math.round(font.size) }),
          text: richLabel(textOf(el)),
          fontFamily: font.family,
          strokeStyle: dashed,
          fillOpacity: fill === 'transparent' ? 0 : Math.max(0, Math.min(1, n(el.opacity, 100) / 100)),
          textColor: color(str(label?.strokeColor), '#1E1E1E'),
          align: label?.textAlign === 'left' ? 'left' : label?.textAlign === 'right' ? 'right' : 'center',
          rotation: deg(el.angle),
        } as ElementDraft;
        break;
      }
      case 'text': {
        if (typeof el.containerId === 'string' && idOf.has(el.containerId)) continue; // a label, placed with its container
        const t = str(el.originalText, str(el.text));
        if (!t.trim()) continue;
        const font = fontOf(el);
        d = {
          ...textDraft(id, r.x, r.y, Math.max(r.w, 20), t.slice(0, 5000), { size: Math.round(font.size), color: stroke }),
          fontFamily: font.family,
          align: el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'right' : 'left',
          autoWidth: true,
          rotation: deg(el.angle),
        } as ElementDraft;
        break;
      }
      case 'arrow':
      case 'line': {
        const pts = worldPoints(el);
        if (pts.length < 2) break;
        const isArrow = el.type === 'arrow';
        // A line through several points (a polyline, a closed polygon) is ink, not a connector.
        if (!isArrow && pts.length > 2) {
          d = penDraft(id, pts.map((p) => ({ ...p, p: 0.5 })), stroke, n(el.strokeWidth, 2));
          break;
        }
        const end = (binding: unknown, p: { x: number; y: number }): ConnectorEndpoint => {
          const target = isObj(binding) && typeof binding.elementId === 'string' ? binding.elementId : null;
          const tid = target && attachable.has(target) ? idOf.get(target) : undefined;
          const tr = target ? rectOf.get(target) ?? rectFromRaw(all, target) : undefined;
          if (!tid || !tr) return freeEnd(p);
          return attachedEnd(tid, tr, { u: (p.x - tr.x) / tr.w, v: (p.y - tr.y) / tr.h });
        };
        const a = end(el.startBinding, pts[0]);
        const b = end(el.endBinding, pts[pts.length - 1]);
        if (isArrow && pts.length > 2 && el.elbowed !== true) skips.add('Bends of curved or multi-point arrows (drawn as curves)');
        d = {
          ...connectorDraft(id, { point: { x: 0, y: 0 } }, { point: { x: 0, y: 0 } }),
          ...lineBox(a, b),
          start: a,
          end: b,
          routing: el.elbowed === true ? 'elbow' : pts.length > 2 ? 'curved' : 'straight',
          stroke,
          strokeWidth: Math.max(1, Math.min(24, n(el.strokeWidth, 2))),
          strokeStyle: dashed,
          startCap: isArrow ? (ARROWHEADS[str(el.startArrowhead)] ?? 'none') : 'none',
          endCap: isArrow ? (el.endArrowhead === null ? 'none' : (ARROWHEADS[str(el.endArrowhead, 'arrow')] ?? 'arrow')) : 'none',
          label: richLabel(textOf(el)),
          waypoints: [],
        } as ElementDraft;
        break;
      }
      case 'freedraw': {
        const pts = worldPoints(el);
        const pressures = Array.isArray(el.pressures) ? el.pressures : [];
        d = penDraft(
          id,
          pts.map((p, i) => ({ ...p, p: el.simulatePressure === false && typeof pressures[i] === 'number' ? (pressures[i] as number) : 0.5 })),
          stroke,
          n(el.strokeWidth, 2) * 2,
        );
        if (!d) skips.add('Freehand strokes with fewer than two points (left out)');
        break;
      }
      case 'image': {
        const file = typeof el.fileId === 'string' && isObj(files[el.fileId]) ? (files[el.fileId] as Raw) : null;
        const src = imageSource(str(file?.dataURL));
        if (!src) {
          skips.add('Images whose picture isn’t in the file (left out)');
          break;
        }
        d = imageDraft(id, r, deg(el.angle), '');
        images.push({ id, source: src });
        break;
      }
      case 'embeddable':
      case 'iframe':
        skips.add('Embedded web pages (left out)');
        break;
      case 'selection':
        break;
      default:
        skips.add(`“${String(el.type).slice(0, 40)}” items (left out)`);
    }
    if (!d) continue;
    if (place.frameId && d.type !== 'frame') d.frameId = place.frameId;
    if (place.groupId) d.groupId = place.groupId;
    drafts.push(d);
  }
  return { drafts, images, report: { source: 'Excalidraw', imported: drafts.length, skipped: skips.list() } };
}

/** The box of an element the binding names, even when it comes later in the scene. */
function rectFromRaw(all: Raw[], id: string): Rect | undefined {
  const el = all.find((e) => e.id === id);
  return el ? { x: coord(el.x), y: coord(el.y), w: size(el.width), h: size(el.height) } : undefined;
}
