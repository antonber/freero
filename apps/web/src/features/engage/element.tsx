// A live activity on the board (KAI-132): its question, and the results the SERVER publishes in
// the `engageResults` collection (counts, words, averages, questions — never who answered what,
// unless a poll was answered openly). Drawn inside the element, so exports keep them.
import { memo } from 'react';
import { ChartColumn, EyeOff, MessageSquareOff, ThumbsUp } from 'lucide-react';
import type { ActivityElement, ActivityResults } from '@freero/shared';
import { defineElement, ElementText, richTextToPlain, useCollection, useEditor, useIsExporting, type ElementRenderProps, type NewElement } from '@engine';
import { KIND_ICON } from './lib/icons';
import { ACCENTS, ACTIVITY_H, ACTIVITY_W, ANSWER_DIALOG, RESULTS, answersLabel, kindLabel, optionText, shares, wordSize } from './lib/activity';
import './engage.css';

function Poll({ a, r }: { a: ActivityElement; r: ActivityResults }) {
  const rows = a.options.map((o) => r.poll?.find((p) => p.optionId === o.id) ?? { optionId: o.id, count: 0 });
  const pct = shares(rows.map((x) => x.count));
  const top = Math.max(0, ...rows.map((x) => x.count));
  return (
    <ul className="fr-engage__bars">
      {rows.map((row, i) => (
        <li key={row.optionId} className={row.count && row.count === top ? 'is-top' : undefined}>
          <span className="fr-engage__label">{optionText(a, row.optionId)}</span>
          <span className="fr-engage__track">
            <span className="fr-engage__fill" style={{ width: `${pct[i]}%` }} />
          </span>
          <span className="fr-engage__num">
            {pct[i]}% · {row.count}
          </span>
          {'names' in row && row.names?.length ? <span className="fr-engage__names">{row.names.join(', ')}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function WordCloud({ r }: { r: ActivityResults }) {
  const words = r.words ?? [];
  if (!words.length) return null;
  const counts = words.map((w) => w.count);
  const most = Math.max(...counts);
  const least = Math.min(...counts);
  // Most frequent in the middle: alternate sides around the first word.
  const placed = words.reduce<typeof words>((out, w, i) => (i % 2 ? [...out, w] : [w, ...out]), []);
  return (
    <div className="fr-engage__cloud">
      {placed.map((w) => (
        <span key={w.word} style={{ fontSize: wordSize(w.count, least, most), opacity: most === least ? 1 : 0.55 + (0.45 * (w.count - least)) / (most - least) }} title={`${w.count}`}>
          {w.word}
        </span>
      ))}
    </div>
  );
}

function Ranking({ a, r }: { a: ActivityElement; r: ActivityResults }) {
  const rows = r.ranking ?? [];
  const best = Math.max(1, ...rows.map((x) => x.points));
  return (
    <ol className="fr-engage__bars fr-engage__ranking">
      {rows.map((row, i) => (
        <li key={row.optionId}>
          <span className="fr-engage__place">{i + 1}</span>
          <span className="fr-engage__label">{optionText(a, row.optionId)}</span>
          <span className="fr-engage__track">
            <span className="fr-engage__fill" style={{ width: `${(row.points / best) * 100}%` }} />
          </span>
          <span className="fr-engage__num">{row.points ? `avg #${row.avgRank}` : '—'}</span>
        </li>
      ))}
    </ol>
  );
}

function Rating({ a, r }: { a: ActivityElement; r: ActivityResults }) {
  const scale = a.scale ?? 5;
  return (
    <ul className="fr-engage__bars">
      {(r.rating ?? []).map((row) => (
        <li key={row.optionId}>
          <span className="fr-engage__label">{optionText(a, row.optionId)}</span>
          <span className="fr-engage__track">
            <span className="fr-engage__fill" style={{ width: `${(row.avg / scale) * 100}%` }} />
          </span>
          <span className="fr-engage__num">{row.count ? `${row.avg.toFixed(1)} / ${scale}` : '—'}</span>
        </li>
      ))}
    </ul>
  );
}

function Questions({ r }: { r: ActivityResults }) {
  const qs = r.questions ?? [];
  if (!qs.length) return null;
  return (
    <ul className="fr-engage__questions">
      {qs.slice(0, 8).map((q) => (
        <li key={q.id} className={q.answered ? 'is-answered' : undefined}>
          <span className="fr-engage__votes">
            <ThumbsUp size={13} aria-hidden /> {q.votes}
          </span>
          <span className="fr-engage__qtext">
            {q.text}
            <span className="fr-engage__by">{q.answered ? 'Answered' : q.by ?? 'Anonymous'}</span>
          </span>
        </li>
      ))}
      {qs.length > 8 && <li className="fr-engage__more">+{qs.length - 8} more</li>}
    </ul>
  );
}

function Body({ a, r }: { a: ActivityElement; r: ActivityResults | undefined }) {
  if (r?.sealed)
    return (
      <div className="fr-engage__sealed">
        <EyeOff size={22} aria-hidden />
        <span>Results are hidden until they’re revealed</span>
      </div>
    );
  const results: ActivityResults = r ?? { activityId: a.id, respondents: 0, sealed: false, updatedAt: 0 };
  switch (a.kind) {
    case 'poll':
      return <Poll a={a} r={results} />;
    case 'wordcloud':
      return results.words?.length ? <WordCloud r={results} /> : <div className="fr-engage__empty">Words appear here as people answer</div>;
    case 'ranking':
      return results.ranking?.length ? <Ranking a={a} r={results} /> : <Ranking a={a} r={{ ...results, ranking: a.options.map((o) => ({ optionId: o.id, points: 0, avgRank: 0 })) }} />;
    case 'rating':
      return <Rating a={a} r={{ ...results, rating: results.rating ?? a.options.map((o) => ({ optionId: o.id, avg: 0, count: 0, dist: [] })) }} />;
    case 'qna':
      return results.questions?.length ? <Questions r={results} /> : <div className="fr-engage__empty">Questions appear here as people ask them</div>;
  }
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
