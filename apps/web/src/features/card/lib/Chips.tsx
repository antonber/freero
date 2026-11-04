// The fields a card's container asks it to show (ElementRenderProps.presentation: a kanban's board
// view), as the card's footer: values as chips in the view's order, people at the end. Every chip
// carries its value as text (and the field's name as its tooltip): colour is never the only signal.
//
// The footer is one line, always (#95): a card's height never depends on which fields it shows,
// because `card.show` is personal (step 2b) and the board's geometry is shared. Chips that don't
// fit are never cut mid-word: the row wraps inside a one-line box, so a chip that doesn't fit
// whole drops out of sight, and a "+N" chip says how many did, with their values in its tooltip.
// A single chip wider than the whole row (a long label on a narrow card) ends in an ellipsis and
// keeps its full value in its tooltip.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Check } from 'lucide-react';
import type { CardElement, FieldChip } from '@freero/shared';
import { formatDue, isOverdue } from './actions';
import { STATUSES } from './constants';

import { t } from '../messages';
/** A chip as words: its tooltip when that already says the value ("Priority: High"), else "tooltip: text". */
const describe = (el: Element) => {
  const name = el.getAttribute('title')?.trim() ?? '';
  const text = el.textContent?.trim() ?? '';
  if (!name) return text;
  return name.includes(text) || text.startsWith('+') ? name : `${name}: ${text}`;
};

/** The chips laid out past the first line (out of sight), as the "+N" chip says them. */
function overflowOf(row: HTMLElement): { n: number; label: string } | null {
  const kids = [...row.children] as HTMLElement[];
  const top = kids[0]?.offsetTop ?? 0;
  const hidden = kids.filter((k) => k.offsetTop > top + 2);
  return hidden.length ? { n: hidden.length, label: hidden.map(describe).filter(Boolean).join(' · ') } : null;
}

export function Chips(props: {
  chips: FieldChip[];
  card: CardElement;
  now: Date;
  renderPerson: (userId: string, key: string) => ReactNode;
  renderTags: (ids: string[], key: string) => ReactNode;
}) {
  const { chips, card, now } = props;
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<{ n: number; label: string } | null>(null);
  // After every render (new chips, another width, the "+N" chip itself taking room), count what
  // wrapped out of sight. It settles: the count only grows while the row narrows.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const next = overflowOf(el);
    if (next?.n !== more?.n || next?.label !== more?.label) setMore(next);
  });
  // Text measured before the web font arrived wraps differently: count again once it has.
  useLayoutEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => {
      const el = row.current;
      if (live && el) setMore(overflowOf(el));
    });
    return () => {
      live = false;
    };
  }, []);

  const lead: ReactNode[] = [];
  const trail: ReactNode[] = [];
  for (const c of chips) {
    const key = c.field;
    switch (c.kind) {
      case 'options':
        if (c.field === '$status') {
          const s = STATUSES.find((x) => x.value === c.options[0]?.id);
          if (s)
            lead.push(
              <span key={key} className={`fr-card__status is-${s.value}`} title={c.name}>
                {s.value === 'done' && <Check size={11} strokeWidth={3} />}
                {s.label}
              </span>,
            );
          break;
        }
        for (const o of c.options)
          lead.push(
            <span key={`${key}:${o.id}`} className="fr-card__chip" style={{ ['--chip' as string]: o.color }} title={`${c.name}: ${o.label}`}>
              <span className="fr-card__chip-text">{o.label}</span>
            </span>,
          );
        break;
      case 'date': {
        const overdue = c.field === '$due' && isOverdue(c.date, card.status, now);
        lead.push(
          <span key={key} className={`fr-card__due${overdue ? ' is-overdue' : ''}`} title={overdue ? t('nameOverdue', { name: c.name }) : c.name}>
            <CalendarDays size={12} strokeWidth={2.2} />
            {formatDue(c.date, now)}
          </span>,
        );
        break;
      }
      case 'person':
        trail.push(props.renderPerson(c.userId, key));
        break;
      case 'tags':
        lead.push(props.renderTags(c.ids, key));
        break;
      case 'check':
        lead.push(
          <span key={key} className="fr-card__chip fr-card__chip--plain" title={c.name}>
            <Check size={11} strokeWidth={3} aria-hidden />
            <span className="fr-card__chip-text">{c.name}</span>
          </span>,
        );
        break;
      case 'text':
        if (c.field === '$estimate')
          trail.push(
            <span key={key} className="fr-card__estimate" title={c.name}>
              {c.text}
            </span>,
          );
        else
          lead.push(
            <span key={key} className="fr-card__chip fr-card__chip--plain" title={`${c.name}: ${c.text}`}>
              <span className="fr-card__chip-text">{c.text}</span>
            </span>,
          );
        break;
    }
  }
  return (
    <>
      <div ref={row} className="fr-card__chips">
        {lead}
      </div>
      {more && (
        <span className="fr-card__chip fr-card__chip--plain fr-card__chip--more" title={more.label} aria-label={t('nMoreLabel', { n: more.n, label: more.label })}>
          +{more.n}
        </span>
      )}
      {trail}
    </>
  );
}
