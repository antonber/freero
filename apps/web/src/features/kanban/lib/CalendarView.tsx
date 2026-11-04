// A calendar of the kanban's cards (step 3b): a month (or a week) of days, each card on the day its
// date field says (the due date unless the tab picks the start date or a date field of its own),
// and the cards without one aside. Dates are the truth: dragging a card to a day, Alt + arrow keys
// on it, or the dates popover (Enter) writes its date through card.setValues — one undo step, live
// for everyone — and the card shows where its date now is. Moving the month is the viewer's own
// business (component state). Windowed: a day shows the cards that fit and "+N more"; the cards
// without a date are a list that draws what is in view.
//
// Keyboard: the days are a grid (`role="grid"`): arrows walk days, Page Up / Down months, Home / End
// the week, Enter goes into the day's cards (↑ / ↓ between them, Escape back to the day). On a
// card: Alt + ← / → moves it a day, Alt + ↑ / ↓ a week, Enter opens its dates. On phones (focus
// mode) the week reads as an agenda: its days one under another, a card's dates a tap away.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarDays, cardDate, collectionSchema, dateFields, monthStart, monthWeeks, richTextToPlain, timelineLayout as T, type CardElement, type KanbanElement } from '@freero/shared';
import type { Editor } from '@engine';
import { Popover } from '@ui';
import { accentOf, moveToDay, today } from './projection';
import { DatesPopover, WindowedList, attr, dayOfMonth, dayShort, dayWords, monthWords, sameMonth, weekdayNames } from './projectionParts';

import { t } from '../messages';
export type CalendarMode = 'month' | 'week';

export interface CalendarBodyProps {
  editor: Editor;
  k: KanbanElement;
  /** The cards to place (filtered and ordered as the tab says). */
  rows: readonly CardElement[];
  /** The date field they sit on. */
  dateRef: string;
  canEdit: boolean;
  /** Takes pointer, wheel and keys (on the canvas: while its kanban is selected). */
  interactive: boolean;
  label: string;
  /** Phones: the week as an agenda. */
  compact?: boolean;
  /** The box's height when it can't be measured (before layout; tests). */
  height?: number;
}

/** A card's line in a day (px), and the day number's line above them. */
const CHIP_H = 22;
const DAY_HEAD_H = 22;
const UNDATED_ROW_H = 30;
const DRAG_PX = 4;

interface Drag {
  id: string;
  x: number;
  y: number;
  moved: boolean;
  /** The day under the pointer (ISO), '' for "no date", null for nowhere. */
  over: string | null;
}

