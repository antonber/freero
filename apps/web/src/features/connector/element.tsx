import { Spline as SplineIcon } from 'lucide-react';
import { memo, useCallback, useMemo, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { BoardElement, ConnectorElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  canvasInk,
  canvasPaper,
  richTextToPlain,
  useCanEdit,
  useEditingPart,
  useEditor,
  useElement,
  useElementsQuery,
  useSettings,
  type Editor,
  type ElementRenderProps,
  type LowDetailPaint,
  type NewElement,
  type Point,
  type Rect,
} from '@engine';
import {
  aabb,
  capReach,
  capShape,
  capTrim,
  distToPoly,
  inflate,
  pointAlong,
  resolveEnds,
  routePath,
  tAlong,
  type CapShape,
} from './lib/geometry';
import { avoidsObstacles, connectorGeometry, DEFAULT_STYLE, drawnRoutes, localAnchors, refreshCache } from './lib/model';
import { isConnectable, liveObstacles, obstacleIndex, obstaclesBetween, sameRects } from './lib/obstacles';
import { routesBeneath, sameRoutes } from './lib/beneath';
import { jumpRadius, lineJumps, type Hop } from './lib/jumps';

const NO_OBSTACLES: Rect[] = [];
const NO_LINES: Point[][] = [];
const NO_HOPS: Hop[] = [];
/** Hops smaller than this on screen (half their width, px) aren't drawn. */
const MIN_HOP_PX = 2;

const samePoly = (a: Point[] | undefined, b: Point[]) => !!a && a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

/** Grid cell (world units) of the moved-items index below. */
const MOVED_CELL = 1024;
interface MovedIndex {
  all: Rect[];
  cells: Map<string, Rect[]>;
}
/**
 * The boxes of a change's connectable items, indexed once per follower pass (`changed` is that
 * pass's set, and the items in it don't move while lines follow): dragging 500 items, every line
 * on the board used to ask each of them where it went, 2,000 lines × 500 items per pointer move
 * (docs/performance.md).
 */
const movedIndexes = new WeakMap<ReadonlySet<string>, MovedIndex>();
function movedIndex(editor: Editor, changed: ReadonlySet<string>): MovedIndex {
  let idx = movedIndexes.get(changed);
  if (idx) return idx;
  idx = { all: [], cells: new Map() };
  for (const id of changed) {
    const el = editor.getElement(id);
    if (!el || !isConnectable(editor, el)) continue;
    const r = aabb(el);
    idx.all.push(r);
    for (let i = Math.floor(r.x / MOVED_CELL); i <= Math.floor((r.x + r.w) / MOVED_CELL); i++)
      for (let j = Math.floor(r.y / MOVED_CELL); j <= Math.floor((r.y + r.h) / MOVED_CELL); j++) {
        const k = `${i},${j}`;
        const cell = idx.cells.get(k);
        if (cell) cell.push(r);
        else idx.cells.set(k, [r]);
      }
  }
  movedIndexes.set(changed, idx);
  return idx;
}

/** Did a changed item land where this line runs (its stored bounds, with routing margin)? */
function obstacleMovedNear(editor: Editor, c: ConnectorElement, changed: ReadonlySet<string>): boolean {
  const area = inflate({ x: c.x, y: c.y, w: c.w, h: c.h }, 48);
  const idx = movedIndex(editor, changed);
  const hits = (r: Rect) => r.x < area.x + area.w && area.x < r.x + r.w && r.y < area.y + area.h && area.y < r.y + r.h;
  const i0 = Math.floor(area.x / MOVED_CELL);
  const i1 = Math.floor((area.x + area.w) / MOVED_CELL);
  const j0 = Math.floor(area.y / MOVED_CELL);
  const j1 = Math.floor((area.y + area.h) / MOVED_CELL);
  // A line across much of the board: fewer boxes than cells to look in.
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > idx.all.length) return idx.all.some(hits);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (idx.cells.get(`${i},${j}`)?.some(hits)) return true;
  return false;
}
import { DEFAULT_LABEL_T, extraPart, hasMainLabel, labelBoxes, moveLabel, parsePart, partAt, writeLabel, type LabelPart } from './lib/labels';
import './connector.css';

