// Connector model: resolves a connector against live elements and keeps its stored cache
// (endpoint x/y + bounding box) in sync. Rendering always derives from the live attached
// elements; the stored values are only a cache for hit-testing, culling and deleted targets.
import type { BoardElement, CapStyle, ConnectorElement, ConnectorEndpoint, ConnectorRouting, StrokeStyle } from '@freero/shared';
import type { Editor, ElementPatch, NewElement, Point } from '@engine';
import { DEFAULT_LABEL_T, labelBoxes } from './labels';
import {
  boundsOfPoints,
  computeRoute,
  pointAlong,
  resolveEnds,
  round2,
  routeBounds,
  type End,
  type LocalAnchorFn,
  type Lookup,
  type Route,
  type Side,
} from './geometry';

export const TOOL_ID = 'connector';

export interface ConnectorStyle {
  routing: ConnectorRouting;
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  startCap: CapStyle;
  endCap: CapStyle;
}

export const DEFAULT_STYLE: ConnectorStyle = {
  routing: 'elbow',
  stroke: '#2B2A44',
  strokeWidth: 2,
  strokeStyle: 'solid',
  startCap: 'none',
  endCap: 'arrow',
};

export const styleFromOptions = (opts: Partial<ConnectorStyle>): ConnectorStyle => ({ ...DEFAULT_STYLE, ...opts });

/** Anchor positions come from each element type's definition (custom outlines), else bbox midpoints. */
export const localAnchors =
  (editor: Pick<Editor, 'getDefinition'>): LocalAnchorFn =>
  (el, side) =>
    editor.getDefinition(el.type)?.anchorPoint?.(el, side);

export interface ConnectorGeometry {
  start: End;
  end: End;
  route: Route;
  /** Center of the main label (at labelT along the route, by length). */
  mid: Point;
  bounds: { x: number; y: number; w: number; h: number };
}

type Shape = Pick<ConnectorElement, 'start' | 'end' | 'routing' | 'waypoints' | 'strokeWidth' | 'label' | 'labelT' | 'labels'>;

export function connectorGeometry(c: Shape, lookup: Lookup, local?: LocalAnchorFn): ConnectorGeometry {
  const { start, end } = resolveEnds(c, lookup, local);
  const wps = c.routing === 'straight' ? [] : (c.waypoints ?? []);
  const route = computeRoute(c.routing, start, end, wps);
  const mid = pointAlong(route.poly, c.labelT ?? DEFAULT_LABEL_T).p;
  const boxes = labelBoxes(c, route.poly).map((l) => l.box);
  const labels = boxes.length ? boundsOfPoints(boxes.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }])) : null;
  const bounds = routeBounds(route, c.strokeWidth, labels);
  return { start, end, route, mid, bounds };
}

/**
 * Last route each connector object was drawn with. hitTest only receives the element, and an
 * elbow route depends on the attached elements' boxes, so the renderer leaves it here.
 * Keyed by the (immutable) element object, so any write invalidates it.
 */
export const drawnRoutes = new WeakMap<ConnectorElement, Point[]>();

const sameEnd = (a: ConnectorEndpoint, b: ConnectorEndpoint) =>
  (a.elementId ?? null) === (b.elementId ?? null) && (a.anchor ?? 'auto') === (b.anchor ?? 'auto') && a.x === b.x && a.y === b.y;

const cacheEnd = (ep: ConnectorEndpoint, resolved: End): ConnectorEndpoint =>
  ep.elementId ? { ...ep, x: round2(resolved.p.x), y: round2(resolved.p.y) } : ep;

/** An endpoint left behind where its element was (the element was deleted). */
const detach = (ep: ConnectorEndpoint): ConnectorEndpoint => ({ x: ep.x, y: ep.y });

/**
 * The cache patch that makes `c` consistent with the board as `lookup` sees it, or null when it
 * already is. Endpoints whose element is in `removed` become free points at their last position.
 * When both attached ends moved by the same offset (both shapes dragged together), the user's
 * waypoints travel with them.
 */
export function refreshCache(
  c: ConnectorElement,
  lookup: Lookup,
  local?: LocalAnchorFn,
  removed: ReadonlySet<string> = new Set(),
): ElementPatch<ConnectorElement> | null {
  const start = c.start.elementId && removed.has(c.start.elementId) ? detach(c.start) : c.start;
  const end = c.end.elementId && removed.has(c.end.elementId) ? detach(c.end) : c.end;
  const geo = connectorGeometry({ ...c, start, end }, lookup, local);
  const nextStart = cacheEnd(start, geo.start);
  const nextEnd = cacheEnd(end, geo.end);
  let waypoints = c.waypoints;
  if (waypoints?.length && start.elementId && end.elementId) {
    const d1 = { x: nextStart.x - start.x, y: nextStart.y - start.y };
    const d2 = { x: nextEnd.x - end.x, y: nextEnd.y - end.y };
    if ((d1.x || d1.y) && Math.abs(d1.x - d2.x) < 0.01 && Math.abs(d1.y - d2.y) < 0.01)
      waypoints = waypoints.map((p) => ({ x: round2(p.x + d1.x), y: round2(p.y + d1.y) }));
  }
  const patch: ElementPatch<ConnectorElement> = {};
  if (!sameEnd(nextStart, c.start)) patch.start = nextStart;
  if (!sameEnd(nextEnd, c.end)) patch.end = nextEnd;
  if (waypoints !== c.waypoints) patch.waypoints = waypoints;
  const b = geo.bounds;
  if (b.x !== c.x || b.y !== c.y || b.w !== c.w || b.h !== c.h) Object.assign(patch, b);
  return Object.keys(patch).length ? patch : null;
}

/** Endpoint value for a drop: attached to an element (side or 'auto'), or a free point. */
export function endpoint(target: { id: string; anchor: Side | 'auto' } | null, at: Point): ConnectorEndpoint {
  return target ? { elementId: target.id, anchor: target.anchor, x: round2(at.x), y: round2(at.y) } : { x: round2(at.x), y: round2(at.y) };
}

/** A complete new connector element with its cache already computed. */
export function buildConnector(
  editor: Pick<Editor, 'getElement' | 'getDefinition'>,
  start: ConnectorEndpoint,
  end: ConnectorEndpoint,
  style: ConnectorStyle,
): NewElement<'connector'> {
  const base = { type: 'connector' as const, start, end, label: '', waypoints: [] as Point[], ...style };
  const lookup = (id: string) => editor.getElement(id);
  const patch = refreshCache({ ...base, x: 0, y: 0, w: 0, h: 0 } as unknown as ConnectorElement, lookup, localAnchors(editor));
  return { ...base, x: 0, y: 0, w: 1, h: 1, ...(patch as object) } as NewElement<'connector'>;
}

/** Writes semantic fields of a connector and refreshes its cache in the same write. */
export function patchConnector(editor: Editor, id: string, patch: ElementPatch<ConnectorElement>): void {
  const cur = editor.getElement<ConnectorElement>(id);
  if (!cur || cur.type !== 'connector') return;
  const next = { ...cur, ...patch } as ConnectorElement;
  const cache = refreshCache(next, (i) => editor.getElement(i), localAnchors(editor));
  editor.update<ConnectorElement>(id, { ...patch, ...(cache ?? {}) });
}

/** Elements a connector can attach to. */
export function isConnectable(editor: Pick<Editor, 'getDefinition'>, el: BoardElement): boolean {
  const def = editor.getDefinition(el.type);
  return !!def && def.connectable !== false && !def.container && el.type !== 'connector' && el.type !== 'pen';
}