export function CalendarBody(p: CalendarBodyProps) {
  const { editor, k, rows, dateRef, canEdit, interactive } = p;
  const schema = useMemo(() => collectionSchema(k), [k]);
  const fieldName = dateFields(schema).find((f) => f.id === dateRef)?.name ?? t('dueDate');
  const now = today();
  const [mode, setMode] = useState<CalendarMode>(p.compact ? 'week' : 'month');
  const [anchor, setAnchor] = useState(now);
  const [active, setActive] = useState(now);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [picker, setPicker] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [more, setMore] = useState<{ day: number; el: HTMLElement } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [gridH, setGridH] = useState(0);
  // After a keyboard move, focus goes to the card (or day) where it now is.
  const focusNext = useRef<{ card?: string; day?: number } | null>(null);
  const hintId = useId();

  const placed = useMemo(() => calendarDays(k, rows, dateRef, schema), [k, rows, dateRef, schema]);
  const weeks = useMemo(() => (mode === 'month' ? monthWeeks(anchor) : [Array.from({ length: 7 }, (_, i) => T.mondayOf(anchor) + i)]), [mode, anchor]);
  const names = weekdayNames(weeks[0][0]);
  const byId = useMemo(() => new Map(rows.map((c) => [c.id, c])), [rows]);

  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('.fr-kanban-cal__weeks');
    if (!el) return;
    const measure = () => setGridH(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, p.compact]);

  useEffect(() => {
    const want = focusNext.current;
    if (!want || !root.current) return;
    const el = want.card ? root.current.querySelector<HTMLElement>(`[data-card="${attr(want.card)}"]`) : root.current.querySelector<HTMLElement>(`[data-day="${T.isoOf(want.day!)}"][role="gridcell"]`);
    if (el) {
      focusNext.current = null;
      el.focus({ preventScroll: false });
    }
  });

  // How many cards a day shows before "+N more": what fits in a week's row.
  const rowH = (gridH || (p.height ?? 480) - 80) / weeks.length;
  const perDay = mode === 'week' ? Infinity : Math.max(1, Math.floor((rowH - DAY_HEAD_H - 4) / CHIP_H) - 1);

  /** Shows day `day` (the month or week holding it) and makes it the active day. */
  const goTo = (day: number, focus: boolean) => {
    setActive(day);
    if (mode === 'month' ? !sameMonth(day, anchor) : T.mondayOf(day) !== T.mondayOf(anchor)) setAnchor(day);
    if (focus) focusNext.current = { day };
  };
  const step = (n: number) => {
    const day = mode === 'month' ? monthStart(anchor, n) : anchor + 7 * n;
    setAnchor(day);
    setActive(mode === 'month' ? day : active + 7 * n);
  };

  const move = (card: CardElement, iso: string | null) => {
    if (!canEdit) return false;
    return moveToDay(editor, k, card, dateRef, iso);
  };

  const onDayKey = (e: ReactKeyboardEvent<HTMLElement>, day: number) => {
    if (e.target !== e.currentTarget) return;
    const by: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let to: number | null = null;
    if (by[e.key] !== undefined) to = day + by[e.key];
    else if (e.key === 'Home') to = T.mondayOf(day);
    else if (e.key === 'End') to = T.mondayOf(day) + 6;
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const n = e.key === 'PageUp' ? -1 : 1;
      to = mode === 'month' ? Math.min(monthStart(day, n) + dayOfMonth(day) - 1, monthStart(day, n + 1) - 1) : day + 7 * n;
    } else if (e.key === 'Enter' || e.key === ' ') {
      const first = e.currentTarget.querySelector<HTMLElement>('[data-card]');
      if (first) first.focus();
      e.preventDefault();
      e.stopPropagation();
      return;
    } else if (e.key === 'Escape') {
      if (!e.currentTarget.closest('[role="dialog"]')) (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    goTo(to, true);
  };

  const onCardKey = (e: ReactKeyboardEvent<HTMLElement>, card: CardElement, day: number | null) => {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.altKey && delta[e.key] !== undefined && day !== null) {
      e.preventDefault();
      e.stopPropagation();
      const to = day + delta[e.key];
      if (move(card, T.isoOf(to))) {
        focusNext.current = { card: card.id };
        goTo(to, false);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (canEdit && !card.locked) setPicker({ id: card.id, el: e.currentTarget });
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const list = [...(e.currentTarget.closest('[data-cards]')?.querySelectorAll<HTMLElement>('[data-card]') ?? [])];
      const i = list.indexOf(e.currentTarget);
      list[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (day !== null) goTo(day, true);
      else (e.currentTarget as HTMLElement).blur();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab') e.stopPropagation();
  };

  // A drag of our own (mouse and pen; on touch the dates popover does it): the day under the pointer lights up, the drop writes the date.
  const onCardPointerDown = (e: ReactPointerEvent<HTMLElement>, card: CardElement) => {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
    if (!canEdit || card.locked || e.pointerType === 'touch') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: card.id, x: e.clientX, y: e.clientY, moved: false, over: null };
  };
  const onCardPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
    const hit = document.elementFromPoint?.(e.clientX, e.clientY)?.closest<HTMLElement>('[data-day]');
    const over = hit && root.current?.contains(hit) ? (hit.dataset.day ?? null) : null;
    if (!d.moved || over !== d.over) {
      dragRef.current = { ...d, moved: true, over };
      setDrag(dragRef.current);
    }
  };
  const onCardPointerUp = (e: ReactPointerEvent<HTMLElement>, card: CardElement) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.moved && d.over !== null) move(card, d.over || null);
  };
  const onCardPointerCancel = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const chip = (card: CardElement, day: number | null, inActive: boolean) => {
    const title = richTextToPlain(card.title) || 'Untitled';
    const when = day === null ? `no ${fieldName.toLowerCase()}` : `${fieldName}: ${dayWords(day)}`;
    return (
      <button
        key={card.id}
        type="button"
        data-card={card.id}
        tabIndex={inActive ? 0 : -1}
        className={`fr-kanban-cal__card${drag?.id === card.id && drag.moved ? ' is-dragging' : ''}${card.locked ? ' is-locked' : ''}`}
        style={{ ['--opt' as string]: accentOf(k, card, schema) }}
        aria-label={`${title}, ${when}`}
        aria-describedby={canEdit && !card.locked ? hintId : undefined}
        onPointerDown={(e) => onCardPointerDown(e, card)}
        onPointerMove={onCardPointerMove}
        onPointerUp={(e) => onCardPointerUp(e, card)}
        onPointerCancel={onCardPointerCancel}
        onKeyDown={(e) => onCardKey(e, card, day)}
        onClick={(e) => {
          if (!interactive) return;
          // A tap (touch) opens the dates; a click focuses the card (a double click opens them).
          if ((e.nativeEvent as PointerEvent).pointerType === 'touch' && canEdit && !card.locked) setPicker({ id: card.id, el: e.currentTarget });
        }}
        onDoubleClick={(e) => interactive && canEdit && !card.locked && setPicker({ id: card.id, el: e.currentTarget })}
      >
        <span className="fr-kanban-cal__dot" aria-hidden />
        <span className="fr-kanban-cal__card-title">{title}</span>
      </button>
    );
  };

  const dayCell = (day: number) => {
    const iso = T.isoOf(day);
    const cards = placed.days.get(iso) ?? [];
    const isActive = interactive && day === active;
    const shown = Number.isFinite(perDay) && cards.length > perDay ? cards.slice(0, perDay) : cards;
    const out = mode === 'month' && !sameMonth(day, anchor);
    return (
      <div
        key={day}
        role="gridcell"
        data-day={iso}
        tabIndex={isActive ? 0 : -1}
        aria-label={`${dayWords(day)}${day === now ? ', today' : ''}: ${cards.length ? `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}` : 'no cards'}`}
        aria-selected={isActive || undefined}
        className={`fr-kanban-cal__day${out ? ' is-out' : ''}${day === now ? ' is-today' : ''}${isActive ? ' is-active' : ''}${drag?.moved && drag.over === iso ? ' is-drop' : ''}`}
        onKeyDown={(e) => onDayKey(e, day)}
        onClick={(e) => {
          if (interactive && e.target === e.currentTarget) setActive(day);
        }}
      >
        <span className="fr-kanban-cal__num" aria-hidden>
          {p.compact ? dayWords(day) : dayOfMonth(day)}
        </span>
        {mode === 'week' && cards.length > 12 ? (
          <div data-cards="" className="fr-kanban-cal__cards">
            <WindowedList count={cards.length} rowH={CHIP_H + 2} label={dayWords(day)} render={(i) => chip(cards[i], day, isActive)} />
          </div>
        ) : (
          <div data-cards="" className="fr-kanban-cal__cards">
            {shown.map((c) => chip(c, day, isActive))}
          </div>
        )}
        {shown.length < cards.length && (
          <button
            type="button"
            className="fr-kanban-cal__more"
            tabIndex={isActive ? 0 : -1}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => interactive && setMore({ day, el: e.currentTarget })}
            onKeyDown={(e) => e.stopPropagation()}
          >
            +{cards.length - shown.length}{' '}{t('more')}</button>
        )}
      </div>
    );
  };

  const undated = placed.undated;
  const pickerCard = picker ? byId.get(picker.id) : undefined;
  const pickerDate = pickerCard ? (cardDate(k, pickerCard, dateRef, schema) ?? '') : '';
  const title = mode === 'month' ? monthWords(anchor) : `${dayShort(weeks[0][0])} – ${dayShort(weeks[0][6])}`;

  return (
    <div
      ref={root}
      className={`fr-kanban-cal${p.compact ? ' is-compact' : ''}${interactive ? ' is-interactive' : ''}`}
      role="group"
      aria-label={p.label}
      {...(interactive ? { 'data-fr-interactive': '', 'data-fr-keyboard-trap': '' } : {})}
    >
      <span id={hintId} hidden>{t('altAndTheArrowKeys')}</span>
      <div className="fr-kanban-cal__bar">
        <button type="button" className="fr-kanban-proj__btn" aria-label={mode === 'month' ? t('previousMonth') : t('previousWeek')} onPointerDown={(e) => e.stopPropagation()} onClick={() => step(-1)}>
          <ChevronLeft size={16} aria-hidden />
        </button>
        <strong className="fr-kanban-cal__title" aria-live="off">
          {title}
        </strong>
        <button type="button" className="fr-kanban-proj__btn" aria-label={mode === 'month' ? t('nextMonth') : t('nextWeek')} onPointerDown={(e) => e.stopPropagation()} onClick={() => step(1)}>
          <ChevronRight size={16} aria-hidden />
        </button>
        <button type="button" className="fr-kanban-proj__btn is-text" onPointerDown={(e) => e.stopPropagation()} onClick={() => goTo(now, false)}>{t('today')}</button>
        <span className="fr-kanban-proj__seg" role="radiogroup" aria-label={t('show')}>
          {(['month', 'week'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={`fr-kanban-proj__btn is-text${mode === m ? ' is-on' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => setMode(m)}>
              {m === 'month' ? t('month') : t('week')}
            </button>
          ))}
        </span>
        <span className="fr-kanban-cal__field">{t('byFieldname', { fieldName })}</span>
      </div>
      <div className="fr-kanban-cal__main">
        <div role="grid" aria-label={t('titleCardsByFieldname', { title, fieldName })} className={`fr-kanban-cal__grid is-${mode}`} data-fr-scrollable={interactive ? '' : undefined}>
          {!p.compact && (
            <div role="row" className="fr-kanban-cal__weekdays">
              {names.map((n) => (
                <span key={n} role="columnheader" className="fr-kanban-cal__weekday">
                  {n}
                </span>
              ))}
            </div>
          )}
          <div className="fr-kanban-cal__weeks" style={{ ['--weeks' as string]: weeks.length }}>
            {weeks.map((w) => (
              <div key={w[0]} role="row" className="fr-kanban-cal__week">
                {w.map(dayCell)}
              </div>
            ))}
          </div>
        </div>
        <section className="fr-kanban-cal__undated" aria-label={t('cardsWithNoFieldname', { fieldName: fieldName.toLowerCase() })} data-day="">
          <h4 className={drag?.moved && drag.over === '' ? 'is-drop' : undefined}>{t('noFieldname', { fieldName: fieldName.toLowerCase() })}{' '}<span className="fr-kanban-grid__count">{undated.length}</span>
          </h4>
          {undated.length ? (
            <div data-cards="" className="fr-kanban-cal__undated-list">
              <WindowedList count={undated.length} rowH={UNDATED_ROW_H} label={t('noFieldname', { fieldName: fieldName.toLowerCase() })} render={(i) => chip(undated[i], null, interactive)} />
            </div>
          ) : (
            <p className="fr-kanban-cal__none">{t('everyCardHasAFieldname', { fieldName: fieldName.toLowerCase() })}</p>
          )}
        </section>
      </div>
      {more && (
        <MorePopover
          anchor={more.el}
          title={dayWords(more.day)}
          cards={placed.days.get(T.isoOf(more.day)) ?? []}
          render={(c) => chip(c, more.day, true)}
          onClose={() => setMore(null)}
        />
      )}
      {picker && pickerCard && (
        <DatesPopover
          anchor={picker.el}
          title={`${richTextToPlain(pickerCard.title) || 'Untitled'}: ${fieldName}`}
          start={pickerDate}
          onSave={(iso) => {
            if (move(pickerCard, iso) && iso) {
              focusNext.current = { card: pickerCard.id };
              goTo(T.dayOf(iso), false);
            }
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** A day's cards that didn't fit, in a popover (windowed: a day may hold thousands). */
function MorePopover({ anchor, title, cards, render, onClose }: { anchor: HTMLElement; title: string; cards: readonly CardElement[]; render: (c: CardElement) => ReactNode; onClose: () => void }) {
  return (
    <Popover open anchor={anchor} onClose={onClose} side="bottom" align="start" width={260} aria-label={title}>
      <div className="fr-kanban-cal__more-pop" data-cards="">
        <strong>{title}</strong>
        <WindowedList count={cards.length} rowH={CHIP_H + 4} label={title} maxHeight={320} render={(i) => render(cards[i])} />
      </div>
    </Popover>
  );
}
