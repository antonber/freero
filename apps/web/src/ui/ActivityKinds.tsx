// Answer forms of the 2×2 matrix and the quiz (#147), shared by the board's answer dialog and the
// phone answer page (ActivityForm).
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Timer, X } from 'lucide-react';
import type { ActivityAnswer, ActivityInfo, ActivityState } from '@freero/shared';
import { Button } from './Button';

import { t as tr } from './messages';
const DOT_COLORS = ['#5B3FF0', '#E5484D', '#1FA463', '#F5A524', '#2E9BF0', '#E64DA6', '#14B8A6', '#F97316', '#8B5CF6', '#84CC16', '#8A89A3', '#17162B'];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * 2×2 matrix: pick an item, then tap where it goes (or drag a placed item). Positions are 0..1
 * from the low to the high end of each axis; up is high.
 */
export function MatrixForm({ a, mine, onSubmit, busy }: { a: ActivityInfo; mine: ActivityAnswer | null; onSubmit: (ans: ActivityAnswer) => void; busy: boolean }) {
  const ax = a.axes ?? { x: ['Low', 'High'], y: ['Low', 'High'] };
  const [placed, setPlaced] = useState<Record<string, { x: number; y: number }>>(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const o of a.options) if (mine?.positions?.[o.id]) out[o.id] = mine.positions[o.id];
    return out;
  });
  const [active, setActive] = useState<string | null>(() => a.options.find((o) => !mine?.positions?.[o.id])?.id ?? null);
  const plane = useRef<HTMLDivElement>(null);
  const drag = useRef<string | null>(null);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = plane.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height) };
  };
  const place = (id: string, p: { x: number; y: number }) => setPlaced((s) => ({ ...s, [id]: { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 } }));
  const onPlaneDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const dot = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
    const id = dot?.dataset.item ?? active;
    if (!id) return;
    e.preventDefault();
    drag.current = id;
    plane.current!.setPointerCapture(e.pointerId);
    place(id, at(e));
    if (!dot) setActive(a.options.find((o) => o.id !== id && !placed[o.id])?.id ?? null);
  };
  const keyMove = (id: string, dx: number, dy: number) => {
    const p = placed[id] ?? { x: 0.5, y: 0.5 };
    place(id, { x: clamp01(p.x + dx), y: clamp01(p.y + dy) });
  };
  return (
    <>
      <p className="fr-actform__hint">{active ? tr('tapWhereValueGoes', { value: a.options.find((o) => o.id === active)?.text || tr('thisItem') }) : tr('dragAnItemToMove')}</p>
      <div className="fr-actform__chips" role="group" aria-label={tr('items')}>
        {a.options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            className="fr-actform__chip"
            aria-pressed={active === o.id}
            style={{ ['--dot' as string]: DOT_COLORS[i % DOT_COLORS.length] }}
            onClick={() => setActive(o.id)}
          >
            <span className="fr-actform__chipdot" aria-hidden />
            {o.text || tr('untitledItem')}
            {placed[o.id] ? <Check size={13} aria-label="placed" /> : null}
          </button>
        ))}
      </div>
      <div className="fr-actform__matrix">
        <span className="fr-actform__axis">{ax.y[1]}</span>
        <div
          ref={plane}
          className="fr-actform__plane"
          role="application"
          aria-label={tr('matrixValueToValue2Across', { value: ax.x[0], value2: ax.x[1], value3: ax.y[0], value4: ax.y[1] })}
          onPointerDown={onPlaneDown}
          onPointerMove={(e) => drag.current && place(drag.current, at(e))}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {a.options.map((o, i) =>
            placed[o.id] ? (
              <button
                key={o.id}
                type="button"
                data-item={o.id}
                className="fr-actform__pin"
                aria-label={tr('valueRoundAcrossRound2Up', { value: o.text || tr('item'), round: Math.round(placed[o.id].x * 100), round2: Math.round(placed[o.id].y * 100) })}
                style={{ left: `${placed[o.id].x * 100}%`, top: `${(1 - placed[o.id].y) * 100}%`, ['--dot' as string]: DOT_COLORS[i % DOT_COLORS.length] }}
                onKeyDown={(e) => {
                  const d = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[e.key];
                  if (!d) return;
                  e.preventDefault();
                  keyMove(o.id, d[0], d[1]);
                }}
              >
                <span>{o.text}</span>
              </button>
            ) : null,
          )}
        </div>
        <span className="fr-actform__axis">
          {ax.y[0]} · {ax.x[0]} → {ax.x[1]}
        </span>
      </div>
      <Button variant="primary" size="lg" loading={busy} disabled={!Object.keys(placed).length} onClick={() => onSubmit({ positions: placed })}>
        {mine ? tr('changeMyPlacement') : tr('send')}
      </Button>
    </>
  );
}

