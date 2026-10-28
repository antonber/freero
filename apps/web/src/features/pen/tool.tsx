import { useMemo } from 'react';
import { Eraser, Highlighter, PenLine } from 'lucide-react';
import { defineTool, useCamera, usePointer, useToolOptions, type Editor, type ToolPointerEvent } from '@engine';
import { ColorSwatches, IconButton } from '@ui';
import {
  HIGHLIGHTER_COLOR_NAMES,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTHS,
  PEN_COLOR_NAMES,
  PEN_COLORS,
  PEN_WIDTHS,
  SIZE_LABELS,
  TOOL_ID,
  resolvePenOptions,
  type PenToolOptions,
  type SizeIndex,
} from './lib/constants';
import { clearDraft, draftPoints, getDraft, startDraft, touchDraft, useDraftVersion, type Draft } from './lib/draft';
import { buildStroke, capturePressure, constrainAngle, simplify, straightStroke, strokePath } from './lib/stroke';

/** Minimum screen distance between captured points. */
const MIN_STEP_PX = 1.5;
/** Point spacing of a Shift-constrained straight stroke, in screen px. */
const STRAIGHT_STEP_PX = 4;
/** Simplification tolerance in screen px (converted to world units at commit). */
const SIMPLIFY_PX = 0.6;
const ERASER_TOOL = 'eraser';

/** Shift held: a straight stroke from the first point to the pointer, on a 15° step; else freehand. */
function constrain(d: Draft, e: ToolPointerEvent, lifted = false) {
  if (!e.shiftKey) {
    d.line = null;
    return;
  }
  const start = d.points[0];
  // An even ruler line: the stylus' current pressure (a lifted pen reports 0, so keep the last
  // one), or the plain width without a stylus.
  const p = !d.realPressure
    ? 0.5
    : lifted
      ? (d.line?.[0]?.p ?? d.points[d.points.length - 1].p)
      : capturePressure({ pressure: e.pressure, real: true }, 0.5, 0, d.highlighter);
  d.line = straightStroke(start, constrainAngle(start, e.point), p, STRAIGHT_STEP_PX / e.editor.getCamera().zoom);
}

function commit(editor: Editor) {
  const d = getDraft();
  clearDraft();
  if (!d || !d.points.length) return;
  const tolerance = SIMPLIFY_PX / editor.getCamera().zoom;
  const points = simplify(draftPoints(d), tolerance);
  editor.create<'pen'>({
    type: 'pen',
    ...buildStroke(points, d.width, d.highlighter),
    stroke: d.color,
    strokeWidth: d.width,
    highlighter: d.highlighter,
  });
}

function DraftStroke() {
  const v = useDraftVersion();
  const d = getDraft();
  // `v` changes whenever points are appended (the points array is mutated in place).
  const path = useMemo(() => (d ? strokePath(draftPoints(d), d.width, d.highlighter, false) : ''), [d, v]);
  if (!d) return null;
  return (
    <svg className={`fr-pen-draft${d.highlighter ? ' fr-pen-draft--highlighter' : ''}`} aria-hidden>
      <path d={path} fill={d.color} fillOpacity={d.highlighter ? HIGHLIGHTER_OPACITY : 1} />
    </svg>
  );
}

function HoverDot() {
  const p = usePointer();
  const opts = resolvePenOptions(useToolOptions<PenToolOptions>(TOOL_ID));
  const { zoom } = useCamera();
  useDraftVersion();
  if (!p || getDraft()) return null;
  // At least a few screen px so the dot stays visible when zoomed out.
  const size = Math.max(opts.width, 5 / zoom);
  return (
    <div
      className="fr-pen-cursor"
      style={{
        width: size,
        height: size,
        background: opts.color,
        opacity: opts.highlighter ? HIGHLIGHTER_OPACITY : 0.9,
        transform: `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`,
      }}
    />
  );
}

