import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, MoreHorizontal, Palette, Pencil, Plus, Rows3, Trash2 } from 'lucide-react';
import type { SwimlaneBand, SwimlaneElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  richTextToPlain,
  sanitizeRichText,
  useCanEdit,
  useEditor,
  type Editor,
  type ElementRenderProps,
  type NewElement,
} from '@engine';
import { Menu, type MenuItem } from '@ui';
import {
  DEFAULT_LANE,
  DEFAULT_PHASE,
  FIT_PAD,
  LANE_HEAD_H,
  LANE_HEAD_W,
  MIN_BAND,
  PHASE_HEAD_H,
  PHASE_HEAD_W,
  TITLE_H,
  absorbResize,
  gridOf,
  placements,
  planFit,
  showsPhases,
  sizeOf,
  type Grid,
} from './lib/layout';
import { LANE_COLORS, addBand, bandPart, moveBand, parseBandPart, patchBand, removeBand, renameBand, resizeBand, type BandKind } from './lib/actions';
import './swimlane.css';

const sameBands = (a: SwimlaneElement, b: SwimlaneElement) => {
  const same = (x: SwimlaneBand[], y: SwimlaneBand[]) => x.length === y.length && x.every((band, i) => band.id === y[i].id && band.size === y[i].size);
  return !!a.vertical === !!b.vertical && same(a.lanes, b.lanes) && same(a.phases, b.phases);
};

/** Below this zoom text is unreadable: draw only the bands. */
const LOD_ZOOM = 0.15;
const COLOR_NAMES = ['Violet', 'Blue', 'Green', 'Amber', 'Coral', 'Grey'];

interface Cell {
  kind: BandKind;
  band: SwimlaneBand;
  index: number;
  /** Header cell, element-local. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every band header cell (lanes, then phases when there are two or more), element-local. */
function headerCells(p: SwimlaneElement, g: Grid): Cell[] {
  const cells: Cell[] = p.lanes.map((band, index) => {
    const s = g.laneStarts[index];
    return p.vertical
      ? { kind: 'lanes', band, index, x: s, y: TITLE_H, w: band.size, h: LANE_HEAD_H }
      : { kind: 'lanes', band, index, x: 0, y: s, w: LANE_HEAD_W, h: band.size };
  });
  if (showsPhases(p))
    p.phases.forEach((band, index) => {
      const s = g.phaseStarts[index];
      cells.push(
        p.vertical
          ? { kind: 'phases', band, index, x: 0, y: s, w: PHASE_HEAD_W, h: band.size }
          : { kind: 'phases', band, index, x: s, y: TITLE_H, w: band.size, h: PHASE_HEAD_H },
      );
    });
  return cells;
}

function BandMenu({ editor, p, cell }: { editor: Editor; p: SwimlaneElement; cell: Cell }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { kind, band, index } = cell;
  const list = p[kind];
  // Lanes are rows unless the pool is vertical; phases run the other way.
  const rows = (kind === 'lanes') !== !!p.vertical;
  const noun = kind === 'lanes' ? 'lane' : 'phase';
  const items: MenuItem[] = [
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => renameBand(editor, p.id, kind, band.id) },
    {
      id: 'color',
      label: 'Colour',
      icon: Palette,
      onSelect: () => undefined,
      submenu: LANE_COLORS.map((c, i) => ({
        id: c,
        label: COLOR_NAMES[i],
        checked: band.color === c,
        onSelect: () => patchBand(editor, p.id, kind, band.id, { color: c }),
      })),
    },
    { divider: true },
    { id: 'prev', label: rows ? 'Move up' : 'Move left', icon: rows ? ArrowUp : ArrowLeft, disabled: index === 0, onSelect: () => moveBand(editor, p.id, kind, band.id, -1) },
    { id: 'next', label: rows ? 'Move down' : 'Move right', icon: rows ? ArrowDown : ArrowRight, disabled: index === list.length - 1, onSelect: () => moveBand(editor, p.id, kind, band.id, 1) },
    { id: 'before', label: `Add ${noun} ${rows ? 'above' : 'before'}`, icon: Plus, onSelect: () => addBand(editor, p.id, kind, index) },
    { id: 'after', label: `Add ${noun} ${rows ? 'below' : 'after'}`, icon: Plus, onSelect: () => addBand(editor, p.id, kind, index + 1) },
    { divider: true },
    {
      id: 'delete',
      label: `Delete ${noun}`,
      icon: Trash2,
      danger: true,
      disabled: list.length < 2,
      disabledReason: `A pool keeps at least one ${noun}`,
      onSelect: () => removeBand(editor, p.id, kind, band.id),
    },
  ];
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`fr-swim__menu${open ? ' is-open' : ''}`}
        data-fr-interactive=""
        aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} options: ${richTextToPlain(band.title) || 'Untitled'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={14} aria-hidden />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} items={items} aria-label={`${noun} options`} />
    </>
  );
}

