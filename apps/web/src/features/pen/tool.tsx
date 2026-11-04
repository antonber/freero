import { useMemo } from 'react';
import { Eraser, Highlighter, LassoSelect, PenLine } from 'lucide-react';
import { defineTool, useCamera, usePointer, useToolOptions, type Editor, type ToolPointerEvent } from '@engine';
import { ColorSwatches, IconButton, Toggle } from '@ui';
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
import { recognise, type Recognition } from './lib/recognise';
import { applyRecognition } from './lib/smart';
import { buildStroke, capturePressure, constrainAngle, simplify, straightStroke, strokePath } from './lib/stroke';

import { t } from './messages';
/** Minimum screen distance between captured points. */
const MIN_STEP_PX = 1.5;
/** Point spacing of a Shift-constrained straight stroke, in screen px. */
const STRAIGHT_STEP_PX = 4;
/** Simplification tolerance in screen px (converted to world units at commit). */
const SIMPLIFY_PX = 0.6;
const ERASER_TOOL = 'eraser';
/** The engine's lasso tool (#111), offered beside the eraser. */
const LASSO_TOOL = 'lasso';
/** Smart drawing: strokes smaller than this on screen (px) stay ink (dots, ticks, small writing). */
const MIN_SMART_PX = 24;
/** Smart drawing: resting the pen this long (ms) at the end of a stroke straightens it… */
const HOLD_MS = 650;
/** …as long as it stays within this many screen px. */
const HOLD_SLOP_PX = 5;

/** Shift held: a straight stroke from the first point to the pointer, on a 15° step; else freehand. */
function constrain(d: Draft, e: ToolPointerEvent, lifted = false) {
  if (!e.shiftKey) {
    if (!d.held) d.line = null;
    return;
  }
  d.held = false;
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

// ---- hold to straighten (smart drawing): a timer, since a resting pointer sends no events.
let hold: { timer: ReturnType<typeof setTimeout>; at: { x: number; y: number } } | null = null;

function stopHold() {
  if (hold) clearTimeout(hold.timer);
  hold = null;
}

/** (Re)starts the rest timer at the pointer; moving on past the slop undoes a straightening. */
function watchHold(editor: Editor, d: Draft, screen: { x: number; y: number }) {
  if (hold && Math.hypot(screen.x - hold.at.x, screen.y - hold.at.y) <= HOLD_SLOP_PX) return;
  stopHold();
  if (d.held) {
    d.held = false;
    d.line = null;
  }
  if (d.highlighter || !resolvePenOptions(editor.getToolOptions<PenToolOptions>(TOOL_ID)).smart) return;
  hold = {
    at: screen,
    timer: setTimeout(() => {
      hold = null;
      const cur = getDraft();
      if (cur !== d || d.line || d.points.length < 2) return;
      const zoom = editor.getCamera().zoom;
      const start = d.points[0];
      const end = d.points[d.points.length - 1];
      if (Math.hypot(end.x - start.x, end.y - start.y) * zoom < MIN_SMART_PX) return;
      d.held = true;
      d.line = straightStroke(start, end, d.realPressure ? end.p : 0.5, STRAIGHT_STEP_PX / zoom);
      touchDraft();
    }, HOLD_MS),
  };
}

/** What smart drawing makes of the finished draft, or null to keep the ink as drawn. */
function reading(editor: Editor, d: Draft): Recognition | null {
  if (d.highlighter || !resolvePenOptions(editor.getToolOptions<PenToolOptions>(TOOL_ID)).smart) return null;
  // Only editors make shapes and lines; a participant's draft stays ink.
  if (!editor.can('editor')) return null;
  if (d.held && d.line) return { type: 'line', from: d.line[0], to: d.line[d.line.length - 1], arrow: false };
  // A Shift-ruled stroke is a straight line of ink on purpose.
  if (d.line) return null;
  return recognise(d.points, MIN_SMART_PX / editor.getCamera().zoom);
}

function commit(editor: Editor) {
  const d = getDraft();
  stopHold();
  clearDraft();
  if (!d || !d.points.length) return;
  const tolerance = SIMPLIFY_PX / editor.getCamera().zoom;
  const points = simplify(draftPoints(d), tolerance);
  const inkId = editor.create<'pen'>({
    type: 'pen',
    ...buildStroke(points, d.width, d.highlighter),
    stroke: d.color,
    strokeWidth: d.width,
    highlighter: d.highlighter,
  });
  const r = inkId ? reading(editor, d) : null;
  // The clean version is its own undo step after the stroke's: Undo once brings the ink back.
  if (r) editor.afterGesture(() => applyRecognition(editor, inkId, r, { color: d.color, width: d.width }));
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
      <div className="fr-pen-options__modes" role="group" aria-label={t('drawingMode')}>
        <IconButton icon={PenLine} label={t('pen')} size={32} active={!o.highlighter} onClick={() => set({ mode: 'pen' })} />
        <IconButton
          icon={Highlighter}
          label={t('highlighter')}
          size={32}
          active={o.highlighter}
          onClick={() => set({ mode: 'highlighter' })}
        />
        <IconButton icon={Eraser} label={t('eraser')} shortcut="E" size={32} onClick={() => editor.setTool(ERASER_TOOL)} />
        <IconButton icon={LassoSelect} label={t('lasso')} size={32} onClick={() => editor.setTool(LASSO_TOOL)} />
      </div>
      <ColorSwatches
        colors={o.highlighter ? HIGHLIGHTER_COLORS : PEN_COLORS}
        names={o.highlighter ? HIGHLIGHTER_COLOR_NAMES : PEN_COLOR_NAMES}
        value={o.color}
        onChange={(c) => set(o.highlighter ? { highlighterColor: c } : { penColor: c })}
        columns={4}
        size={24}
        aria-label={o.highlighter ? t('highlighterColor') : t('penColor')}
      />
      <div className="fr-pen-options__sizes" role="group" aria-label={t('strokeWidth')}>
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
      {!o.highlighter && (
        <div className="fr-pen-options__smart" title="Rough rectangles, circles, triangles, diamonds, lines and arrows become clean ones. Rest the pen at the end of a stroke to straighten it; scribble over items to erase them.">
          <Toggle size="sm" label={t('smartDrawing')} checked={o.smart} onChange={(smart) => set({ smart })} />
        </div>
      )}
    </div>
  );
}

export default defineTool({
  id: TOOL_ID,
  label: t('pen'),
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
    const d: Draft = {
      points: [{ x: e.point.x, y: e.point.y, p: realPressure ? e.pressure : 0.5 }],
      color: o.color,
      width: o.width,
      highlighter: o.highlighter,
      lastScreen: e.screen,
      realPressure,
      line: null,
    };
    startDraft(d);
    watchHold(e.editor, d, e.screen);
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
    watchHold(e.editor, d, e.screen);
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
    stopHold();
    clearDraft();
  },

  onDeactivate() {
    stopHold();
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
