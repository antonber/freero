import { useEffect, useRef, useState } from 'react';
import type { CardElement } from '@freero/shared';
import { definePanel, richTextToPlain, RichTextEditor, RichTextView, useElement, useRole, type Editor, type PanelProps } from '@engine';
import { Modal } from '@ui';
import { DETAILS_PANEL } from './lib/constants';
import { detailsSession, type DetailsSession } from './lib/details';
import { CardFields } from './lib/FieldsEditor';
import { t } from './messages';

/**
 * The card's description being edited, formatted (lists, bold, code, links), in place. Typing in
 * one sitting is one undo step. Writes go through a session (lib/details.ts), so only an editor
 * that was opened ever writes, and only its card.
 */
function DescriptionEditor({ editor, card }: { editor: Editor; card: CardElement }) {
  const session = useRef<DetailsSession | null>(null);
  session.current ??= detailsSession(editor);
  const [initial] = useState(() => card.description ?? '');
  const gesture = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    session.current!.flush();
  };
  /** The editor lost focus: write, and end the undo step (the dialog stays open). */
  const end = () => {
    flush();
    if (gesture.current) {
      gesture.current = false;
      editor.endGesture();
    }
  };
  // The dialog closes (Escape, the close button, another card's details): keep what was typed.
  // The session opens with the effect, not the first render: an effect run twice (StrictMode)
  // closes it once in between, and a session opened only while rendering would stay closed.
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => {
    session.current!.open(card.id);
    return () => {
      endRef.current();
      session.current!.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <RichTextEditor
        autoFocus
        markdownShortcuts
        className="fr-card-details__desc"
        html={initial}
        placeholder={t('addDetailsLinksAcceptanceCriteria')}
        aria-label={t('cardDescription')}
        onFocus={() => {
          if (!gesture.current) {
            gesture.current = true;
            editor.beginGesture();
          }
        }}
        onBlur={end}
        onChange={(html) => {
          session.current!.type(html);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 250);
        }}
      />
      <p className="fr-card-details__hint">{t('markdownHint')}</p>
    </>
  );
}

function CardDetails({ editor, id }: { editor: Editor; id: string }) {
  const card = useElement<CardElement>(id);
  useRole(); // a role change re-renders: what this person may change follows it
  const close = () => editor.closePanel(DETAILS_PANEL);
  if (!card || card.type !== 'card') {
    return (
      <Modal open onClose={close} title={t('cardDetails')}>
        <p>{t('thisCardIsNoLonger')}</p>
      </Modal>
    );
  }
  // Viewers, commenters and anyone on a locked card read it; nothing here writes for them.
  const editable = !card.locked && editor.mayEdit([card.id]);
  return (
    <Modal open onClose={close} title={richTextToPlain(card.title).trim() || t('untitled')} description={editable ? undefined : t('viewOnly')} width={560} className="fr-card-details">
      <div className="fr-card-pop">
        <CardFields editor={editor} card={card} readOnly={!editable} />
        <div className="fr-card-pop__label">{t('description')}</div>
        {editable ? (
          <DescriptionEditor editor={editor} card={card} />
        ) : (
          <RichTextView autoFocus className="fr-card-details__desc" html={card.description ?? ''} placeholder={t('noDescription')} aria-label={t('cardDescription')} />
        )}
      </div>
    </Modal>
  );
}

/** Card details: the description in full, and the card's kanban fields (`editor.openPanel(DETAILS_PANEL, { id })`). */
function DetailsDialog({ editor, props }: PanelProps) {
  const id = typeof props?.id === 'string' ? props.id : '';
  // Another card's details replace these: a fresh editor, never this card's text carried over.
  return <CardDetails key={id} editor={editor} id={id} />;
}

export default definePanel({ id: DETAILS_PANEL, slot: 'dialog', order: 10, minRole: 'viewer', Component: DetailsDialog });
