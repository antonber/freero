import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CircleDashed, NotebookText, UserPlus } from 'lucide-react';
import type { CardElement } from '@freero/shared';
import { defineFormat, plainToRichText, richTextToPlain, usePeers, type Editor } from '@engine';
import { Avatar, Button, ColorSwatches, IconButton, Menu, Popover, TextArea } from '@ui';
import { ACCENTS, ACCENT_NAMES, STATUSES, TOOL_ID, type CardStatus } from './lib/constants';
import { formatDue, localISODate } from './lib/actions';
import { onlinePeople, usePerson } from './lib/people';

type Props = { editor: Editor; cards: CardElement[] };

function patchAll(editor: Editor, cards: CardElement[], patch: Partial<CardElement>) {
  editor.updateMany(cards.map((c) => ({ id: c.id, patch })));
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
      <button ref={ref} type="button" className="fr-card-fmt-btn" aria-label="Card color" title="Card color" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="fr-card-fmt-dot" style={{ background: color ?? 'conic-gradient(#5B3FF0, #1FA463, #F5A524, #E5484D, #5B3FF0)' }} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Card color">
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
          aria-label="Card color"
        />
      </Popover>
    </>
  );
}

function StatusControl({ editor, cards }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const status = same(cards, 'status');
  const label = cards.every((c) => c.status === status) ? (STATUSES.find((s) => s.value === status)?.label ?? 'No status') : 'Mixed';
  return (
    <>
      <button ref={ref} type="button" className="fr-card-fmt-btn" aria-label="Status" title="Status" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CircleDashed size={16} />
        {label}
      </button>
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
          { id: 'none', label: 'No status', checked: status === null, onSelect: () => patchAll(editor, cards, { status: null }) },
        ]}
      />
    </>
  );
}

function DueControl({ editor, cards }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const due = same(cards, 'dueDate') ?? null;
  return (
    <>
      <button ref={ref} type="button" className="fr-card-fmt-btn" aria-label="Due date" title="Due date" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={16} />
        {due ? formatDue(due, new Date(editor.host.serverNow())) : null}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Due date">
        <div className="fr-card-pop">
          <div className="fr-card-pop__label">Due date</div>
          <input
            type="date"
            aria-label="Due date"
            value={due ?? ''}
            onChange={(e) => patchAll(editor, cards, { dueDate: e.target.value || null })}
          />
          <div className="fr-card-pop__row">
            <Button size="sm" variant="secondary" onClick={() => patchAll(editor, cards, { dueDate: localISODate(new Date(editor.host.serverNow())) })}>
              Today
            </Button>
            <Button size="sm" variant="ghost" disabled={!due && cards.every((c) => !c.dueDate)} onClick={() => patchAll(editor, cards, { dueDate: null })}>
              Clear
            </Button>
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
  usePeers(); // re-render the list as people come and go
  const assignee = same(cards, 'assigneeId') ?? null;
  const people = onlinePeople(editor);
  const assign = (id: string | null) => {
    patchAll(editor, cards, { assigneeId: id });
    setOpen(false);
  };
  return (
    <>
      <button ref={ref} type="button" className="fr-card-fmt-btn" aria-label="Assignee" title="Assignee" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {assignee ? <AssigneeButtonFace id={assignee} /> : <UserPlus size={16} />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={260} aria-label="Assign to">
        <div className="fr-card-pop">
          <div className="fr-card-pop__label">Assign to</div>
          <ul className="fr-card-people" role="radiogroup" aria-label="Assignee">
            {people.map((p, i) => (
              <li key={p.id}>
                <button type="button" role="radio" aria-checked={assignee === p.id} onClick={() => assign(p.id)}>
                  <Avatar name={p.name} color={p.color} src={p.avatarUrl} size={24} />
                  <span className="fr-card-people__name">{p.name}</span>
                  {i === 0 && <span className="fr-card-people__hint">You</span>}
                </button>
              </li>
            ))}
            <li>
              <button type="button" role="radio" aria-checked={assignee === null} onClick={() => assign(null)}>
                <span className="fr-card-people__none">
                  <UserPlus size={13} />
                </span>
                <span className="fr-card-people__name">Unassigned</span>
              </button>
            </li>
          </ul>
          {people.length === 1 && <div className="fr-card-people__hint">Collaborators appear here while they're on the board.</div>}
        </div>
      </Popover>
    </>
  );
}

/** "Open details": edit the description. Typing in one sitting is one undo step. */
function DetailsControl({ editor, cards }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const card = cards[0];
  const [text, setText] = useState('');
  const gesture = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // The popover is invisible for its first frame (positioning), so autoFocus can't land.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => area.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [open]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const html = plainToRichText(value.replace(/\s+$/, ''));
    if (editor.getElement<CardElement>(card.id)?.description !== html) editor.update<CardElement>(card.id, { description: html });
  };
  const end = () => {
    flush(text);
    if (gesture.current) {
      gesture.current = false;
      editor.endGesture();
    }
  };
  const close = () => {
    end();
    setOpen(false);
  };
  // Never leave a gesture open if the toolbar unmounts (selection changed) mid-edit.
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => () => endRef.current(), []);

  return (
    <>
      <IconButton
        ref={ref}
        icon={NotebookText}
        label="Open details"
        size={32}
        active={open}
        disabled={cards.length !== 1}
        onClick={() => {
          if (open) return close();
          setText(richTextToPlain(card.description));
          setOpen(true);
        }}
      />
      <Popover open={open} onClose={close} anchor={ref.current} side="bottom" offset={10} width={380} aria-label="Card details" className="fr-card-details">
        <div className="fr-card-pop">
          <div className="fr-card-pop__label">Description</div>
          <TextArea
            ref={area}
            value={text}
            placeholder="Add details, links, acceptance criteria…"
            aria-label="Card description"
            onFocus={() => {
              if (!gesture.current) {
                gesture.current = true;
                editor.beginGesture();
              }
            }}
            onBlur={end}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => flush(v), 250);
            }}
          />
        </div>
      </Popover>
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
      </>
    );
  },
});
