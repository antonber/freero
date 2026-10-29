import { memo, useCallback, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChartGantt, Diamond, MoreHorizontal, Palette, Pencil, Plus, Trash2 } from 'lucide-react';
import type { BoardElement, TimelineBarElement, TimelineElement, TimelineLane } from '@freero/shared';
import {
  defineElement,
  ElementText,
  richTextToPlain,
  sanitizeRichText,
  useCanEdit,
  useEditor,
  useElement,
  useElementsQuery,
  useIsExporting,
  type Editor,
  type ElementDefinition,
  type ElementRenderProps,
  type NewElement,
} from '@engine';
import { Menu, readableTextColor, type MenuItem } from '@ui';
import { axisTicks, dayOf, formatRange, localDay, weekday } from './lib/dates';
import { BAR_H, HEAD_H, HORIZON_LABELS, HORIZON_W, LABEL_W, ROW_H, barSpan, dayX, gridOf, horizonsOf, isMemberType, laneAt, planTimeline, type Grid, type Member, type MemberInput } from './lib/layout';
import { BAR_COLORS, LANE_COLORS, addBar, addLane, lanePart, moveLane, parseLanePart, patchLane, removeLane, renameLane } from './lib/actions';
import './timeline.css';

/** Below this zoom labels are unreadable: draw only the lanes and the grid. */
const LOD_ZOOM = 0.25;
const TITLE_PART = 'title';
const COLOR_NAMES = ['Violet', 'Blue', 'Green', 'Amber', 'Coral', 'Grey'];
/** Bars narrower than this show their title beside them, in this much room. */
const NARROW_W = 56;
const OUTSIDE_LABEL_W = 180;