/**
 * The far edge of a band, dragged to resize it: the items of the bands after it move along, live,
 * and the band never shrinks past what is in it. One gesture = one undo step; Escape cancels.
 */
function BandEdge({ editor, p, kind, index, g }: { editor: Editor; p: SwimlaneElement; kind: BandKind; index: number; g: Grid }) {
  const band = p[kind][index];
  const alongX = (kind === 'lanes') === !!p.vertical;
  const start = kind === 'lanes' ? g.laneStarts[index] : g.phaseStarts[index];
  const edge = start + band.size;
  // A vertical edge runs below the title band; a horizontal one across the whole pool.
  const style = alongX ? { left: edge - 4, top: TITLE_H, width: 8, height: g.h - TITLE_H } : { left: 0, top: edge - 4, width: g.w, height: 8 };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const zoom = editor.getCamera().zoom;
    const from = alongX ? e.clientX : e.clientY;
    // What the band holds now: it can't get smaller than that.
    const inBand = placements(p, editor.getElements()).filter((pl) => (kind === 'lanes' ? pl.lane : pl.phase) === index);
    const need = Math.max(
      MIN_BAND,
      ...inBand.map((pl) => (kind === 'lanes' ? pl.laneOffset : pl.phaseOffset) + (alongX ? pl.el.w : pl.el.h) + FIT_PAD),
    );
    editor.beginGesture();
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const size = Math.max(need, band.size + ((alongX ? ev.clientX : ev.clientY) - from) / zoom);
      resizeBand(editor, p.id, kind, band.id, size);
    };
    const done = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('keydown', onKey, true);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      done();
      editor.endGesture();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      done();
      editor.cancelGesture();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('keydown', onKey, true);
  };
  return (
    <div
      className={`fr-swim__edge ${alongX ? 'is-col' : 'is-row'}`}
      data-fr-interactive=""
      title={`Drag to resize the ${kind === 'lanes' ? 'lane' : 'phase'}`}
      style={style}
      onPointerDown={onPointerDown}
    />
  );
}

const SwimlaneView = memo(function SwimlaneView({ element: p, selected, zoom }: ElementRenderProps<SwimlaneElement>) {
  const editor = useEditor();
  const canEdit = useCanEdit();
  const g = gridOf(p);
  const cells = headerCells(p, g);
  const controls = selected && canEdit && !p.locked;
  const lod = zoom < LOD_ZOOM;
  const ph = showsPhases(p);
  return (
    <div className={`fr-swim${p.vertical ? ' is-vertical' : ''}`}>
      <div className="fr-swim__title" style={{ height: TITLE_H }}>
        {!lod && (
          <ElementText
            element={p}
            field="title"
            fontSize={18}
            fontFamily="sans"
            align="left"
            vAlign="middle"
            color="var(--fr-ink)"
            padding={{ top: 0, right: 12, bottom: 0, left: 16 }}
            style={{ fontWeight: 650 }}
            placeholder="Pool"
          />
        )}
      </div>
      {/* Lane bodies, tinted with their header colour. */}
      {p.lanes.map((band, i) => {
        const s = g.laneStarts[i];
        const body = p.vertical
          ? { left: s, top: g.phaseStarts[0], width: band.size, height: g.phaseEnd - g.phaseStarts[0] }
          : { left: g.phaseStarts[0], top: s, width: g.phaseEnd - g.phaseStarts[0], height: band.size };
        return <div key={band.id} className="fr-swim__lane" style={{ ...body, ['--band' as string]: band.color }} />;
      })}
      {/* Phase separators across the lanes. */}
      {ph &&
        p.phases.slice(1).map((band, i) => {
          const s = g.phaseStarts[i + 1];
          const line = p.vertical
            ? { left: g.laneStarts[0], top: s, width: g.laneEnd - g.laneStarts[0], height: 0 }
            : { left: s, top: g.laneStarts[0], width: 0, height: g.laneEnd - g.laneStarts[0] };
          return <div key={band.id} className={`fr-swim__phase-line ${p.vertical ? 'is-row' : 'is-col'}`} style={line} />;
        })}
      {cells.map((cell) => (
        <div
          key={`${cell.kind}:${cell.band.id}`}
          className={`fr-swim__head is-${cell.kind}`}
          style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h, ['--band' as string]: cell.band.color }}
        >
          {!lod && (
            <div className="fr-swim__head-text">
              <ElementText
                element={p}
                field="lanes"
                part={bandPart(cell.kind, cell.band.id)}
                value={cell.band.title}
                onCommit={(html) => patchBand(editor, p.id, cell.kind, cell.band.id, { title: sanitizeRichText(html) })}
                fontSize={14}
                fontFamily="sans"
                align={!p.vertical && cell.kind === 'lanes' ? 'left' : 'center'}
                vAlign={!p.vertical && cell.kind === 'lanes' ? 'top' : 'middle'}
                color="var(--fr-ink)"
                padding={{ top: 10, right: 28, bottom: 8, left: 12 }}
                style={{ fontWeight: 600 }}
                placeholder={cell.kind === 'lanes' ? 'Lane' : 'Phase'}
              />
            </div>
          )}
          {controls && !lod && <BandMenu editor={editor} p={p} cell={cell} />}
        </div>
      ))}
      {controls && p.lanes.map((band, i) => <BandEdge key={`le:${band.id}`} editor={editor} p={p} kind="lanes" index={i} g={g} />)}
      {controls && ph && p.phases.map((band, i) => <BandEdge key={`pe:${band.id}`} editor={editor} p={p} kind="phases" index={i} g={g} />)}
    </div>
  );
});

