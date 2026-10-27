import { memo, type KeyboardEvent } from 'react';
import { CalendarDays, Check } from 'lucide-react';
import type { CardElement, Tag } from '@freero/shared';
import {
  defineElement,
  ElementText,
  richTextToPlain,
  useCollection,
  useEditor,
  type ElementRenderProps,
  type NewElement,
} from '@engine';
import { Avatar } from '@ui';
import { CARD_MIN_W, CARD_W, DESC, PAD, TITLE, cardLayout } from './lib/layout';
import { DEFAULT_ACCENT, STATUSES } from './lib/constants';
import { formatDue, isOverdue } from './lib/actions';
import { usePerson } from './lib/people';
import './card.css';

/** Below this zoom the text is unreadable: draw placeholder bars instead. */
const LOD_ZOOM = 0.2;
const MAX_TAGS = 2;

function Assignee({ id }: { id: string }) {
  const person = usePerson(id);
  if (!person) return <span className="fr-card__unknown" title="Someone who no longer has access to this board">?</span>;
  return <Avatar name={person.name} color={person.color} src={person.avatarUrl} size={22} title={person.name} />;
}

function TagChips({ ids }: { ids: string[] }) {
  const tags = useCollection<Tag>('tags');
  const byId = new Map(tags);
  const known = ids.map((id) => byId.get(id)).filter((t): t is Tag => !!t);
  if (!known.length) return null;
  return (
    <>
      {known.slice(0, MAX_TAGS).map((t) => (
        <span key={t.id} className="fr-card__tag" style={{ ['--tag' as string]: t.color }} title={t.name}>
          {t.name}
        </span>
      ))}
      {known.length > MAX_TAGS && <span className="fr-card__more">+{known.length - MAX_TAGS}</span>}
    </>
  );
}

const CardView = memo(function CardView({ element, editing, zoom }: ElementRenderProps<CardElement>) {
  const editor = useEditor();
  const layout = cardLayout(element);
  const accent = element.color || DEFAULT_ACCENT;
  const status = STATUSES.find((s) => s.value === element.status);
  // Server clock: a skewed local clock must not flip "overdue" for one viewer.
  const now = new Date(editor.host.serverNow());
  const overdue = isOverdue(element.dueDate, element.status, now);

  // The title feels single-line: Enter commits (Shift+Enter still breaks the line).
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editing || e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    editor.stopEditing();
  };

  if (zoom < LOD_ZOOM && !editing) {
    return (
      <div className="fr-card is-lod" style={{ ['--accent' as string]: accent }}>
        <div className="fr-card__bars" aria-hidden>
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className={`fr-card${element.status === 'done' ? ' is-done' : ''}`} style={{ ['--accent' as string]: accent }} onKeyDownCapture={onKeyDownCapture}>
      <div className="fr-card__title" style={{ top: PAD.top, height: layout.titleLines * TITLE.line }}>
        <ElementText
          element={element}
          field="title"
          fontSize={TITLE.size}
          fontFamily="sans"
          align="left"
          vAlign="top"
          color="var(--fr-ink)"
          padding={0}
          style={{ fontWeight: TITLE.weight, lineHeight: `${TITLE.line}px` }}
          placeholder="Card title"
        />
      </div>
      {layout.descLines > 0 && (
        <div
          className="fr-card__desc"
          style={{
            top: PAD.top + layout.titleLines * TITLE.line + DESC.gap,
            height: layout.descLines * DESC.line,
            WebkitLineClamp: layout.descLines,
          }}
        >
          {layout.descText}
        </div>
      )}
      <div className="fr-card__footer">
        {status && (
          <span className={`fr-card__status is-${status.value}`}>
            {status.value === 'done' && <Check size={11} strokeWidth={3} />}
            {status.label}
          </span>
        )}
        {element.dueDate && (
          <span className={`fr-card__due${overdue ? ' is-overdue' : ''}`} title={overdue ? 'Overdue' : 'Due date'}>
            <CalendarDays size={12} strokeWidth={2.2} />
            {formatDue(element.dueDate, now)}
          </span>
        )}
        {!!element.tags?.length && <TagChips ids={element.tags} />}
        <span className="fr-card__spacer" />
        {element.assigneeId && <Assignee id={element.assigneeId} />}
      </div>
    </div>
  );
});

export default defineElement({
  type: 'card',
  resize: 'width-only',
  minSize: { w: CARD_MIN_W, h: 60 },
  textField: 'title',
  defaults: (): Omit<NewElement<'card'>, 'x' | 'y'> => ({
    type: 'card',
    w: CARD_W,
    h: cardLayout({ w: CARD_W, title: '', description: '' }).h,
    title: '',
    description: '',
    color: DEFAULT_ACCENT,
    status: 'todo',
    assigneeId: null,
    dueDate: null,
    tags: [],
  }),
  Component: CardView,
  toPlainText: (el) => [richTextToPlain(el.title), richTextToPlain(el.description)].filter(Boolean).join('\n'),
  // Height follows the content (title wrap, description preview) at the current width.
  normalize(el) {
    const { h } = cardLayout(el);
    return h !== el.h ? { h } : null;
  },
});
