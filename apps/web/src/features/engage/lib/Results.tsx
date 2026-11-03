// What a live activity's results look like (KAI-132): drawn inside the element (so exports keep
// them) and on the full-screen stage while presenting (#40). Only what the server published.
import { useEffect, useState } from 'react';
import { Check, EyeOff, ThumbsUp, Timer, Trophy } from 'lucide-react';
import type { ActivityElement, ActivityResults } from '@freero/shared';
import { currentQuestion, optionText, shares, wordSize } from './activity';

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

const DOT_COLORS = ['#5B3FF0', '#E5484D', '#1FA463', '#F5A524', '#2E9BF0', '#E64DA6', '#14B8A6', '#F97316', '#8B5CF6', '#84CC16', '#8A89A3', '#17162B'];

/** 2×2 matrix (#147): each item at its average place, its spread as a halo, axes named at the ends. */
function Matrix({ a, r }: { a: ActivityElement; r: ActivityResults }) {
  const ax = a.axes ?? { x: ['Low', 'High'], y: ['Low', 'High'] };
  const rows = r.matrix ?? [];
  return (
    <div className="fr-engage__matrix">
      <span className="fr-engage__axis is-top">{ax.y[1]}</span>
      <div className="fr-engage__plane" role="img" aria-label={`${ax.x[0]} to ${ax.x[1]} across, ${ax.y[0]} to ${ax.y[1]} up`}>
        {a.options.map((o, i) => {
          const m = rows.find((x) => x.optionId === o.id);
          if (!m?.count) return null;
          const color = DOT_COLORS[i % DOT_COLORS.length];
          return (
            <div key={o.id} className="fr-engage__dot" style={{ left: `${m.x * 100}%`, top: `${(1 - m.y) * 100}%`, ['--dot' as string]: color }}>
              <span className="fr-engage__halo" style={{ width: `${Math.max(0.04, m.sx * 2) * 100}cqw`, height: `${Math.max(0.04, m.sy * 2) * 100}cqh` }} />
              <span className="fr-engage__pin" />
              <span className="fr-engage__dotlabel">
                {o.text || 'Untitled item'} <small>· {m.count}</small>
              </span>
            </div>
          );
        })}
        {!rows.some((m) => m.count) ? <span className="fr-engage__planehint">Items appear here as people place them</span> : null}
      </div>
      <span className="fr-engage__axis is-bottom">
        {ax.y[0]} · {ax.x[0]} → {ax.x[1]}
      </span>
    </div>
  );
}

/** Seconds left on the open quiz question (server clock), ticking. */
function useSecondsLeft(a: ActivityElement, now: () => number): number | null {
  const q = currentQuestion(a);
  const open = !!q?.seconds && !!a.quiz && !a.quiz.showAnswer;
  const left = () => (open ? Math.max(0, Math.ceil((a.quiz!.openedAt + q!.seconds! * 1000 - now()) / 1000)) : null);
  const [value, setValue] = useState(left);
  useEffect(() => {
    setValue(left());
    if (!open) return;
    const t = setInterval(() => setValue(left()), 250);
    return () => clearInterval(t);
  }, [open, a.quiz?.openedAt, q?.id]);
  return value;
}

/** Quiz (#147): the open question (right answer and counts once shown), or the leaderboard once revealed at the end. */
function Quiz({ a, r, now }: { a: ActivityElement; r: ActivityResults; now: () => number }) {
  const q = currentQuestion(a);
  const total = a.questions?.length ?? 0;
  const left = useSecondsLeft(a, now);
  const board = r.quiz?.leaderboard;
  const last = !!a.quiz && a.quiz.step === total - 1 && a.quiz.showAnswer;
  if (board && (last || !q))
    return (
      <ol className="fr-engage__leaders">
        {board.length ? (
          board.map((x, i) => (
            <li key={i}>
              <span className="fr-engage__place">{i === 0 ? <Trophy size={14} aria-hidden /> : i + 1}</span>
              <span className="fr-engage__label">{x.name}</span>
              <span className="fr-engage__num">
                {x.score} · {x.right}/{total}
              </span>
            </li>
          ))
        ) : (
          <li className="fr-engage__empty">Nobody answered</li>
        )}
      </ol>
    );
  if (!q)
    return (
      <div className="fr-engage__empty">
        {total} question{total === 1 ? '' : 's'} · starts when the host opens the first one
      </div>
    );
  const counts = r.quiz?.questionId === q.id ? r.quiz.counts : undefined;
  const correct = r.quiz?.questionId === q.id ? r.quiz.correct : undefined;
  const pct = shares(q.options.map((o) => counts?.find((c) => c.optionId === o.id)?.count ?? 0));
  return (
    <div className="fr-engage__quiz">
      <div className="fr-engage__quizhead">
        <span>
          Question {a.quiz!.step + 1} of {total}
        </span>
        {left !== null ? (
          <span className={`fr-engage__timer${left <= 5 ? ' is-low' : ''}`} aria-live="off">
            <Timer size={13} aria-hidden /> {left}s
          </span>
        ) : null}
        <span className="fr-engage__count">{r.quiz?.questionId === q.id ? r.quiz.answered : 0} answered</span>
      </div>
      <div className="fr-engage__quizq">{q.text || 'Untitled question'}</div>
      <ul className="fr-engage__bars">
        {q.options.map((o, i) => (
          <li key={o.id} className={correct?.includes(o.id) ? 'is-top is-right' : undefined}>
            <span className="fr-engage__label">
              {correct?.includes(o.id) ? <Check size={13} aria-label="Right answer" /> : null} {o.text || 'Untitled answer'}
            </span>
            {counts ? (
              <>
                <span className="fr-engage__track">
                  <span className="fr-engage__fill" style={{ width: `${pct[i]}%` }} />
                </span>
                <span className="fr-engage__num">{counts.find((c) => c.optionId === o.id)?.count ?? 0}</span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Body({ a, r, now = Date.now }: { a: ActivityElement; r: ActivityResults | undefined; now?: () => number }) {
  if (r?.sealed && a.kind !== 'quiz')
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
    case 'matrix':
      return <Matrix a={a} r={results} />;
    case 'quiz':
      return <Quiz a={a} r={results} now={now} />;
  }
}

