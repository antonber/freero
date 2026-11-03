// A live activity on the board (KAI-132): its question, and the results the SERVER publishes in
// the `engageResults` collection (counts, words, averages, questions — never who answered what,
// unless a poll was answered openly). Drawn inside the element, so exports keep them.
import { memo } from 'react';
import { ChartColumn, MessageSquareOff } from 'lucide-react';
import type { ActivityElement, ActivityResults } from '@freero/shared';
import { defineElement, ElementText, richTextToPlain, useCollection, useEditor, useIsExporting, type ElementRenderProps, type NewElement } from '@engine';
import { KIND_ICON } from './lib/icons';
import { ACCENTS, ACTIVITY_H, ACTIVITY_W, ANSWER_DIALOG, RESULTS, answerLink, answersLabel, kindLabel } from './lib/activity';
import { Body } from './lib/Results';
import { QrCode } from './lib/qr';
import './engage.css';

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
            <MessageSquareOff size={11} aria-hidden /> Closed
          </span>
        ) : null}
        {element.anonymous ? <span className="fr-engage__chip">Anonymous</span> : null}
        <span className="fr-engage__count">{answersLabel(element.kind, results)}</span>
      </div>
      <div className="fr-engage__question">
        <ElementText element={element} field="question" fontSize={22} fontFamily="sans" align="left" vAlign="top" color="var(--fr-ink)" padding={0} placeholder="Ask something" style={{ fontWeight: 650, lineHeight: 1.25 }} />
      </div>
      <div className="fr-engage__body">
        <Body a={element} r={results} />
        {element.qr ? (
          <figure className="fr-engage__qr">
            <QrCode text={answerLink(editor.boardId, element.id, !!editor.host.engage)} label="QR code of the answer link" />
            <figcaption>Scan to answer</figcaption>
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
          {element.kind === 'qna' ? 'Ask or upvote' : 'Answer'}
        </button>
      ) : null}
    </div>
  );
});

export default defineElement({
  type: 'activity',
  label: { one: 'Activity', many: 'Activities' },
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
  toPlainText: (el) => [richTextToPlain(el.question), ...el.options.map((o) => o.text)].filter(Boolean).join('\n'),
});