/** Seconds left on the open question by the server's clock (`state.now` when it answered). */
function useSecondsLeft(a: ActivityInfo, state: ActivityState): number | null {
  const offset = useMemo(() => (state.now ? state.now - Date.now() : 0), [state.now]);
  const q = a.quiz && a.quiz.step >= 0 ? a.questions?.[a.quiz.step] : undefined;
  const open = !!q?.seconds && !!a.quiz && !a.quiz.showAnswer;
  const left = () => (open ? Math.max(0, Math.ceil((a.quiz!.openedAt + q!.seconds! * 1000 - (Date.now() + offset)) / 1000)) : null);
  const [value, setValue] = useState(left);
  useEffect(() => {
    setValue(left());
    if (!open) return;
    const t = setInterval(() => setValue(left()), 250);
    return () => clearInterval(t);
  }, [open, a.quiz?.openedAt, q?.id, offset]);
  return value;
}

/** Quiz: the open question with its timer; once its answer is shown, whether you got it and your score. */
export function QuizForm({ a, state, onSubmit, busy }: { a: ActivityInfo; state: ActivityState; onSubmit: (ans: ActivityAnswer) => void; busy: boolean }) {
  const q = a.quiz && a.quiz.step >= 0 ? a.questions?.[a.quiz.step] : undefined;
  const mineNow = q ? state.mine?.quiz?.[q.id]?.choices : undefined;
  const [picked, setPicked] = useState<string[]>(mineNow ?? []);
  // A new question starts empty (or with what you sent for it).
  useEffect(() => setPicked(mineNow ?? []), [q?.id]);
  const left = useSecondsLeft(a, state);
  const total = a.questions?.length ?? 0;
  const score = <p className="fr-actform__score">{tr('yourScore')}{' '}{state.myScore ?? 0}</p>;
  if (!q)
    return (
      <>
        <p className="fr-actform__hint">{state.reason ?? tr('theQuizStartsWhenThe')}</p>
        {state.mine ? score : null}
      </>
    );
  const shown = a.quiz?.showAnswer;
  const correct = shown && state.results?.quiz?.questionId === q.id ? state.results.quiz.correct : undefined;
  const right = correct && mineNow ? mineNow.length === correct.length && correct.every((id) => mineNow.includes(id)) : false;
  const open = state.canAnswer && !shown && left !== 0;
  const multi = !!q.multi;
  return (
    <>
      <div className="fr-actform__quizhead">
        <span>{tr('question')}{' '}{a.quiz!.step + 1}{' '}{tr('ofTotal', { total })}</span>
        {left !== null && !shown ? (
          <span className={`fr-actform__timer${left <= 5 ? ' is-low' : ''}`}>
            <Timer size={14} aria-hidden />{' '}{tr('leftS', { left })}</span>
        ) : null}
      </div>
      <p className="fr-actform__question">{q.text || tr('untitledQuestion')}</p>
      {multi && open ? <p className="fr-actform__hint">{tr('pickAllThatAreRight')}</p> : null}
      <ul className="fr-actform__choices" role={multi ? 'group' : 'radiogroup'}>
        {q.options.map((o) => {
          const isRight = correct?.includes(o.id);
          return (
            <li key={o.id}>
              <button
                type="button"
                className={`fr-actform__choice${isRight ? ' is-right' : ''}`}
                role={multi ? 'checkbox' : 'radio'}
                aria-checked={picked.includes(o.id)}
                disabled={!open}
                onClick={() => setPicked((p) => (multi ? (p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id]) : [o.id]))}
              >
                {picked.includes(o.id) ? <Check size={16} aria-hidden /> : <span style={{ width: 16 }} />}
                {o.text || tr('untitledAnswer')}
                {isRight ? <span className="fr-actform__tag">{tr('rightAnswer')}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {open ? (
        <Button variant="primary" size="lg" loading={busy} disabled={!picked.length} onClick={() => onSubmit({ quiz: { [q.id]: { choices: picked } } })}>
          {mineNow ? tr('changeMyAnswer') : tr('sendAnswer')}
        </Button>
      ) : null}
      {shown ? (
        <p className={`fr-actform__verdict${right ? ' is-right' : ''}`} role="status">
          {right ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />} {mineNow ? (right ? tr('right') : tr('notThisTime')) : tr('youDidnTAnswerThis')}
        </p>
      ) : !open ? (
        <p className="fr-actform__hint" role="status">
          {mineNow ? tr('answerInTheHostShows') : (state.reason ?? tr('timeSUpForThis'))}
        </p>
      ) : null}
      {score}
    </>
  );
}