export default defineElement({
  type: 'swimlane',
  label: { one: 'Swimlane', many: 'Swimlanes' },
  icon: Rows3,
  // Handles resize the edge band (the first when the start edge moves, else the last).
  resize: 'free',
  rotatable: false,
  container: true,
  textField: 'title',
  minSize: { w: LANE_HEAD_W + MIN_BAND, h: TITLE_H + MIN_BAND },
  defaults: (): Omit<NewElement<'swimlane'>, 'x' | 'y'> => {
    const lanes = [{ id: 'lane', title: 'Lane', size: DEFAULT_LANE, color: LANE_COLORS[0] }];
    const phases = [{ id: 'phase', title: 'Phase', size: DEFAULT_PHASE, color: LANE_COLORS[5] }];
    return { type: 'swimlane', title: 'Swimlanes', lanes, phases, ...sizeOf({ lanes, phases }) };
  },
  Component: SwimlaneView,
  toPlainText: (p) => [p.title, ...p.lanes.map((b) => b.title), ...p.phases.map((b) => b.title)].map(richTextToPlain).filter(Boolean).join('\n'),
  // The box always follows the bands; a handle drag resizes the band at that edge.
  normalize(next, prev) {
    if (prev && sameBands(prev, next) && (next.w !== prev.w || next.h !== prev.h)) return absorbResize(next, prev);
    const size = sizeOf(next);
    return size.w !== next.w || size.h !== next.h ? size : null;
  },
  // Double-click a lane or phase header to rename it; the title band edits the pool's title.
  textPartAt(p, local) {
    const g = gridOf(p);
    for (const cell of headerCells(p, g))
      if (local.x >= cell.x && local.x <= cell.x + cell.w && local.y >= cell.y && local.y <= cell.y + cell.h) return bandPart(cell.kind, cell.band.id);
    return null;
  },
  textParts: (p) => [...p.lanes.map((b) => ({ part: bandPart('lanes', b.id), html: b.title })), ...p.phases.map((b) => ({ part: bandPart('phases', b.id), html: b.title }))],
  writeTextPart(p, part, html, editor) {
    const b = parseBandPart(part);
    if (b) patchBand(editor, p.id, b.kind, b.id, { title: sanitizeRichText(html) });
  },
  // Lanes grow to fit what is dropped in them; the items of later lanes move along. Items sit on
  // the pool, never under it.
  arrange(p, { editor }) {
    const all = editor.getElements();
    const plan = planFit(p, all);
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
    if (plan) {
      const own: Record<string, unknown> = { lanes: plan.lanes, phases: plan.phases };
      if (plan.dx || plan.dy) Object.assign(own, { x: p.x + plan.dx, y: p.y + plan.dy });
      patches.push({ id: p.id, patch: own });
      const moved = new Map(plan.moves.map((m) => [m.id, m]));
      // Whatever travels with a moved item: a frame's children, stamps riding on it.
      for (let changed = true; changed; ) {
        changed = false;
        for (const el of all) {
          if (moved.has(el.id) || el.type === 'connector') continue;
          const carrier = (el.frameId && moved.get(el.frameId)) || (el.attachedTo && moved.get(el.attachedTo));
          if (carrier) {
            moved.set(el.id, { id: el.id, dx: carrier.dx, dy: carrier.dy });
            changed = true;
          }
        }
      }
      for (const m of moved.values()) {
        const el = editor.getElement(m.id);
        if (el) patches.push({ id: m.id, patch: { x: el.x + m.dx, y: el.y + m.dy } });
      }
    }
    let k = 0;
    for (const el of all) {
      if (el.frameId !== p.id || el.z > p.z) continue;
      const existing = patches.find((x) => x.id === el.id);
      const z = p.z + 1 + k++ / 1000;
      if (existing) existing.patch.z = z;
      else patches.push({ id: el.id, patch: { z } });
    }
    return patches.length ? (patches as never) : null;
  },
});
