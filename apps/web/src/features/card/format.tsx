import { useRef, useState } from 'react';
import { CalendarDays, CircleDashed, NotebookText, Repeat2, SquareStack, UserPlus } from 'lucide-react';
import type { CardElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { Avatar, Button, ColorSwatches, IconButton, Menu, Popover, ToolbarButton, formatShortcut } from '@ui';
import { ACCENTS, ACCENT_NAMES, BACK_COLORS, BACK_COLOR_NAMES, DETAILS_PANEL, DETAILS_SHORTCUT, STATUSES, TOOL_ID, type CardStatus } from './lib/constants';
import { formatDue, localISODate } from './lib/actions';
import { useBoardPeople, usePerson } from './lib/people';

import { t } from './messages';
type Props = { editor: Editor; cards: CardElement[] };

function patchAll(editor: Editor, cards: CardElement[], patch: Partial<CardElement>) {
  editor.updateMany(cards.map((c) => ({ id: c.id, patch })));
}

/**
 * Dates from the toolbar, through `card.setDates` (cards keep one writer, and its rule: a start is
 * never after the due date). A due date picked before a card's start brings the start along to it;
 * a start picked after a card's due date isn't stored for that card. One undo step.
 */
function setDates(editor: Editor, cards: CardElement[], change: { startDate?: string | null; dueDate?: string | null }) {
  editor.transact(() => {
    for (const c of cards) {
      const start = editor.getElement<CardElement>(c.id)?.startDate;
      const args: Record<string, unknown> = { id: c.id, ...change };
      if (change.dueDate && change.startDate === undefined && start && start > change.dueDate) args.startDate = change.dueDate;
      editor.runCommand('card.setDates', args);
    }
  });
}

function same<K extends keyof CardElement>(cards: CardElement[], key: K): CardElement[K] | undefined {
  const v = cards[0][key];
  return cards.every((c) => c[key] === v) ? v : undefined;
}

function ColorControl({ editor, cards }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const color = same(cards, 'color');
  return (
    <>
      <ToolbarButton ref={ref} className="fr-card-fmt-btn" label={t('cardColor')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="fr-card-fmt-dot" style={{ background: color ?? 'conic-gradient(#5B3FF0, #1FA463, #F5A524, #E5484D, #5B3FF0)' }} />
      </ToolbarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label={t('cardColor')}>
        <ColorSwatches
          colors={ACCENTS}
          names={ACCENT_NAMES}
          value={color ?? null}
          columns={6}
          size={26}
          allowCustom
          onChange={(c) => {
            patchAll(editor, cards, { color: c });
            editor.setToolOptions(TOOL_ID, { color: c });
          }}
          aria-label={t('cardColor')}
        />
      </Popover>
    </>
  );
}

function StatusControl({ editor, cards }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const status = same(cards, 'status');
  const label = cards.every((c) => c.status === status) ? (STATUSES.find((s) => s.value === status)?.label ?? t('noStatus')) : 'Mixed';
  return (
    <>
      <ToolbarButton ref={ref} className="fr-card-fmt-btn" label={t('status')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CircleDashed size={16} />
        {label}
      </ToolbarButton>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        side="bottom"
        minWidth={160}
        items={[
          ...STATUSES.map((s) => ({
            id: s.value,
            label: s.label,
            checked: status === s.value,
            onSelect: () => patchAll(editor, cards, { status: s.value as CardStatus }),
          })),
          { divider: true as const },
          { id: 'none', label: t('noStatus'), checked: status === null, onSelect: () => patchAll(editor, cards, { status: null }) },
        ]}
      />
    </>
  );
}

function DueControl({ editor, cards }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const due = same(cards, 'dueDate') ?? null;
  const start = same(cards, 'startDate') ?? null;
  // The picker offers no start after the earliest due date of the cards (the rest are refused anyway).
  const latestStart = cards.reduce<string | null>((m, c) => (c.dueDate && (!m || c.dueDate < m) ? c.dueDate : m), null);
  return (
    <>
      <ToolbarButton ref={ref} className="fr-card-fmt-btn" label={t('dueDate')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={16} />
        {due ? formatDue(due, new Date(editor.host.serverNow())) : null}
      </ToolbarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label={t('dueDate')}>
        <div className="fr-card-pop">
          <div className="fr-card-pop__label">{t('dueDate')}</div>
          <input
            type="date"
            aria-label={t('dueDate')}
            value={due ?? ''}
            onChange={(e) => setDates(editor, cards, { dueDate: e.target.value || null })}
          />
          {/* A start date makes the card span days on a timeline. */}
          <div className="fr-card-pop__label">{t('startDate')}</div>
          <input
            type="date"
            aria-label={t('startDate')}
            value={start ?? ''}
            max={latestStart ?? undefined}
            onChange={(e) => setDates(editor, cards, { startDate: e.target.value || null })}
          />
          <div className="fr-card-pop__row">
            <Button size="sm" variant="secondary" onClick={() => setDates(editor, cards, { dueDate: localISODate(new Date(editor.host.serverNow())) })}>{t('today')}</Button>
            <Button size="sm" variant="ghost" disabled={!due && cards.every((c) => !c.dueDate)} onClick={() => setDates(editor, cards, { dueDate: null })}>{t('clear')}</Button>
          </div>
        </div>
      </Popover>
    </>
  );
}

function AssigneeButtonFace({ id }: { id: string }) {
  const p = usePerson(id);
  return p ? <Avatar name={p.name} color={p.color} src={p.avatarUrl} size={20} /> : <span className="fr-card__unknown">?</span>;
}

function AssigneeControl({ editor, cards }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const assignee = same(cards, 'assigneeId') ?? null;
  const people = useBoardPeople(editor, open);
  const assign = (id: string | null) => {
    patchAll(editor, cards, { assigneeId: id });
    setOpen(false);
  };
  return (
    <>
      <ToolbarButton ref={ref} className="fr-card-fmt-btn" label={t('assignee')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {assignee ? <AssigneeButtonFace id={assignee} /> : <UserPlus size={16} />}
      </ToolbarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={260} aria-label={t('assignTo')}>
        <div className="fr-card-pop">
          <div className="fr-card-pop__label">{t('assignTo')}</div>
          <ul className="fr-card-people" role="radiogroup" aria-label={t('assignee')}>
            {people.map((p, i) => (
              <li key={p.id}>
                <button type="button" role="radio" aria-checked={assignee === p.id} onClick={() => assign(p.id)}>
                  <Avatar name={p.name} color={p.color} src={p.avatarUrl} size={24} />
                  <span className="fr-card-people__name">{p.name}</span>
                  {i === 0 && <span className="fr-card-people__hint">{t('you')}</span>}
                </button>
              </li>
            ))}
            <li>
              <button type="button" role="radio" aria-checked={assignee === null} onClick={() => assign(null)}>
                <span className="fr-card-people__none">
                  <UserPlus size={13} />
                </span>
                <span className="fr-card-people__name">{t('unassigned')}</span>
              </button>
            </li>
          </ul>
          {people.length === 1 && <div className="fr-card-people__hint">{t('shareTheBoardToAssign')}</div>}
        </div>
      </Popover>
    </>
  );
}

/** "Open details": the card details dialog (panel.tsx), as a double-click on the description opens it. */
function DetailsControl({ editor, cards }: Props) {
  return (
    <IconButton
      icon={NotebookText}
      label={t('openDetails')}
      shortcut={formatShortcut(DETAILS_SHORTCUT)}
      size={32}
      disabled={cards.length !== 1}
      onClick={() => editor.openPanel(DETAILS_PANEL, { id: cards[0].id })}
    />
  );
}

/** Flip cards (#142): give cards a back, turn them for everyone, colour the back. */
function FlipControl({ editor, cards }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const twoSided = cards.every((c) => !!c.back);
  const flipped = cards.every((c) => !!c.flipped);
  const backColor = twoSided && cards.every((c) => c.back!.color === cards[0].back!.color) ? cards[0].back!.color : null;
  const toggleTwoSided = () =>
    editor.updateMany(
      cards.map((c) => ({
        id: c.id,
        patch: (twoSided ? { back: null, flipped: false } : { back: c.back ?? { title: '', color: BACK_COLORS[0] } }) as Partial<CardElement>,
      })),
    );
  return (
    <>
      <ToolbarButton className="fr-card-fmt-btn" label={twoSided ? t('makeOneSided') : t('twoSidedAddABack')} aria-pressed={twoSided} onClick={toggleTwoSided}>
        <SquareStack size={16} />{t('twoSided')}</ToolbarButton>
      {twoSided ? (
        <>
          <IconButton icon={Repeat2} label={flipped ? t('showTheFront') : t('flipToTheBack')} active={flipped} onClick={() => patchAll(editor, cards, { flipped: !flipped })} />
          <ToolbarButton ref={ref} className="fr-card-fmt-btn" label={t('backColor')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span className="fr-card-fmt-dot" style={{ background: backColor ?? 'conic-gradient(#FFF1B8, #D2F4E6, #D7ECFF, #FFD9EC, #FFF1B8)' }} />
          </ToolbarButton>
          <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label={t('backColor')}>
            <ColorSwatches
              colors={BACK_COLORS}
              names={BACK_COLOR_NAMES}
              value={backColor}
              columns={4}
              size={26}
              allowCustom
              onChange={(color) => editor.updateMany(cards.map((c) => ({ id: c.id, patch: { back: { title: c.back?.title ?? '', color } } as Partial<CardElement> })))}
              aria-label={t('backColor')}
            />
          </Popover>
        </>
      ) : null}
    </>
  );
}

export default defineFormat({
  id: 'card.format',
  order: 10,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'card'),
  Component: ({ editor, selection }) => {
    const cards = selection as CardElement[];
    return (
      <>
        <ColorControl editor={editor} cards={cards} />
        <StatusControl editor={editor} cards={cards} />
        <DueControl editor={editor} cards={cards} />
        <AssigneeControl editor={editor} cards={cards} />
        <DetailsControl editor={editor} cards={cards} />
        <FlipControl editor={editor} cards={cards} />
      </>
    );
  },
});
