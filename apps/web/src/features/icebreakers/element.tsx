// Icebreaker widgets (#150): a wheel of names, dice, a random speaking order. The result is the
// SERVER's (icebreakerResults); every client animates it from the same start on the server's clock
// and lands at the same moment. Reduced motion and exports show the result straight away.
import { memo, useEffect, useState } from 'react';
import { Dices, Disc3, ListOrdered, PartyPopper } from 'lucide-react';
import type { FacilitationSession, IcebreakerElement, IcebreakerResult } from '@freero/shared';
import { defineElement, useCanEdit, useCollection, useEditor, useIsExporting, type Editor, type ElementRenderProps, type NewElement } from '@engine';
import { COLORS, RESULTS, SIZE, STARTER_ENTRIES, TITLES, entriesOf, progress, resultText, wheelAngle } from './lib/model';
import './icebreakers.css';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Progress of the latest result on the server's clock, re-rendering every frame while it runs. */
function useProgress(editor: Editor, r: IcebreakerResult | undefined, still: boolean): number {
  const [p, setP] = useState(() => (still ? 1 : progress(r, editor.host.serverNow())));
  useEffect(() => {
    if (still || !r) return setP(1);
    let raf = 0;
    const tick = () => {
      const next = progress(r, editor.host.serverNow());
      setP(next);
      if (next < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [editor, r, still]);
  return p;
}

/** May this person spin now: an editor, and while a facilitator runs a session only they (or the owner). */
function useCanSpin(editor: Editor): boolean {
  const canEdit = useCanEdit();
  const session = new Map(useCollection<FacilitationSession>('facilitation')).get('session');
  if (!canEdit || !editor.host.icebreakers) return false;
  return !session || session.by === editor.user.id || editor.host.board.role === 'owner';
}

const slicePath = (i: number, n: number, r: number) => {
  if (n === 1) return `M0 ${-r}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${-r}Z`;
  const a0 = ((i / n) * 2 - 0.5) * Math.PI;
  const a1 = (((i + 1) / n) * 2 - 0.5) * Math.PI;
  const large = 1 / n > 0.5 ? 1 : 0;
  return `M0 0L${r * Math.cos(a0)} ${r * Math.sin(a0)}A${r} ${r} 0 ${large} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)}Z`;
};

function Wheel({ el, r, p }: { el: IcebreakerElement; r: IcebreakerResult | undefined; p: number }) {
  const entries = entriesOf(el);
  // While a spin runs, draw the slices as they were when it was made (someone may edit the names).
  const shown = r && p < 1 && r.of && r.of !== entries.length ? Array.from({ length: r.of }, (_, i) => (i === r.index ? (r.picked ?? '') : '')) : entries;
  const n = Math.max(1, shown.length);
  const angle = r && r.of === n ? wheelAngle(r, p) : 0;
  const R = 100;
  return (
    <svg className="fr-icebreaker__wheel" viewBox="-110 -118 220 228" aria-hidden>
      <g transform={`rotate(${angle})`}>
        {shown.length ? (
          shown.map((name, i) => {
            const mid = ((i + 0.5) / n) * 360;
            return (
              <g key={i}>
                <path d={slicePath(i, n, R)} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth={1.5} />
                <text transform={`rotate(${mid - 90}) translate(${R - 10} 0)`} textAnchor="end" dominantBaseline="middle" fontSize={n > 16 ? 7 : n > 10 ? 9 : 11} fill="#fff" fontWeight={650}>
                  {name.length > 14 ? `${name.slice(0, 13)}…` : name}
                </text>
              </g>
            );
          })
        ) : (
          <circle r={R} fill="#ecebf3" />
        )}
      </g>
      <circle r={14} fill="#fff" stroke="#17162b" strokeOpacity={0.15} />
      <path d="M-9 -116L9 -116L0 -96Z" fill="#17162b" />
    </svg>
  );
}

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

function Die({ value, tumbling }: { value: number; tumbling: boolean }) {
  return (
    <svg className={`fr-icebreaker__die${tumbling ? ' is-tumbling' : ''}`} viewBox="0 0 100 100" role="img" aria-label={String(value)}>
      <rect x={4} y={4} width={92} height={92} rx={18} fill="#fff" stroke="#17162b" strokeOpacity={0.18} strokeWidth={3} />
      {(PIPS[value] ?? PIPS[1]).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={8.5} fill="#17162b" />
      ))}
    </svg>
  );
}

function Dice({ el, r, p }: { el: IcebreakerElement; r: IcebreakerResult | undefined; p: number }) {
  const count = Math.min(3, Math.max(1, el.dice ?? 1));
  const final = r?.dice ?? Array.from({ length: count }, () => 1);
  // Tumbling faces depend only on the frame, so every client shows the same ones.
  const frame = Math.floor(p * 14);
  return (
    <div className="fr-icebreaker__dice">
      {final.map((v, i) => (
        <Die key={i} value={p < 1 ? ((v + frame * (i + 2)) % 6) + 1 : v} tumbling={p < 1} />
      ))}
    </div>
  );
}

function Speakers({ el, r, p }: { el: IcebreakerElement; r: IcebreakerResult | undefined; p: number }) {
  const order = r?.order ?? entriesOf(el);
  // The order is revealed one name after another as the shuffle runs.
  const revealed = p < 1 ? Math.floor(p * order.length) : order.length;
  return (
    <ol className="fr-icebreaker__order">
      {order.map((name, i) => (
        <li key={`${i}-${name}`} className={i < revealed || !r ? 'is-in' : ''}>
          <span className="fr-icebreaker__n">{i + 1}</span>
          <span>{i < revealed || !r ? name : '…'}</span>
        </li>
      ))}
    </ol>
  );
}

const IcebreakerView = memo(function IcebreakerView({ element }: ElementRenderProps<IcebreakerElement>) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const result = new Map(useCollection<IcebreakerResult>(RESULTS)).get(element.id);
  const p = useProgress(editor, result, exporting || reducedMotion());
  const canSpin = useCanSpin(editor);
  const [busy, setBusy] = useState(false);
  const done = !result || p >= 1;
  const Icon = element.kind === 'wheel' ? Disc3 : element.kind === 'dice' ? Dices : ListOrdered;
  const spin = async () => {
    setBusy(true);
    try {
      await editor.host.icebreakers!.roll(element.id);
    } catch (e) {
      editor.host.notify(e instanceof Error ? e.message : 'Couldn’t spin', 'error');
    } finally {
      setBusy(false);
    }
  };
  const verb = element.kind === 'wheel' ? 'Spin' : element.kind === 'dice' ? 'Roll' : 'Shuffle';
  return (
    <div className={`fr-icebreaker is-${element.kind}`} style={{ ['--accent' as string]: element.color }}>
      <div className="fr-icebreaker__head">
        <Icon size={16} aria-hidden />
        <span className="fr-icebreaker__title">{element.title || TITLES[element.kind]}</span>
      </div>
      <div className="fr-icebreaker__body">
        {element.kind === 'wheel' ? <Wheel el={element} r={result} p={p} /> : null}
        {element.kind === 'dice' ? <Dice el={element} r={result} p={p} /> : null}
        {element.kind === 'speakers' ? <Speakers el={element} r={result} p={p} /> : null}
      </div>
      <div className="fr-icebreaker__foot">
        <span className="fr-icebreaker__result" aria-live="polite">
          {result && done ? (
            <>
              {element.kind !== 'speakers' ? <PartyPopper size={14} aria-hidden /> : null}
              <strong>{element.kind === 'speakers' ? `Shuffled by ${result.by}` : resultText(result)}</strong>
              {element.kind !== 'speakers' ? <small> · {result.by}</small> : null}
            </>
          ) : result ? (
            `${result.by} is ${element.kind === 'wheel' ? 'spinning' : element.kind === 'dice' ? 'rolling' : 'shuffling'}…`
          ) : (
            ''
          )}
        </span>
        {canSpin && !exporting ? (
          <button type="button" className="fr-icebreaker__spin" data-fr-interactive onPointerDown={(e) => e.stopPropagation()} disabled={busy || !done} onClick={() => void spin()}>
            {verb}
          </button>
        ) : null}
      </div>
    </div>
  );
});

export default defineElement({
  type: 'icebreaker',
  label: { one: 'Icebreaker', many: 'Icebreakers' },
  icon: Disc3,
  resize: 'free',
  minSize: { w: 200, h: 180 },
  sharedStyle: (el) => ({ fill: el.color }),
  applySharedStyle: (_el, { fill }) => (fill && fill !== 'transparent' ? { color: fill } : null),
  defaults: (): Omit<NewElement<'icebreaker'>, 'x' | 'y'> => ({
    type: 'icebreaker',
    kind: 'wheel',
    title: TITLES.wheel,
    entries: STARTER_ENTRIES,
    dice: 2,
    color: COLORS[0],
    ...SIZE.wheel,
  }),
  Component: IcebreakerView,
  toPlainText: (el) => [el.title, ...(el.kind === 'dice' ? [] : entriesOf(el))].filter(Boolean).join('\n'),
});
