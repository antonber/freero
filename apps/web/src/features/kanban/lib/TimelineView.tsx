// A timeline of the kanban's cards (step 3b): a bar per card from its start to its end date (the
// card's start and due dates unless the tab picks date fields of its own), on the timeline
// element's scale and axis (@freero/shared `timelineLayout`: days, weeks, months or quarters), in
// swimlanes by a field when the tab says, the cards without dates listed aside. Dates are the
// truth: dragging a bar moves both dates, dragging an end changes that one, a card dragged from the
// aside onto a row gets dates there — each one card.setValues, one undo step, live for everyone.
// Windowed both ways: the rows in view, the axis labels in view.
//
// Keyboard: ↑ / ↓ walk the bars, Home / End jump; Alt + ← / → moves a bar a day, Alt + Shift + ← / →
// moves its end; Enter opens its dates. On phones (focus mode) a tap opens them.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  barSpanOf,
  collectionSchema,
  dateFields,
  editBar,
  groupKeyOf,
  groupKeys,
  groupTitle,
  projectionGroupValue,
  richTextToPlain,
  timelineLayout as T,
  timelineRange,
  type BarEdit,
  type CardElement,
  type DaySpan,
  type FieldDef,
  type KanbanElement,
  type TimelineScale,
} from '@freero/shared';
import type { Editor } from '@engine';
import { useKanbanPeople } from './people';
import { accentOf, today, writeBar } from './projection';
import { DatesPopover, WindowedList, attr, dayShort, dayWords } from './projectionParts';

import { t as tr } from '../messages';
export interface TimelineBodyProps {
  editor: Editor;
  k: KanbanElement;
  /** The cards (filtered, and ordered when the tab sorts them; else by start). */
  rows: readonly CardElement[];
  sorted: boolean;
  startRef: string;
  endRef: string;
  scale: TimelineScale;
  lanes: FieldDef | null;
  canEdit: boolean;
  interactive: boolean;
  label: string;
  /** The part of the scroll viewport on screen, px from its top (the canvas); default all of it. */
  clip?: { top: number; bottom: number } | null;
  height?: number;
  compact?: boolean;
}

type Entry = { kind: 'lane'; key: string; title: string; count: number; color?: string } | { kind: 'card'; card: CardElement; span: DaySpan };

const ROW_H = 36;
const HEAD_H = 44;
const OVERSCAN = 6;
const DRAG_PX = 4;
const UNDATED_ROW_H = 30;

interface BarDrag {
  id: string;
  edit: BarEdit;
  x: number;
  span: DaySpan;
  /** Screen px per day of the track (the canvas zoom included). */
  pxPerDay: number;
  moved: boolean;
  days: number;
}

interface AsideDrag {
  id: string;
  x: number;
  y: number;
  moved: boolean;
  /** The day the pointer is over on the track, or null. */
  day: number | null;
}

