// A live activity on the board (KAI-132): its question, and the results the SERVER publishes in
// the `engageResults` collection (counts, words, averages, questions — never who answered what,
// unless a poll was answered openly). Drawn inside the element, so exports keep them.
import { memo } from 'react';
import { ChartColumn, MessageSquareOff } from 'lucide-react';
import type { ActivityElement, ActivityResults } from '@freero/shared';
import { defineElement, ElementText, richTextToPlain, useCollection, useEditor, useIsExporting, type Editor, type ElementRenderProps, type NewElement } from '@engine';
import { KIND_ICON } from './lib/icons';
import { ACCENTS, ACTIVITY_H, ACTIVITY_W, ANSWER_DIALOG, RESULTS, answerLink, answersLabel, kindLabel } from './lib/activity';
import { Body } from './lib/Results';
import { QrCode } from './lib/qr';
import { t } from './messages';
import './engage.css';

/**
 * Asks the server for a copied quiz's key once the copy has reached it (the copy is written in the
 * same transaction that calls this, so the first request may find no activity yet: retry a little).
 */
function copyKeyLater(editor: Editor, id: string, from: { boardId: string; activityId: string }, attempt = 0) {
  const copy = editor.host.engage?.copyKey;
  if (!copy || !editor.can('editor')) return;
  setTimeout(() => {
    copy(id, from).catch((e: unknown) => {
      const status = (e as { status?: number }).status;
      if (status === 404 && attempt < 5) copyKeyLater(editor, id, from, attempt + 1);
      else if (status === 403) editor.host.notify(t('theQuizSRightAnswers'), 'info');
    });
  }, 700 * (attempt + 1));
}

const ActivityView = memo(function ActivityView({ element }: ElementRenderProps<ActivityElement>) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const results = new Map(useCollection<ActivityResults>(RESULTS)).get(element.id);
  const Icon = KIND_ICON[element.kind] ?? ChartColumn;
  return (
    <div className="fr-engage" style={{ ['--accent' as string]: element.color || ACCENTS[0] }}>
      <div className="fr-engage__head">
        <span className="fr-engage__kind">
          <Icon size={15} aria-hidden /> {kindLabel(element.kind)}
        </span>
        {element.closed ? (
          <span className="fr-engage__chip">
            <MessageSquareOff size={11} aria-hidden />{' '}{t('closed')}</span>
        ) : null}
        {element.anonymous ? <span className="fr-engage__chip">{t('anonymous')}</span> : null}
        <span className="fr-engage__count">{answersLabel(element.kind, results)}</span>
      </div>
      <div className="fr-engage__question">
        <ElementText element={element} field="question" fontSize={22} fontFamily="sans" align="left" vAlign="top" color="var(--fr-ink)" padding={0} placeholder={t('askSomething')} style={{ fontWeight: 650, lineHeight: 1.25 }} />
      </div>
      <div className="fr-engage__body">
        <Body a={element} r={results} now={() => editor.host.serverNow()} />
        {element.qr ? (
          <figure className="fr-engage__qr">
            <QrCode text={answerLink(editor.boardId, element.id, !!editor.host.engage)} label={t('qrCodeOfTheAnswer')} />
            <figcaption>{t('scanToAnswer')}</figcaption>
          </figure>
        ) : null}
      </div>
      {!exporting && !element.closed ? (
        <button
          type="button"
          className="fr-engage__answer"
          data-fr-interactive
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => editor.openPanel(ANSWER_DIALOG, { id: element.id })}
        >
          {element.kind === 'qna' ? t('askOrUpvote') : t('answer')}
        </button>
      ) : null}
    </div>
  );
});

export default defineElement({
  type: 'activity',
  label: { one: t('activity'), many: t('activities') },
  icon: ChartColumn,
  resize: 'free',
  minSize: { w: 320, h: 240 },
  textField: 'question',
  sharedStyle: (el) => ({ fill: el.color || ACCENTS[0] }),
  applySharedStyle: (_el, { fill }) => (fill && fill !== 'transparent' ? { color: fill } : null),
  defaults: (): Omit<NewElement<'activity'>, 'x' | 'y'> => ({
    type: 'activity',
    w: ACTIVITY_W,
    h: ACTIVITY_H,
    kind: 'poll',
    question: '',
    options: [],
    maxChoices: 1,
    scale: 5,
    anonymous: true,
    results: 'live',
    guests: true,
    closed: false,
    color: ACCENTS[0],
  }),
  Component: ActivityView,
  // A copied quiz (paste, duplicate, a template) brings a REFERENCE to the quiz it came from, never
  // its answer key: the server copies the key for editors who may edit that board (#147).
  copyContent: (el, editor) => (el.kind === 'quiz' ? { keyFrom: { boardId: editor.boardId, activityId: el.id } } : undefined),
  pasteContent: (el, content, editor) => {
    const from = (content as { keyFrom?: { boardId?: unknown; activityId?: unknown } } | undefined)?.keyFrom;
    if (el.kind === 'quiz' && typeof from?.boardId === 'string' && typeof from.activityId === 'string') copyKeyLater(editor, el.id, { boardId: from.boardId, activityId: from.activityId });
  },
  toPlainText: (el) =>
    [richTextToPlain(el.question), ...el.options.map((o) => o.text), ...(el.questions ?? []).flatMap((q) => [q.text, ...q.options.map((o) => o.text)])]
      .filter(Boolean)
      .join('\n'),
});