function PenOptions({ editor }: { editor: Editor }) {
  const raw = useToolOptions<PenToolOptions>(TOOL_ID);
  const o = resolvePenOptions(raw);
  const widths = o.highlighter ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;
  const set = (patch: PenToolOptions) => editor.setToolOptions(TOOL_ID, patch as Record<string, unknown>);
  return (
    <div className="fr-pen-options">
      <div className="fr-pen-options__modes" role="group" aria-label="Drawing mode">
        <IconButton icon={PenLine} label="Pen" size={32} active={!o.highlighter} onClick={() => set({ mode: 'pen' })} />
        <IconButton
          icon={Highlighter}
          label="Highlighter"
          size={32}
          active={o.highlighter}
          onClick={() => set({ mode: 'highlighter' })}
        />
        <IconButton icon={Eraser} label="Eraser" shortcut="E" size={32} onClick={() => editor.setTool(ERASER_TOOL)} />
      </div>
      <ColorSwatches
        colors={o.highlighter ? HIGHLIGHTER_COLORS : PEN_COLORS}
        names={o.highlighter ? HIGHLIGHTER_COLOR_NAMES : PEN_COLOR_NAMES}
        value={o.color}
        onChange={(c) => set(o.highlighter ? { highlighterColor: c } : { penColor: c })}
        columns={4}
        size={24}
        aria-label={o.highlighter ? 'Highlighter color' : 'Pen color'}
      />
      <div className="fr-pen-options__sizes" role="group" aria-label="Stroke width">
        {widths.map((w, i) => {
          const dot = o.highlighter ? 6 + i * 4 : 3 + i * 3;
          return (
            <button
              key={w}
              type="button"
              className="fr-pen-size"
              aria-pressed={o.size === i}
              aria-label={SIZE_LABELS[i]}
              title={SIZE_LABELS[i]}
              onClick={() => set(o.highlighter ? { highlighterSize: i as SizeIndex } : { penSize: i as SizeIndex })}
            >
              <span style={{ width: dot, height: dot }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default defineTool({
  id: TOOL_ID,
  label: 'Pen',
  icon: PenLine,
  shortcut: 'p',
  order: 50,
  placement: 'main',
  cursor: 'crosshair',
  // Freehand ink follows the pointer exactly, grid or not.
  snapToGrid: false,

  // One stroke = one element = one undo step: the stroke is drawn locally (Preview) and
  // created once on pointer-up; the engine wraps pointer-down → up in a single gesture.
  onPointerDown(e) {
    if (e.button !== 0) return;
    const o = resolvePenOptions(e.editor.getToolOptions<PenToolOptions>(TOOL_ID));
    const realPressure = e.pointerType === 'pen' && e.pressure > 0;
    startDraft({
      points: [{ x: e.point.x, y: e.point.y, p: realPressure ? e.pressure : 0.5 }],
      color: o.color,
      width: o.width,
      highlighter: o.highlighter,
      lastScreen: e.screen,
      realPressure,
      line: null,
    });
  },

  onPointerMove(e) {
    const d = getDraft();
    if (!d) return;
    const dist = Math.hypot(e.screen.x - d.lastScreen.x, e.screen.y - d.lastScreen.y);
    if (dist < MIN_STEP_PX) return;
    const prev = d.points[d.points.length - 1];
    const p = capturePressure({ pressure: e.pressure, real: d.realPressure }, prev.p, dist, d.highlighter);
    d.points.push({ x: e.point.x, y: e.point.y, p });
    d.lastScreen = e.screen;
    constrain(d, e);
    touchDraft();
  },

  onPointerUp(e) {
    const d = getDraft();
    if (d) {
      const last = d.points[d.points.length - 1];
      if (last.x !== e.point.x || last.y !== e.point.y) d.points.push({ x: e.point.x, y: e.point.y, p: last.p });
      constrain(d, e, true);
    }
    commit(e.editor);
  },

  onCancel() {
    clearDraft();
  },

  onDeactivate() {
    clearDraft();
  },

  Options: PenOptions,

  Preview: () => (
    <>
      <DraftStroke />
      <HoverDot />
    </>
  ),
});