export function TimelineBody(p: TimelineBodyProps) {
  const { editor, k, rows, startRef, endRef, scale, lanes, canEdit, interactive } = p;
  const schema = useMemo(() => collectionSchema(k), [k]);
  const people = useKanbanPeople(editor);
  const names = dateFields(schema);
  const startName = names.find((f) => f.id === startRef)?.name ?? tr('startDate');
  const endName = names.find((f) => f.id === endRef)?.name ?? tr('dueDate');
  const now = today();
  const labelW = p.compact ? 128 : 220;
  const ppd = T.PX_PER_DAY[scale];

  const { entries, undated, range } = useMemo(() => {
    const dated: Array<{ card: CardElement; span: DaySpan }> = [];
    const undated: CardElement[] = [];
    for (const card of rows) {
      const span = barSpanOf(k, card, startRef, endRef, schema);
      if (span) dated.push({ card, span });
      else undated.push(card);
    }
    if (!p.sorted) dated.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
    const range = timelineRange(
      dated.map((d) => d.span),
      now,
    );
    const entries: Entry[] = [];
    if (!lanes) for (const d of dated) entries.push({ kind: 'card', ...d });
    else {
      const personName = (id: string) => people.find((x) => x.id === id)?.name;
      const byKey = new Map<string, typeof dated>();
      for (const d of dated) {
        const key = groupKeyOf(lanes, projectionGroupValue(k, d.card, lanes));
        byKey.set(key, [...(byKey.get(key) ?? []), d]);
      }
      for (const key of groupKeys(lanes, byKey.keys())) {
        const list = byKey.get(key);
        if (!list?.length) continue;
        const color = lanes.type === 'select' ? lanes.options?.find((o) => o.id === key)?.color : undefined;
        entries.push({ kind: 'lane', key, title: groupTitle(lanes, key, personName), count: list.length, ...(color ? { color } : {}) });
        for (const d of list) entries.push({ kind: 'card', ...d });
      }
    }
    return { entries, undated, range };
  }, [rows, k, startRef, endRef, schema, p.sorted, lanes, people, now]);

  const days = range.end - range.start + 1;
  const trackW = days * ppd;
  const scroll = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, w: 0, h: 0 });
  const [activeId, setActiveId] = useState<string | null>(null);
  const wantFocus = useRef(false);
  const [drag, setDrag] = useState<BarDrag | null>(null);
  const dragRef = useRef<BarDrag | null>(null);
  const [aside, setAside] = useState<AsideDrag | null>(null);
  const asideRef = useRef<AsideDrag | null>(null);
  const [picker, setPicker] = useState<{ id: string; el: HTMLElement } | null>(null);
  const hintId = useId();
  const scrolledToToday = useRef(false);

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const measure = () => setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Opens on today (a little before it), once.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || scrolledToToday.current) return;
    scrolledToToday.current = true;
    el.scrollLeft = Math.max(0, (now - range.start - 7) * ppd);
    setView((v) => ({ ...v, left: el.scrollLeft }));
  }, [now, range.start, ppd]);

  const cardRows = useMemo(() => entries.flatMap((e, i) => (e.kind === 'card' ? [i] : [])), [entries]);
  const indexOf = useMemo(() => new Map(entries.flatMap((e, i) => (e.kind === 'card' ? [[e.card.id, i] as const] : []))), [entries]);
  const active = activeId !== null && indexOf.has(activeId) ? activeId : entries[cardRows[0]]?.kind === 'card' ? (entries[cardRows[0]] as { card: CardElement }).card.id : null;

  const viewH = view.h || p.height || 480;
  const clipTop = p.clip ? Math.max(0, p.clip.top) : 0;
  const clipBottom = p.clip ? Math.min(viewH, p.clip.bottom) : viewH;
  const first = Math.max(0, Math.floor((view.top + clipTop - HEAD_H) / ROW_H) - OVERSCAN);
  const last = Math.min(entries.length - 1, Math.ceil((view.top + clipBottom - HEAD_H) / ROW_H) + OVERSCAN);
  const viewW = view.w || 900;
  const dayFrom = range.start + Math.max(0, Math.floor((view.left - labelW) / ppd) - 2);
  const dayTo = range.start + Math.ceil((view.left + viewW) / ppd) + 2;
  const ticks = useMemo(() => T.axisTicks(scale, range.start, range.end), [scale, range.start, range.end]);
  const inView = (t: { from: number; to: number }) => t.to > dayFrom && t.from <= dayTo;
  const x = (day: number) => (day - range.start) * ppd;

  /** Scrolls row `i` into view. */
  const reveal = (i: number) => {
    const el = scroll.current;
    if (!el) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + viewH - HEAD_H) el.scrollTop = top + ROW_H - (viewH - HEAD_H);
    setView((v) => ({ ...v, top: el.scrollTop }));
  };
  const focusBar = (id: string) => {
    setActiveId(id);
    const i = indexOf.get(id);
    if (i !== undefined) reveal(i);
    wantFocus.current = true;
  };
  useEffect(() => {
    if (!wantFocus.current || !active) return;
    const el = scroll.current?.querySelector<HTMLElement>(`[data-bar="${attr(active)}"]`);
    if (el) {
      wantFocus.current = false;
      el.focus({ preventScroll: true });
      // Keep the bar's start in view sideways.
      const sc = scroll.current!;
      const e = entries[indexOf.get(active) ?? -1];
      if (e?.kind === 'card') {
        const left = labelW + x(e.span.start);
        if (left - labelW < sc.scrollLeft) sc.scrollLeft = Math.max(0, left - labelW - 24);
        else if (left > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = left - labelW - 24;
      }
    }
  });

  const write = (card: CardElement, span: DaySpan) => {
    if (!canEdit || card.locked) return;
    writeBar(editor, card, startRef, endRef, span);
  };

  const onBarKey = (e: ReactKeyboardEvent<HTMLElement>, card: CardElement, span: DaySpan) => {
    const i = cardRows.indexOf(indexOf.get(card.id) ?? -1);
    const arrows: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.altKey && arrows[e.key] !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      write(card, editBar(span, e.shiftKey ? 'end' : 'move', arrows[e.key]));
      focusBar(card.id);
      return;
    }
    let to: number | null = null;
    if (e.key === 'ArrowDown') to = i + 1;
    else if (e.key === 'ArrowUp') to = i - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = cardRows.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (canEdit && !card.locked) setPicker({ id: card.id, el: e.currentTarget });
      return;
    } else if (e.key === 'Escape') {
      if (!e.currentTarget.closest('[role="dialog"]')) e.currentTarget.blur();
      return;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.stopPropagation();
      return;
    }
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    const row = cardRows[Math.max(0, Math.min(cardRows.length - 1, to))];
    const next = entries[row];
    if (next?.kind === 'card') focusBar(next.card.id);
  };

  const onBarPointerDown = (e: ReactPointerEvent<HTMLElement>, card: CardElement, span: DaySpan) => {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
    setActiveId(card.id);
    if (!canEdit || card.locked || e.pointerType === 'touch') return;
    const track = e.currentTarget.closest<HTMLElement>('[data-track]');
    const w = track?.getBoundingClientRect().width ?? 0;
    const edge = (e.target as HTMLElement).closest<HTMLElement>('[data-edge]')?.dataset.edge;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: card.id, edit: edge === 'start' ? 'start' : edge === 'end' ? 'end' : 'move', x: e.clientX, span, pxPerDay: w > 0 ? w / days : ppd, moved: false, days: 0 };
  };
  const onBarPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < DRAG_PX) return;
    const n = Math.round((e.clientX - d.x) / d.pxPerDay);
    if (!d.moved || n !== d.days) {
      dragRef.current = { ...d, moved: true, days: n };
      setDrag(dragRef.current);
    }
  };
  const onBarPointerUp = (e: ReactPointerEvent<HTMLElement>, card: CardElement) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.moved && d.days !== 0) write(card, editBar(d.span, d.edit, d.days));
  };

  // A card without dates dragged from the aside onto the timeline: it starts on the day it is dropped on.
  const dayUnder = (cx: number, cy: number): number | null => {
    const track = document.elementFromPoint?.(cx, cy)?.closest<HTMLElement>('[data-track]');
    if (!track || !scroll.current?.contains(track)) return null;
    const r = track.getBoundingClientRect();
    return r.width > 0 ? range.start + Math.floor(((cx - r.left) / r.width) * days) : null;
  };
  const onAsideDown = (e: ReactPointerEvent<HTMLElement>, card: CardElement) => {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
    if (!canEdit || card.locked || e.pointerType === 'touch') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    asideRef.current = { id: card.id, x: e.clientX, y: e.clientY, moved: false, day: null };
  };
  const onAsideMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = asideRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
    const day = dayUnder(e.clientX, e.clientY);
    if (!d.moved || day !== d.day) {
      asideRef.current = { ...d, moved: true, day };
      setAside(asideRef.current);
    }
  };
  const onAsideUp = (e: ReactPointerEvent<HTMLElement>, card: CardElement) => {
    const d = asideRef.current;
    asideRef.current = null;
    setAside(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.moved && d.day !== null) write(card, { start: d.day, end: d.day + (startRef === endRef ? 0 : T.DEFAULT_DAYS[scale] - 1) });
  };

  const drawn: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const e = entries[i];
    if (!e) continue;
    if (e.kind === 'lane') {
      drawn.push(
        <div key={`l:${e.key}`} role="row" className="fr-kanban-tl__row is-lane" style={{ top: i * ROW_H, height: ROW_H, width: labelW + trackW }}>
          <div role="rowheader" className="fr-kanban-tl__lane" style={{ width: labelW, ['--opt' as string]: e.color ?? 'var(--fr-ink-3)' }}>
            <span className="fr-kanban-grid__dot" aria-hidden />
            <span className="fr-kanban-tl__lane-title">{e.title}</span>
            <span className="fr-kanban-grid__count">
              {e.count}
              <span className="fr-sr-only"> {e.count === 1 ? 'card' : 'cards'}</span>
            </span>
          </div>
        </div>,
      );
      continue;
    }
    const { card } = e;
    const live = drag && drag.id === card.id && drag.moved ? editBar(drag.span, drag.edit, drag.days) : e.span;
    const title = richTextToPlain(card.title) || 'Untitled';
    const when = live.start === live.end ? dayWords(live.start) : `${dayWords(live.start)} to ${dayWords(live.end)}`;
    const editable = canEdit && !card.locked;
    drawn.push(
      <div key={card.id} role="row" className="fr-kanban-tl__row" style={{ top: i * ROW_H, height: ROW_H, width: labelW + trackW }}>
        <div role="rowheader" className="fr-kanban-tl__label" style={{ width: labelW }} title={title}>
          {title}
        </div>
        <div role="gridcell" className="fr-kanban-tl__track" data-track="" style={{ left: labelW, width: trackW }}>
          <div
            role="button"
            data-bar={card.id}
            tabIndex={interactive && active === card.id ? 0 : -1}
            aria-label={`${title}: ${when}`}
            aria-describedby={editable ? hintId : undefined}
            className={`fr-kanban-tl__bar${drag?.id === card.id && drag.moved ? ' is-dragging' : ''}${card.locked ? ' is-locked' : ''}`}
            style={{ left: x(live.start), width: Math.max(ppd, (live.end - live.start + 1) * ppd), ['--opt' as string]: accentOf(k, card, schema) }}
            onPointerDown={(ev) => onBarPointerDown(ev, card, e.span)}
            onPointerMove={onBarPointerMove}
            onPointerUp={(ev) => onBarPointerUp(ev, card)}
            onPointerCancel={() => {
              dragRef.current = null;
              setDrag(null);
            }}
            onKeyDown={(ev) => onBarKey(ev, card, e.span)}
            onClick={(ev) => {
              if (interactive && (ev.nativeEvent as PointerEvent).pointerType === 'touch' && editable) setPicker({ id: card.id, el: ev.currentTarget });
            }}
            onDoubleClick={(ev) => interactive && editable && setPicker({ id: card.id, el: ev.currentTarget })}
          >
            {editable && interactive && !p.compact && <span className="fr-kanban-tl__edge is-start" data-edge="start" aria-hidden />}
            {/* A short bar says its title beside it. */}
            <span className={`fr-kanban-tl__bar-title${(live.end - live.start + 1) * ppd > 72 ? '' : ' is-outside'}`} aria-hidden>
              {title}
            </span>
            {editable && interactive && !p.compact && <span className="fr-kanban-tl__edge is-end" data-edge="end" aria-hidden />}
          </div>
          {drag?.id === card.id && drag.moved && <span className="fr-kanban-tl__tip" style={{ left: x(live.start) }}>{live.start === live.end ? dayShort(live.start) : `${dayShort(live.start)} – ${dayShort(live.end)}`}</span>}
        </div>
      </div>,
    );
  }

  const pickerCard = picker ? rows.find((c) => c.id === picker.id) : undefined;
  const pickerSpan = pickerCard ? barSpanOf(k, pickerCard, startRef, endRef, schema) : null;
  const one = startRef === endRef;

  return (
    <div className={`fr-kanban-tl${p.compact ? ' is-compact' : ''}${interactive ? ' is-interactive' : ''}`} role="group" aria-label={p.label} {...(interactive ? { 'data-fr-interactive': '', 'data-fr-keyboard-trap': '' } : {})}>
      <span id={hintId} hidden>{tr('altAndTheLeftOr')}</span>
      <div
        ref={scroll}
        role="grid"
        aria-label={tr('labelStartnameToEndname', { label: p.label, startName, endName })}
        aria-rowcount={entries.length + 1}
        className="fr-kanban-tl__scroll"
        {...(interactive ? { 'data-fr-scrollable': '' } : {})}
        onScroll={(e) => {
          const el = e.currentTarget;
          setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft }));
        }}
      >
        <div role="row" className="fr-kanban-tl__head" style={{ width: labelW + trackW, height: HEAD_H }}>
          <div role="columnheader" className="fr-kanban-tl__corner" style={{ width: labelW }}>
            {lanes ? tr('byName', { name: lanes.name }) : tr('card')}
          </div>
          <div className="fr-kanban-tl__axis" style={{ left: labelW, width: trackW }} aria-hidden>
            {ticks.top.filter(inView).map((t) => (
              <span key={`t${t.from}`} className="fr-kanban-tl__tick is-top" style={{ left: x(t.from), width: (t.to - t.from) * ppd }}>
                {t.label}
              </span>
            ))}
            {ticks.units.filter(inView).map((t) => (
              <span key={`u${t.from}`} className="fr-kanban-tl__tick" style={{ left: x(t.from), width: (t.to - t.from) * ppd }}>
                {(t.to - t.from) * ppd >= 22 ? t.label : ''}
              </span>
            ))}
          </div>
        </div>
        <div className="fr-kanban-tl__body" style={{ width: labelW + trackW, height: Math.max(entries.length * ROW_H, ROW_H) }}>
          {now >= range.start && now <= range.end && <span className="fr-kanban-tl__today" style={{ left: labelW + x(now) + ppd / 2 }} aria-hidden />}
          {aside?.moved && aside.day !== null && <span className="fr-kanban-tl__drop" style={{ left: labelW + x(aside.day), width: (one ? 1 : T.DEFAULT_DAYS[scale]) * ppd }} aria-hidden />}
          {drawn}
          {!entries.length && <div className="fr-kanban-grid__empty">{rows.length ? tr('noCardHasAStartname', { startName: startName.toLowerCase(), endName: endName.toLowerCase() }) : tr('noCardsToShow')}</div>}
        </div>
      </div>
      <section className="fr-kanban-tl__undated" aria-label={tr('cardsWithoutDates')}>
        <h4>{tr('noDates')}{' '}<span className="fr-kanban-grid__count">{undated.length}</span>
        </h4>
        {undated.length ? (
          <WindowedList
            count={undated.length}
            rowH={UNDATED_ROW_H}
            label={tr('cardsWithoutDates')}
            render={(i) => {
              const card = undated[i];
              const title = richTextToPlain(card.title) || 'Untitled';
              const editable = canEdit && !card.locked;
              return (
                <button
                  type="button"
                  className={`fr-kanban-cal__card${aside?.id === card.id && aside.moved ? ' is-dragging' : ''}`}
                  style={{ ['--opt' as string]: accentOf(k, card, schema) }}
                  tabIndex={interactive ? 0 : -1}
                  aria-label={tr('titleNoDates', { title })}
                  aria-describedby={editable ? hintId : undefined}
                  onPointerDown={(e) => onAsideDown(e, card)}
                  onPointerMove={onAsideMove}
                  onPointerUp={(e) => onAsideUp(e, card)}
                  onPointerCancel={() => {
                    asideRef.current = null;
                    setAside(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if ((e.key === 'Enter' || e.key === ' ') && editable) {
                      e.preventDefault();
                      setPicker({ id: card.id, el: e.currentTarget });
                    }
                  }}
                  onClick={(e) => interactive && editable && (e.nativeEvent as PointerEvent).pointerType === 'touch' && setPicker({ id: card.id, el: e.currentTarget })}
                  onDoubleClick={(e) => interactive && editable && setPicker({ id: card.id, el: e.currentTarget })}
                >
                  <span className="fr-kanban-cal__dot" aria-hidden />
                  <span className="fr-kanban-cal__card-title">{title}</span>
                </button>
              );
            }}
          />
        ) : (
          <p className="fr-kanban-cal__none">{tr('everyCardHasDates')}</p>
        )}
      </section>
      {picker && pickerCard && (
        <DatesPopover
          anchor={picker.el}
          title={`${richTextToPlain(pickerCard.title) || 'Untitled'}: ${one ? startName : `${startName} – ${endName}`}`}
          start={pickerSpan ? T.isoOf(pickerSpan.start) : ''}
          end={one ? undefined : pickerSpan ? T.isoOf(pickerSpan.end) : ''}
          onSave={(a, b) => {
            if (!canEdit || pickerCard.locked) return;
            if (!a && !b) editor.runCommand('card.setValues', { id: pickerCard.id, values: one ? { [startRef]: null } : { [startRef]: null, [endRef]: null } });
            else {
              const s = T.dayOf(a ?? b!);
              const en = T.dayOf(b ?? a!);
              write(pickerCard, { start: Math.min(s, en), end: Math.max(s, en) });
              focusBar(pickerCard.id);
            }
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
