import { memo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarDays, Check, ListTodo as ListTodoIcon, Maximize2, Repeat2 } from 'lucide-react';
import type { CardElement, Tag } from '@freero/shared';
import {
  defineElement,
  ElementText,
  richTextToPlain,
  sanitizeRichText,
  useCanEdit,
  useCollection,
  useEditor,
  useIsExporting,
  type ElementRenderProps,
  type LowDetailPaint,
  type NewElement,
} from '@engine';
import { Avatar, formatShortcut } from '@ui';
import { CARD_MIN_W, CARD_W, DESC, FOOTER, PAD, TITLE, cardLayout, isBar } from './lib/layout';
import { BACK_COLORS, BACK_PART, DEFAULT_ACCENT, DETAILS_PANEL, DETAILS_SHORTCUT, STATUSES } from './lib/constants';
import { formatDue, isOverdue } from './lib/actions';
import { usePerson } from './lib/people';
import { Chips } from './lib/Chips';
import { useTruncated } from './lib/truncation';
import { t as tr } from './messages';
import './card.css';

/** Below this zoom the text is unreadable: draw placeholder bars instead. */
const LOD_ZOOM = 0.2;
const MAX_TAGS = 2;

function Assignee({ id }: { id: string }) {
  const person = usePerson(id);
  if (!person) return <span className="fr-card__unknown" title={tr('someoneWhoNoLongerHas')}>?</span>;
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
          <span className="fr-card__chip-text">{t.name}</span>
        </span>
      ))}
      {known.length > MAX_TAGS && (
        <span className="fr-card__more" title={known.slice(MAX_TAGS).map((t) => t.name).join(', ')}>
          +{known.length - MAX_TAGS}
        </span>
      )}
    </>
  );
}

/**
 * Opens the card's details (the description in full): a cut-off description's corner button and a
 * double-click on the description (`opensAt`). Never a drag, never a selection change.
 */
function ExpandButton({ id }: { id: string }) {
  const editor = useEditor();
  const label = tr('openDetails');
  return (
    <button
      type="button"
      className="fr-card__expand"
      data-fr-interactive
      aria-label={label}
      title={`${label} (${formatShortcut(DETAILS_SHORTCUT)})`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        editor.openPanel(DETAILS_PANEL, { id });
      }}
    >
      <Maximize2 size={12} strokeWidth={2.4} aria-hidden />
    </button>
  );
}