function dashArray(style: ConnectorElement['strokeStyle'], w: number): string | undefined {
  if (style === 'dashed') return `${w * 4} ${w * 3}`;
  if (style === 'dotted') return `0 ${w * 2.4}`;
  return undefined;
}

/** A line end's pieces; `paper` (the board background) fills hollow marks so the line never shows through. */
function Cap({ parts, color, paper, width }: { parts: CapShape[]; color: string; paper: string; width: number }) {
  const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');
  return (
    <>
      {parts.map((shape, i) => {
        switch (shape.kind) {
          case 'polyline':
            return <polyline key={i} points={pts(shape.points)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />;
          case 'polygon':
            return shape.fill === 'ink' ? (
              <polygon key={i} points={pts(shape.points)} fill={color} stroke={color} strokeWidth={width * 0.5} strokeLinejoin="round" />
            ) : (
              <polygon key={i} points={pts(shape.points)} style={{ fill: paper }} stroke={color} strokeWidth={width} strokeLinejoin="round" />
            );
          case 'circle':
            return shape.fill === 'ink' ? (
              <circle key={i} cx={shape.c.x} cy={shape.c.y} r={shape.r} fill={color} />
            ) : (
              <circle key={i} cx={shape.c.x} cy={shape.c.y} r={shape.r} style={{ fill: paper }} stroke={color} strokeWidth={width} />
            );
          case 'line':
            return <line key={i} x1={shape.a.x} y1={shape.a.y} x2={shape.b.x} y2={shape.b.y} stroke={color} strokeWidth={width} strokeLinecap="round" />;
        }
      })}
    </>
  );
}

const ConnectorView = memo(function ConnectorView({ element: c, selected, editing, zoom }: ElementRenderProps<ConnectorElement>) {
  const editor = useEditor();
  // Subscribing to the attached elements is what keeps the line glued to them, for local and
  // remote moves alike, whatever the stored cache says.
  const a = useElement(c.start.elementId ?? null);
  const b = useElement(c.end.elementId ?? null);
  const { background, lineJumps: jumpsOn } = useSettings();
  const lookup = useCallback((id: string): BoardElement | undefined => (id === a?.id ? a : id === b?.id ? b : editor.getElement(id)), [a, b, editor]);
  // Items in the way of an elbow line: it re-routes only when THEIR boxes change, not on every
  // edit elsewhere on the board.
  const selectObstacles = useCallback(
    (all: BoardElement[]): Rect[] => {
      if (!avoidsObstacles(c)) return NO_OBSTACLES;
      const { start, end } = resolveEnds(c, lookup, localAnchors(editor));
      return obstaclesBetween(obstacleIndex(editor, all), start, end);
    },
    [c, lookup, editor],
  );
  const obstacles = useElementsQuery(selectObstacles, sameRects);
  const geo = useMemo(() => connectorGeometry(c, lookup, localAnchors(editor), obstacles), [c, lookup, editor, obstacles]);
  // Kept when the lines above already computed the same route (routeOf): theirs stay unchanged.
  if (!samePoly(drawnRoutes.get(c), geo.route.poly)) drawnRoutes.set(c, geo.route.poly);

  const sw = c.strokeWidth;
  // Painted through `color` + currentColor: the default ink turns light on a dark page (theme.ts).
  const color = 'currentColor';
  const { route } = geo;
  // Line jumps (board setting): hops over the lines beneath that cross this one. Curves cross
  // cleanly enough to tell apart, so they never hop (lines on top of them still do). Zoomed out
  // so far that a hop would be under two pixels, none are worked out (exports draw at full size).
  const jumps = jumpsOn && c.routing !== 'curved' && jumpRadius(sw) * zoom >= MIN_HOP_PX;
  const selectBeneath = useCallback((all: BoardElement[]) => (jumps ? routesBeneath(editor, all, c, route.poly) : NO_LINES), [jumps, editor, c, route.poly]);
  const beneath = useElementsQuery(selectBeneath, sameRoutes);
  const hops = useMemo(
    () =>
      beneath.length
        ? lineJumps(route.poly, beneath, jumpRadius(sw), { start: capReach(c.startCap, sw), end: capReach(c.endCap, sw) })
        : NO_HOPS,
    [beneath, route.poly, sw, c.startCap, c.endCap],
  );
  const d = routePath(route, capTrim(c.startCap, sw), capTrim(c.endCap, sw), c.routing === 'elbow', hops);
  const editingPart = useEditingPart();
  const canEdit = useCanEdit();
  const live = editing ? parsePart(editingPart) : null;
  const poly = route.poly;
  const commit = (part: LabelPart) => (html: string) => {
    const cur = editor.getElement<ConnectorElement>(c.id);
    if (cur) editor.update<ConnectorElement>(c.id, writeLabel(cur, part, html));
  };
  const labelProps = { c, poly, editor, background, draggable: selected && canEdit && !editing };
  return (
    <>
      <svg className="fr-cx" width="1" height="1" aria-hidden style={{ color: canvasInk(c.stroke) }}>
        <g transform={`translate(${-c.x} ${-c.y})`}>
          {selected && <path className="fr-cx__halo" d={d} strokeWidth={sw + 8} />}
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeDasharray={dashArray(c.strokeStyle, sw)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Cap parts={capShape(c.startCap, route.poly[0], route.startTangent, sw)} color={color} paper={canvasPaper(background)} width={sw} />
          <Cap parts={capShape(c.endCap, route.poly[route.poly.length - 1], route.endTangent, sw)} color={color} paper={canvasPaper(background)} width={sw} />
        </g>
      </svg>
      {/* Main label: the element's textField (Enter / double-click on it), or a new one being typed. */}
      {live?.kind === 'main' ? (
        <Label {...labelProps} id={null} t={live.t} editing>
          <LabelText c={c} part={editingPart!} value={c.label} onCommit={commit(live)} />
        </Label>
      ) : (
        (hasMainLabel(c) || (editing && !editingPart)) && (
          <Label {...labelProps} id={null} t={c.labelT ?? DEFAULT_LABEL_T} editing={editing && !editingPart}>
            <LabelText c={c} />
          </Label>
        )
      )}
      {(c.labels ?? []).map((l) => {
        const mine = live?.kind === 'extra' && live.id === l.id;
        return (
          <Label key={l.id} {...labelProps} id={l.id} t={l.t} editing={mine}>
            <LabelText c={c} part={mine ? editingPart! : extraPart(l)} value={l.text} onCommit={commit({ kind: 'extra', id: l.id, t: l.t })} />
          </Label>
        );
      })}
      {/* A new extra label being typed (or one emptied while typing): drawn from its part. */}
      {live?.kind === 'extra' && !(c.labels ?? []).some((l) => l.id === live.id) && (
        <Label {...labelProps} id={live.id} t={live.t} editing>
          <LabelText c={c} part={editingPart!} value="" onCommit={commit(live)} />
        </Label>
      )}
    </>
  );
});

function LabelText(props: { c: ConnectorElement; part?: string; value?: string; onCommit?(html: string): void }) {
  return (
    <ElementText
      element={props.c}
      field="label"
      part={props.part}
      value={props.value}
      onCommit={props.onCommit}
      fontSize={14}
      align="center"
      vAlign="middle"
      padding={0}
      color={canvasInk('#17162B')}
      placeholder="Add text"
      style={{ position: 'relative', inset: 'auto', overflow: 'visible' }}
    />
  );
}

/**
 * One label on the line. Its background (the board's) knocks the line out behind the text so it
 * stays readable over the stroke. On a selected connector a label can be dragged along the line;
 * a click without moving edits it.
 */
function Label(props: {
  c: ConnectorElement;
  poly: Point[];
  editor: Editor;
  background: string;
  id: string | null;
  t: number;
  editing: boolean;
  draggable: boolean;
  children: ReactNode;
}) {
  const { c, poly, editor, id, t } = props;
  const at = pointAlong(poly, t).p;
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const zoom = editor.getCamera().zoom;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    editor.beginGesture();
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      moved = true;
      const p = { x: at.x + (ev.clientX - start.x) / zoom, y: at.y + (ev.clientY - start.y) / zoom };
      const cur = editor.getElement<ConnectorElement>(c.id);
      if (cur) editor.update<ConnectorElement>(c.id, moveLabel(cur, id, tAlong(poly, p)));
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      editor.endGesture();
      if (moved) return;
      const cur = editor.getElement<ConnectorElement>(c.id);
      const label = id ? cur?.labels?.find((l) => l.id === id) : undefined;
      if (id === null) editor.startEditing(c.id);
      else if (label) editor.startEditing(c.id, { part: extraPart(label) });
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };
  const drag = props.draggable ? { 'data-fr-interactive': '', onPointerDown, title: 'Drag along the line · Click to edit' } : {};
  return (
    <div
      className={`fr-cx-label${props.editing ? ' is-editing' : ''}${props.draggable ? ' is-draggable' : ''}`}
      style={{ left: at.x - c.x, top: at.y - c.y, background: canvasPaper(props.background) }}
      {...drag}
    >
      {props.children}
    </div>
  );
}

/**
 * Zoomed out to low detail (#131): a straight run through its stored ends (and bends), in its ink
 * (the selection colour while selected) — no routing around items, no caps, labels, dashes or
 * jumps, and no store queries (the full drawing asks the board for the items in its way and the
 * lines beneath it on every change).
 */
function paintConnector(c: ConnectorElement, p: LowDetailPaint) {
  const pts = [c.start, ...(c.waypoints ?? []), c.end].map((q) => ({ x: q.x - c.x, y: q.y - c.y }));
  p.line(pts, p.selected ? p.selectionColor : canvasInk(c.stroke), c.strokeWidth);
}

export default defineElement({
  type: 'connector',
  label: { one: 'Connector', many: 'Connectors' },
  icon: SplineIcon,
  resize: 'none',
  rotatable: false,
  sharedStyle: (el) => ({ stroke: el.stroke, strokeWidth: el.strokeWidth, strokeStyle: el.strokeStyle }),
  connectable: false,
  // The overlay panel draws endpoint/midpoint handles; a bounding box around a line only confuses.
  selectionFrame: false,
  // A line a few pixels long is thinner than a pixel: left out of a large board's thumbnail.
  swatch: () => null,
  textField: 'label',
  defaults: (): Omit<NewElement<'connector'>, 'x' | 'y'> => ({
    type: 'connector',
    w: 1,
    h: 1,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    label: '',
    waypoints: [],
    ...DEFAULT_STYLE,
  }),
  Component: ConnectorView,
  lowDetail: paintConnector,
  toPlainText: (c) =>
    [c.label, ...(c.labels ?? []).map((l) => l.text)]
      .map(richTextToPlain)
      .filter((t) => t.trim())
      .join(' · '),

  // Accurate hit test against the drawn path (not the bounding box), plus the label. Lines are
  // thin: a little more than the engine's screen tolerance around the stroke.
  hitTest(c, local, { tolerance }) {
    const p = { x: local.x + c.x, y: local.y + c.y };
    const poly = drawnRoutes.get(c) ?? connectorGeometry(c, () => undefined).route.poly;
    if (distToPoly(p, poly) <= c.strokeWidth / 2 + tolerance * 1.5) return true;
    return labelBoxes(c, poly).some(({ box: r }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  },

  // Hidden for me along with either item it is attached to (never drawn to empty space).
  hiddenWith: (c) => [c.start.elementId, c.end.elementId],

  // Extra labels are text parts (the main one is the textField), so find & replace covers them.
  textParts: (c) => (c.labels ?? []).map((l) => ({ part: extraPart(l), html: l.text })),
  writeTextPart(c, part, html, editor) {
    const p = parsePart(part);
    if (p?.kind === 'extra') editor.update<ConnectorElement>(c.id, writeLabel(c, p, html));
  },

  // Double-click on a label edits it; anywhere else on the line adds a label right there.
  textPartAt(c, local) {
    const poly = drawnRoutes.get(c) ?? connectorGeometry(c, () => undefined).route.poly;
    return partAt(c, poly, { x: local.x + c.x, y: local.y + c.y });
  },

  // Engine hook: runs inside every LOCAL change (same undo step / network update). Re-derives
  // the cached endpoints + bounds when an attached element moved, resized, rotated or was
  // deleted (its end then stays where it was, unattached), or when the connector itself changed.
  // An elbow line also re-routes when an item moved into (or within) its way.
  follow(c, { editor, changed, removed }) {
    const ids = [c.start.elementId, c.end.elementId];
    const own = changed.has(c.id) || ids.some((id) => id && (changed.has(id) || removed.has(id)));
    if (!own && !(avoidsObstacles(c) && obstacleMovedNear(editor, c, changed))) return null;
    return refreshCache(c, (id) => editor.getElement(id), localAnchors(editor), removed, liveObstacles(editor));
  },
});

