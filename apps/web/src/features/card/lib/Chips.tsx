// The fields a card's container asks it to show (ElementRenderProps.presentation: a kanban's board
// view), as the card's footer: values as chips in the view's order, people at the end. Every chip
// carries its value as text (and the field's name as its tooltip): colour is never the only signal.
import type { ReactNode } from 'react';
import { CalendarDays, Check } from 'lucide-react';
import type { CardElement, FieldChip } from '@freero/shared';
import { formatDue, isOverdue } from './actions';
import { STATUSES } from './constants';

export function Chips(props: {
  chips: FieldChip[];
  card: CardElement;
  now: Date;
  renderPerson: (userId: string, key: string) => ReactNode;
  renderTags: (ids: string[], key: string) => ReactNode;
}) {
  const { chips, card, now } = props;
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
            <span key={`${key}:${o.id}`} className="fr-card__chip" style={{ ['--chip' as string]: o.color }} title={c.name}>
              {o.label}
            </span>,
          );
        break;
      case 'date': {
        const overdue = c.field === '$due' && isOverdue(c.date, card.status, now);
        lead.push(
          <span key={key} className={`fr-card__due${overdue ? ' is-overdue' : ''}`} title={overdue ? `${c.name}: overdue` : c.name}>
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
            {c.name}
          </span>,
        );
        break;
      case 'text':
        (c.field === '$estimate' ? trail : lead).push(
          <span key={key} className={c.field === '$estimate' ? 'fr-card__estimate' : 'fr-card__chip fr-card__chip--plain'} title={c.name}>
            {c.text}
          </span>,
        );
        break;
    }
  }
  return (
    <>
      {lead}
      <span className="fr-card__spacer" />
      {trail}
    </>
  );
}