const CardView = memo(function CardView({ element, selected, editing, zoom, presentation }: ElementRenderProps<CardElement>) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const descRef = useRef<HTMLDivElement>(null);
  // In a kanban the board view decides: colour (by column, a field, or the card's own), density, fields.
  const compact = presentation?.density === 'compact';
  const desc = compact ? '' : richTextToPlain(element.description ?? '').trim();
  const accent = presentation?.accent || element.color || DEFAULT_ACCENT;
  const status = STATUSES.find((s) => s.value === element.status);
  // Server clock: a skewed local clock must not flip "overdue" for one viewer.
  const now = new Date(editor.host.serverNow());
  const overdue = isOverdue(element.dueDate, element.status, now);
  // The description is line-clamped (it ends in "…"); cut off, a button opens all of it.
  const cut = useTruncated(descRef, desc);

  // The title feels single-line: Enter commits (Shift+Enter still breaks the line).
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editing || e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    editor.stopEditing();
  };

  if (isBar(element)) {
    return (
      <div className={`fr-card fr-card--bar${element.status === 'done' ? ' is-done' : ''}${presentation?.muted ? ' is-muted' : ''}`} style={{ ['--accent' as string]: accent }} onKeyDownCapture={onKeyDownCapture}>
        <div className="fr-card__bar-title">
          {zoom >= LOD_ZOOM || editing ? (
            <ElementText
              element={element}
              field="title"
              fontSize={13}
              fontFamily="sans"
              align="left"
              vAlign="middle"
              color="var(--fr-ink)"
              padding={0}
              style={{ fontWeight: 600, whiteSpace: 'nowrap' }}
              placeholder={tr('cardTitle')}
            />
          ) : null}
        </div>
        {status?.value === 'done' && <Check className="fr-card__bar-done" size={12} strokeWidth={3} aria-label={tr('done')} />}
        {element.assigneeId && element.w >= 72 && zoom >= LOD_ZOOM && <Assignee id={element.assigneeId} />}
      </div>
    );
  }

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

  const front = (
    <div className={`fr-card${element.status === 'done' ? ' is-done' : ''}${presentation?.muted ? ' is-muted' : ''}${selected ? ' is-selected' : ''}`} style={{ ['--accent' as string]: accent }} onKeyDownCapture={onKeyDownCapture}>
      {/* Laid out by the browser, top to bottom, never from a measurement taken while rendering
          (#89): one taken before the web font arrived, or a height another client or the server
          measured, put a title line under the footer's status chip or cut it off. The footer
          keeps to the bottom; if the card is ever shorter than its text, the text is clipped. */}
      <div className="fr-card__body" style={{ top: PAD.top, right: PAD.right, bottom: PAD.bottom, left: PAD.left }}>
        <div className="fr-card__content" style={{ paddingBottom: FOOTER.gap }}>
          <div className="fr-card__title">
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
              placeholder={tr('cardTitle')}
            />
          </div>
          {desc && (
            <div className="fr-card__desc-wrap" style={{ marginTop: DESC.gap }}>
              <div ref={descRef} className={`fr-card__desc${cut ? ' is-cut' : ''}`} style={{ WebkitLineClamp: DESC.maxLines }}>
                {desc}
              </div>
              {cut && !exporting && !editing && <ExpandButton id={element.id} />}
            </div>
          )}
        </div>
        <div className="fr-card__footer" style={{ height: FOOTER.h }}>
          {presentation?.chips ? (
            <Chips
              chips={presentation.chips}
              card={element}
              now={now}
              renderPerson={(id, key) => <Assignee key={key} id={id} />}
              renderTags={(ids, key) => <TagChips key={key} ids={ids} />}
            />
          ) : (
            <>
              {status && (
                <span className={`fr-card__status is-${status.value}`}>
                  {status.value === 'done' && <Check size={11} strokeWidth={3} />}
                  {status.label}
                </span>
              )}
              {element.dueDate && (
                <span className={`fr-card__due${overdue ? ' is-overdue' : ''}`} title={overdue ? tr('overdue') : tr('dueDate')}>
                  <CalendarDays size={12} strokeWidth={2.2} />
                  {formatDue(element.dueDate, now)}
                </span>
              )}
              {!!element.tags?.length && <TagChips ids={element.tags} />}
              <span className="fr-card__spacer" />
              {element.estimate && (
                <span className="fr-card__estimate" title={tr('estimate')}>
                  {element.estimate}
                </span>
              )}
              {element.assigneeId && <Assignee id={element.assigneeId} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
  return element.back ? <FlipCard element={element} front={front} /> : front;
});

/**
 * A two-sided card (#142): both faces in one box, turning on the Y axis when `flipped` changes —
 * for everyone, it is a shared field. Exports draw only the side that shows, flat.
 */
function FlipCard({ element, front }: { element: CardElement; front: ReactNode }) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const canEdit = useCanEdit();
  const back = element.back!;
  const flipped = !!element.flipped;
  const backFace = (
    <div className="fr-card fr-card--back" style={{ ['--paper' as string]: back.color || BACK_COLORS[0] }}>
      <div className="fr-card__back-text">
        <ElementText
          element={element}
          part={BACK_PART}
          value={back.title}
          onCommit={(html) => {
            const live = editor.getElement<CardElement>(element.id);
            if (live?.back) editor.update<CardElement>(element.id, { back: { ...live.back, title: sanitizeRichText(html) } });
          }}
          fontSize={18}
          fontFamily="sans"
          align="center"
          vAlign="middle"
          color="var(--fr-ink)"
          padding={0}
          style={{ fontWeight: 600, lineHeight: 1.3 }}
          placeholder={tr('backOfTheCard')}
        />
      </div>
    </div>
  );
  if (exporting) return flipped ? backFace : <>{front}</>;
  return (
    <div className={`fr-card-flip${flipped ? ' is-flipped' : ''}`}>
      <div className="fr-card-flip__face" aria-hidden={flipped}>
        {front}
      </div>
      <div className="fr-card-flip__face is-back" aria-hidden={!flipped}>
        {backFace}
      </div>
      {canEdit ? (
        <button
          type="button"
          className="fr-card-flip__turn"
          data-fr-interactive
          aria-label={flipped ? tr('showTheFront') : tr('showTheBack')}
          title={flipped ? tr('showTheFront') : tr('showTheBack')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => editor.update<CardElement>(element.id, { flipped: !flipped })}
        >
          <Repeat2 size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Zoomed out to low detail (#131): the side that shows — a turned flip card its back's paper, else
 * the white card with its accent strip (the kanban's colour-by, as the full card shows it) — and
 * two faint bars for its title. No shadow, no clip, no text layout.
 */
function paintCard(el: CardElement, p: LowDetailPaint) {
  const alpha = p.presentation?.muted ? 0.4 : 1;
  const radius = isBar(el) ? 6 : 10;
  if (el.back && el.flipped) {
    p.box({ fill: el.back.color || BACK_COLORS[0], radius, alpha });
  } else {
    p.box({ fill: '#FFFFFF', stroke: 'rgba(23, 22, 43, 0.12)', strokeWidth: 1, radius, alpha });
    p.rect(0, 0, Math.min(6, el.w), el.h, p.presentation?.accent || el.color || DEFAULT_ACCENT, alpha);
  }
  if (isBar(el)) return;
  const h = Math.min(10, el.h * 0.12);
  p.rect(22, el.h * 0.22, (el.w - 36) * 0.86, h, '#17162B', 0.16 * alpha);
  p.rect(22, el.h * 0.22 + h * 2, (el.w - 36) * 0.55, h, '#17162B', 0.16 * alpha);
}

/** Is element-local `local` on the card's description: below the title, above the footer? */
function descriptionAt(el: CardElement, local: { x: number; y: number }): boolean {
  if (isBar(el) || (el.back && el.flipped) || !richTextToPlain(el.description ?? '').trim()) return false;
  const top = PAD.top + cardLayout(el).titleLines * TITLE.line;
  const bottom = el.h - PAD.bottom - FOOTER.h;
  // A compact card (a kanban's density) keeps only the footer's gap there: no description shown.
  return bottom - top >= DESC.line && local.y >= top && local.y < bottom && local.x >= 0 && local.x <= el.w;
}

export default defineElement({
  type: 'card',
  label: { one: tr('card'), many: tr('cards') },
  icon: ListTodoIcon,
  resize: 'width-only',
  // As a timeline bar a card may be one day long.
  minSize: (el) => (isBar(el) ? { w: 8, h: el.h } : { w: CARD_MIN_W, h: 60 }),
  // The accent bar is the card's colour.
  sharedStyle: (el) => ({ fill: el.color || DEFAULT_ACCENT }),
  applySharedStyle: (_el, { fill }) => (fill && fill !== 'transparent' ? { color: fill } : null),
  // A few pixels big (a large board's thumbnail) a card reads as white paper with lines of text:
  // a light grey (white would vanish on a kanban's white columns); the accent stripe is too thin.
  swatch: () => '#e3e2ec',
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
  lowDetail: paintCard,
  // Both sides of a flip card (find on board, copy as text).
  toPlainText: (el) => [richTextToPlain(el.title), richTextToPlain(el.description), el.back ? richTextToPlain(el.back.title) : ''].filter(Boolean).join('\n'),
  // A double-click on the description (anywhere between the title and the footer) opens the
  // details, for viewers too; on the title it edits the title. Compact cards show no description.
  opensAt: (el, local) => descriptionAt(el, local),
  onOpen: (el, { editor }) => editor.openPanel(DETAILS_PANEL, { id: el.id }),
  // The back of a turned flip card is what a double-click edits.
  textPartAt: (el) => (el.back && el.flipped && !isBar(el) ? BACK_PART : null),
  writeTextPart(el, part, html, editor) {
    if (part === BACK_PART && el.back) editor.update<CardElement>(el.id, { back: { ...el.back, title: sanitizeRichText(html) } });
  },
  // Height follows the content (title wrap, description preview) at the current width, and the
  // density its container's saved view gives it (compact: no description).
  normalize(el, _prev, ctx) {
    if (isBar(el)) return null;
    const { h } = cardLayout(el, { compact: ctx?.presentation?.density === 'compact' });
    return h !== el.h ? { h } : null;
  },
});
