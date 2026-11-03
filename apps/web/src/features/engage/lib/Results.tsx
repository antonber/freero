// What a live activity's results look like (KAI-132): drawn inside the element (so exports keep
// them) and on the full-screen stage while presenting (#40). Only what the server published.
import { ThumbsUp, EyeOff } from 'lucide-react';
import type { ActivityElement, ActivityResults } from '@freero/shared';
import { optionText, shares, wordSize } from './activity';

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

export function Body({ a, r }: { a: ActivityElement; r: ActivityResults | undefined }) {
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