function LaneMenu({ editor, t, lane, index }: { editor: Editor; t: TimelineElement; lane: TimelineLane; index: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const items: MenuItem[] = [
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: () => renameLane(editor, t.id, lane.id) },
    {
      id: 'color',
      label: 'Colour',
      icon: Palette,
      onSelect: () => undefined,
      submenu: LANE_COLORS.map((c, i) => ({ id: c, label: COLOR_NAMES[i], checked: lane.color === c, onSelect: () => patchLane(editor, t.id, lane.id, { color: c }) })),
    },
    { divider: true },
    { id: 'up', label: 'Move up', icon: ArrowUp, disabled: index === 0, onSelect: () => moveLane(editor, t.id, lane.id, -1) },
    { id: 'down', label: 'Move down', icon: ArrowDown, disabled: index === t.lanes.length - 1, onSelect: () => moveLane(editor, t.id, lane.id, 1) },
    { id: 'add', label: 'Add lane below', icon: Plus, onSelect: () => addLane(editor, t.id, index + 1) },
    { id: 'bar', label: 'Add bar in this lane', icon: ChartGantt, onSelect: () => addBar(editor, t.id, { at: laneStartPoint(t, index) }) },
    { divider: true },
    {
      id: 'delete',
      label: 'Delete lane',
      icon: Trash2,
      danger: true,
      disabled: t.lanes.length < 2,
      disabledReason: 'A timeline keeps at least one lane',
      onSelect: () => removeLane(editor, t.id, lane.id),
    },
  ];
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`fr-timeline__menu${open ? ' is-open' : ''}`}
        data-fr-interactive=""
        aria-label={`Lane options: ${richTextToPlain(lane.title) || 'Untitled'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={14} aria-hidden />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} items={items} aria-label="Lane options" />
    </>
  );
}

/** World point at the start of a lane's first row (where "Add bar" puts a new bar). */
function laneStartPoint(t: TimelineElement, index: number) {
  const g = gridOf(t);
  return { x: t.x + LABEL_W + 1, y: t.y + g.laneTops[index] + ROW_H / 2 + 6 };
}

function Axis({ t, g, lod }: { t: TimelineElement; g: Grid; lod: boolean }) {
  const { top, units } = axisTicks(t.scale, g.startDay, g.endDay);
  const x = (day: number) => dayX(g, day);
  return (
    <>
      <div className="fr-timeline__head" style={{ left: LABEL_W, width: g.w - LABEL_W, height: HEAD_H }}>
        {top.map((k) => (
          <div key={`t${k.from}`} className="fr-timeline__tick is-top" style={{ left: x(k.from) - LABEL_W, width: (k.to - k.from) * g.ppd }}>
            {!lod && <span>{k.label}</span>}
          </div>
        ))}
        {units.map((k) => (
          <div key={`u${k.from}`} className="fr-timeline__tick is-unit" style={{ left: x(k.from) - LABEL_W, width: (k.to - k.from) * g.ppd }}>
            {!lod && (k.to - k.from) * g.ppd >= 18 && <span>{k.label}</span>}
          </div>
        ))}
      </div>
      {/* Unit lines down the lanes; weekends shaded on a day scale. */}
      {units.map((k) => (
        <div
          key={`g${k.from}`}
          className={`fr-timeline__col${t.scale === 'day' && weekday(k.from) >= 5 ? ' is-weekend' : ''}`}
          style={{ left: x(k.from), width: (k.to - k.from) * g.ppd, top: HEAD_H, height: g.h - HEAD_H }}
        />
      ))}
    </>
  );
}

/** Now / Next / Later (KAI-160): three columns instead of the date axis. */
function Horizons({ t, g, lod, today }: { t: TimelineElement; g: Grid; lod: boolean; today: number }) {
  const h = horizonsOf(t.scale, today);
  return (
    <>
      <div className="fr-timeline__head" style={{ left: LABEL_W, width: g.w - LABEL_W, height: HEAD_H }}>
        {HORIZON_LABELS.map((label, i) => (
          <div key={label} className={`fr-timeline__horizon${i === 0 ? ' is-now' : ''}`} style={{ left: i * HORIZON_W, width: HORIZON_W }}>
            {!lod && (
              <>
                <strong>{label}</strong>
                <span>{h.labels[i]}</span>
              </>
            )}
          </div>
        ))}
      </div>
      {HORIZON_LABELS.map((label, i) => (
        <div key={`c${label}`} className={`fr-timeline__col is-horizon${i === 0 ? ' is-now' : ''}`} style={{ left: LABEL_W + i * HORIZON_W, width: HORIZON_W, top: HEAD_H, height: g.h - HEAD_H }} />
      ))}
    </>
  );
}

const TimelineView = memo(function TimelineView({ element: t, selected, zoom }: ElementRenderProps<TimelineElement>) {
  const editor = useEditor();
  const canEdit = useCanEdit();
  const exporting = useIsExporting();
  const g = gridOf(t);
  const lod = zoom < LOD_ZOOM;
  const controls = selected && canEdit && !t.locked && !lod && !exporting;
  const empty = useElementsQuery(
    useCallback((els: BoardElement[]) => !els.some((e) => e.frameId === t.id && isMemberType(e)), [t.id]),
    Object.is,
  );
  const today = dayOf(localDay(editor.host.serverNow()));
  const showToday = today >= g.startDay && today <= g.endDay;
  return (
    <div className="fr-timeline">
      <div className="fr-timeline__corner" style={{ width: LABEL_W, height: HEAD_H }}>
        {!lod && (
          <ElementText
            element={t}
            field="title"
            part={TITLE_PART}
            value={t.title}
            onCommit={(html) => editor.update<TimelineElement>(t.id, { title: sanitizeRichText(html) })}
            fontSize={16}
            fontFamily="sans"
            align="left"
            vAlign="middle"
            color="var(--fr-ink)"
            padding={{ top: 0, right: 10, bottom: 0, left: 14 }}
            style={{ fontWeight: 650 }}
            placeholder="Timeline"
          />
        )}
      </div>
      {t.lanes.map((lane, i) => (
        <div key={lane.id} className="fr-timeline__lane" style={{ top: g.laneTops[i], height: g.laneHeights[i], ['--lane' as string]: lane.color }}>
          <div className="fr-timeline__lane-head" style={{ width: LABEL_W }}>
            {!lod && (
              <ElementText
                element={t}
                field="lanes"
                part={lanePart(lane.id)}
                value={lane.title}
                onCommit={(html) => patchLane(editor, t.id, lane.id, { title: sanitizeRichText(html) })}
                fontSize={14}
                fontFamily="sans"
                align="left"
                vAlign="top"
                color="var(--fr-ink)"
                padding={{ top: 10, right: 28, bottom: 8, left: 14 }}
                style={{ fontWeight: 600 }}
                placeholder="Lane"
              />
            )}
            {controls && <LaneMenu editor={editor} t={t} lane={lane} index={i} />}
          </div>
        </div>
      ))}
      {t.view === 'horizons' ? <Horizons t={t} g={g} lod={lod} today={today} /> : <Axis t={t} g={g} lod={lod} />}
      {showToday && t.view !== 'horizons' && (
        <div className="fr-timeline__today" style={{ left: dayX(g, today) + g.ppd / 2, height: g.h - HEAD_H, top: HEAD_H }} aria-label="Today" />
      )}
      {empty && !lod && !exporting && canEdit && (
        <div className="fr-timeline__hint" style={{ left: LABEL_W + 16, top: g.laneTops[0] + 14 }}>
          Double-click a lane to add a bar, or drop task cards here
        </div>
      )}
    </div>
  );
});

const BarView = memo(function BarView({ element: b, zoom }: ElementRenderProps<TimelineBarElement>) {
  const parent = useElement<TimelineElement>(b.frameId);
  const t = parent?.type === 'timeline' ? parent : null;
  const clip = t && t.view !== 'horizons' ? barSpan(gridOf(t), dayOf(b.start), dayOf(b.end), !!b.milestone).clipped : null;
  const color = b.color || BAR_COLORS[0];
  const ink = readableTextColor(color);
  const lod = zoom < LOD_ZOOM;
  const tip = `${richTextToPlain(b.title) || (b.milestone ? 'Milestone' : 'Bar')} · ${formatRange(b.start, b.end)}${clip ? ' (outside the timeline’s range)' : ''}`;
  if (b.milestone) {
    return (
      <div className={`fr-tlbar is-milestone${clip ? ' is-clipped' : ''}`} title={tip}>
        <div className="fr-tlbar__diamond" style={{ background: color }} />
        {!lod && (
          <div className="fr-tlbar__label" style={{ left: BAR_H + 6 }}>
            <ElementText element={b} field="title" fontSize={13} fontFamily="sans" align="left" vAlign="middle" color="var(--fr-ink)" padding={0} style={{ fontWeight: 600, whiteSpace: 'nowrap' }} placeholder="Milestone" />
          </div>
        )}
      </div>
    );
  }
  // Too short for its title (a few days on a month scale): the title goes beside it.
  const outside = b.w < NARROW_W;
  return (
    <div className={`fr-tlbar${clip ? ` is-clip-${clip}` : ''}${outside ? ' is-narrow' : ''}`} style={{ ['--bar' as string]: color, color: ink }} title={tip}>
      {!lod && (
        <div className="fr-tlbar__title" style={outside ? { left: b.w + 6, width: OUTSIDE_LABEL_W } : undefined}>
          <ElementText
            element={b}
            field="title"
            fontSize={13}
            fontFamily="sans"
            align="left"
            vAlign="middle"
            color={outside ? 'var(--fr-ink)' : ink}
            padding={outside ? 0 : { top: 0, right: 8, bottom: 0, left: 10 }}
            style={{ fontWeight: 600, whiteSpace: 'nowrap' }}
            placeholder="Bar"
          />
        </div>
      )}
    </div>
  );
});

const timeline = defineElement({
  type: 'timeline',
  label: { one: 'Timeline', many: 'Timelines' },
  icon: ChartGantt,
  // Side handles move the range's first / last day; the height follows the lanes.
  resize: 'free',
  rotatable: false,
  container: true,
  minSize: { w: LABEL_W + 60, h: HEAD_H + 40 },
  defaults: (): Omit<NewElement<'timeline'>, 'x' | 'y'> => {
    const fields = { title: 'Timeline', start: '2026-01-05', end: '2026-03-01', scale: 'week' as const, lanes: [{ id: 'lane', title: 'Lane', color: LANE_COLORS[0], rows: 2 }] };
    const { w, h } = gridOf(fields);
    return { type: 'timeline', ...fields, w, h };
  },
  Component: TimelineView,
  toPlainText: (t) => [t.title, ...t.lanes.map((l) => l.title)].map(richTextToPlain).filter(Boolean).join('\n'),
  // The title (top-left corner) and each lane's name are texts; double-clicking anywhere else on
  // a lane adds a bar there.
  textPartAt(t, local) {
    if (local.x > LABEL_W) return null;
    if (local.y < HEAD_H) return TITLE_PART;
    return t.lanes[laneAt(gridOf(t), local.y)] ? lanePart(t.lanes[laneAt(gridOf(t), local.y)].id) : null;
  },
  textParts: (t) => [{ part: TITLE_PART, html: t.title }, ...t.lanes.map((l) => ({ part: lanePart(l.id), html: l.title }))],
  writeTextPart(t, part, html, editor) {
    if (part === TITLE_PART) return editor.update<TimelineElement>(t.id, { title: sanitizeRichText(html) });
    const id = parseLanePart(part);
    if (id) patchLane(editor, t.id, id, { title: sanitizeRichText(html) });
  },
  onDoubleClick(t, { editor, point }) {
    if (point.y - t.y > HEAD_H && point.x - t.x > LABEL_W) addBar(editor, t.id, { at: point });
  },
  // Bars sit at their dates in their lane; a bar someone moved or resized takes the dates it now
  // shows (lib/layout.ts). Cards' dates are set by the card feature (`card.setDates`).
  arrange(t, { editor, touched, previous }) {
    const prevRaw = touched.has(t.id) ? previous.get(t.id) : undefined;
    const prevT = prevRaw && prevRaw.type === 'timeline' ? (prevRaw as TimelineElement) : null;
    const members: MemberInput[] = [];
    const left: Member[] = [];
    for (const el of editor.getElements()) {
      if (!isMemberType(el)) continue;
      // undefined: untouched by the change; null: created by it.
      const prev = touched.has(el.id) && previous.has(el.id) ? (previous.get(el.id) ?? null) : undefined;
      if (el.frameId === t.id) members.push({ el, prev });
      else if (prev && prev.frameId === t.id) left.push(el);
    }
    const plan = planTimeline(t, prevT, members, left, dayOf(localDay(editor.host.serverNow())));
    for (const d of plan.cardDates) editor.runCommand('card.setDates', d as unknown as Record<string, unknown>);
    const patches = plan.own ? [{ id: t.id, patch: plan.own }, ...plan.patches] : plan.patches;
    return patches.length ? (patches as never) : null;
  },
});

const bar = defineElement({
  type: 'timelinebar',
  label: { one: 'Timeline bar', many: 'Timeline bars' },
  icon: Diamond,
  // Side handles change the dates; the height is the timeline's.
  resize: 'width-only',
  rotatable: false,
  minSize: { w: 8, h: BAR_H },
  textField: 'title',
  defaults: (): Omit<NewElement<'timelinebar'>, 'x' | 'y'> => ({
    type: 'timelinebar',
    title: '',
    start: '2026-01-05',
    end: '2026-01-09',
    color: BAR_COLORS[0],
    w: 120,
    h: BAR_H,
  }),
  Component: BarView,
  toPlainText: (b) => richTextToPlain(b.title),
  // A milestone's name, and a short bar's title, are drawn to the right of it.
  visualOutset: (b) => (b.milestone || b.w < NARROW_W ? { right: OUTSIDE_LABEL_W } : {}),
  sharedStyle: (b) => ({ fill: b.color }),
  applySharedStyle: (_b, { fill }) => (fill && fill !== 'transparent' ? { color: fill } : null),
});

export default [timeline, bar] as unknown as ElementDefinition[];
