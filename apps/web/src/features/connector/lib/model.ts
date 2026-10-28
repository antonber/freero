// Connector model: resolves a connector against live elements and keeps its stored cache
// (endpoint x/y + bounding box) in sync. Rendering always derives from the live attached
// elements; the stored values are only a cache for hit-testing, culling and deleted targets.
import type { CapStyle, ConnectorElement, ConnectorEndpoint, ConnectorRouting, StrokeStyle } from '@freero/shared';
import type { Editor, ElementPatch, NewElement, Point, Rect } from '@engine';
import { DEFAULT_LABEL_T, labelBoxes } from './labels';
import { liveObstacles } from './obstacles';
import {
  boundsOfPoints,
  capReach,
  computeRoute,
  pointAlong,
  resolveEnds,
  round2,
  routeBounds,
  type End,
  type Lookup,
  type Outline,
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

/** Each element type's outline (`anchorPoint`, `outlinePoint` of its definition), else its box. */
export const localAnchors = (editor: Pick<Editor, 'getDefinition'>): Outline => ({
  anchor: (el, side) => editor.getDefinition(el.type)?.anchorPoint?.(el, side),
  toward: (el, local) => editor.getDefinition(el.type)?.outlinePoint?.(el, local),
});

/** Boxes an elbow line between two resolved ends goes around (see obstacles.ts). */
export type Obstacles = (start: End, end: End) => Rect[];

export { isConnectable } from './obstacles';

export interface ConnectorGeometry {
  start: End;
  end: End;
  route: Route;
  /** Center of the main label (at labelT along the route, by length). */
  mid: Point;
  bounds: { x: number; y: number; w: number; h: number };
}

type Shape = Pick<ConnectorElement, 'start' | 'end' | 'routing' | 'waypoints' | 'strokeWidth' | 'label' | 'labelT' | 'labels'> &
  Partial<Pick<ConnectorElement, 'startCap' | 'endCap'>>;

/** A line end's mark sits on the first straight run, never across a bend: long ends get a longer stub. */
const stubFor = (cap: ConnectorElement['startCap'] | undefined, sw: number) => (cap ? capReach(cap, sw) + 8 : 0);

/** Whether a line routes around other items: elbow lines the user hasn't bent themselves. */
export const avoidsObstacles = (c: Pick<ConnectorElement, 'routing' | 'waypoints'>) => c.routing === 'elbow' && !c.waypoints?.length;

export function connectorGeometry(c: Shape, lookup: Lookup, local?: Outline, obstacles?: Obstacles | Rect[]): ConnectorGeometry {
  const { start, end } = resolveEnds(c, lookup, local);
  const wps = c.routing === 'straight' ? [] : (c.waypoints ?? []);
  const blocks = !obstacles || !avoidsObstacles(c) ? [] : Array.isArray(obstacles) ? obstacles : obstacles(start, end);
  const route = computeRoute(c.routing, start, end, wps, blocks, { start: stubFor(c.startCap, c.strokeWidth), end: stubFor(c.endCap, c.strokeWidth) });
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

const sameAt = (a: ConnectorEndpoint['at'], b: ConnectorEndpoint['at']) => (!a && !b) || (!!a && !!b && a.u === b.u && a.v === b.v);

const sameEnd = (a: ConnectorEndpoint, b: ConnectorEndpoint) =>
  (a.elementId ?? null) === (b.elementId ?? null) &&
  (a.anchor ?? 'auto') === (b.anchor ?? 'auto') &&
  sameAt(a.at, b.at) &&
  a.x === b.x &&
  a.y === b.y;

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
  local?: Outline,
  removed: ReadonlySet<string> = new Set(),
  obstacles?: Obstacles,
): ElementPatch<ConnectorElement> | null {
  const start = c.start.elementId && removed.has(c.start.elementId) ? detach(c.start) : c.start;
  const end = c.end.elementId && removed.has(c.end.elementId) ? detach(c.end) : c.end;
  const geo = connectorGeometry({ ...c, start, end }, lookup, local, obstacles);
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

/** Endpoint value for a drop: attached to an element (a side, a spot on its outline, or 'auto'), or a free point. */
export function endpoint(target: { id: string; anchor: Side | 'auto'; at?: { u: number; v: number } } | null, at: Point): ConnectorEndpoint {
  if (!target) return { x: round2(at.x), y: round2(at.y) };
  return { elementId: target.id, anchor: target.anchor, ...(target.at ? { at: target.at } : {}), x: round2(at.x), y: round2(at.y) };
}

/** A complete new connector element with its cache already computed. */
export function buildConnector(
  editor: Pick<Editor, 'getElement' | 'getDefinition' | 'getElements'>,
  start: ConnectorEndpoint,
  end: ConnectorEndpoint,
  style: ConnectorStyle,
): NewElement<'connector'> {
  const base = { type: 'connector' as const, start, end, label: '', waypoints: [] as Point[], ...style };
  const lookup = (id: string) => editor.getElement(id);
  const patch = refreshCache({ ...base, x: 0, y: 0, w: 0, h: 0 } as unknown as ConnectorElement, lookup, localAnchors(editor), undefined, liveObstacles(editor));
  return { ...base, x: 0, y: 0, w: 1, h: 1, ...(patch as object) } as NewElement<'connector'>;
}

/** Writes semantic fields of a connector and refreshes its cache in the same write. */
export function patchConnector(editor: Editor, id: string, patch: ElementPatch<ConnectorElement>): void {
  const cur = editor.getElement<ConnectorElement>(id);
  if (!cur || cur.type !== 'connector') return;
  const next = { ...cur, ...patch } as ConnectorElement;
  const cache = refreshCache(next, (i) => editor.getElement(i), localAnchors(editor), undefined, liveObstacles(editor));
  editor.update<ConnectorElement>(id, { ...patch, ...(cache ?? {}) });
}
