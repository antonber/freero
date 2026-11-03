// Answering a live activity (KAI-132): the board's answer dialog (features/engage) and the phone
// answer page without the board (/respond, app/, #40) show the same form. It only calls the
// actions it is given; answers go to the server, never into a board.
import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, EyeOff, ThumbsUp } from 'lucide-react';
import { ENGAGE_MAX_QUESTION, ENGAGE_MAX_WORDS, type ActivityAnswer, type ActivityInfo, type ActivityState } from '@freero/shared';
import { Button, IconButton } from './Button';
import { Input } from './fields';
import './ActivityForm.css';

/** What answering does (resolve with the new state, reject with a showable message). */
export interface ActivityActions {
  answer(answer: ActivityAnswer): Promise<ActivityState>;
  withdraw(): Promise<ActivityState>;
  ask(text: string): Promise<ActivityState>;
  upvote(questionId: string, on: boolean): Promise<ActivityState>;
  /** Owners and editors: mark a question answered or hide it. */
  moderate?(questionId: string, patch: { answered?: boolean; hidden?: boolean }): Promise<ActivityState>;
}

export interface ActivityFormProps {
  activity: ActivityInfo;
  state: ActivityState;
  onState(state: ActivityState): void;
  actions: ActivityActions;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

interface FormProps {
  a: ActivityInfo;
  mine: ActivityAnswer | null;
  onSubmit: (ans: ActivityAnswer) => void;
  busy: boolean;
}

function PollForm({ a, mine, onSubmit, busy }: FormProps) {
  const max = Math.max(1, Math.min(a.maxChoices ?? 1, a.options.length));
  const [picked, setPicked] = useState<string[]>(mine?.choices ?? []);
  const toggle = (id: string) =>
    setPicked((p) => (max === 1 ? [id] : p.includes(id) ? p.filter((x) => x !== id) : p.length < max ? [...p, id] : p));
  return (
    <>
      <p className="fr-actform__hint">{max === 1 ? 'Pick one' : `Pick up to ${max}`}</p>
      <ul className="fr-actform__choices" role={max === 1 ? 'radiogroup' : 'group'}>
        {a.options.map((o) => (
          <li key={o.id}>
            <button type="button" className="fr-actform__choice" role={max === 1 ? 'radio' : 'checkbox'} aria-checked={picked.includes(o.id)} onClick={() => toggle(o.id)}>
              {picked.includes(o.id) ? <Check size={16} aria-hidden /> : <span style={{ width: 16 }} />}
              {o.text || 'Untitled choice'}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="primary" size="lg" loading={busy} disabled={!picked.length} onClick={() => onSubmit({ choices: picked })}>
        {mine ? 'Change my answer' : 'Send answer'}
      </Button>
    </>
  );
}

function WordsForm({ mine, onSubmit, busy }: Omit<FormProps, 'a'>) {
  const [words, setWords] = useState<string[]>(() => {
    const w = [...(mine?.words ?? [])];
    while (w.length < ENGAGE_MAX_WORDS) w.push('');
    return w;
  });
  const filled = words.map((w) => w.trim()).filter(Boolean);
  return (
    <form
      className="fr-actform"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (filled.length) onSubmit({ words: filled });
      }}
    >
      <p className="fr-actform__hint">Up to {ENGAGE_MAX_WORDS} words or short phrases</p>
      {words.map((w, i) => (
        <Input
          key={i}
          aria-label={`Word ${i + 1}`}
          placeholder={i === 0 ? 'Your word' : 'Another (optional)'}
          value={w}
          maxLength={40}
          autoFocus={i === 0}
          onChange={(e) => setWords((ws) => ws.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!filled.length}>
        {mine ? 'Change my words' : 'Send'}
      </Button>
    </form>
  );
}

function RankForm({ a, mine, onSubmit, busy }: FormProps) {
  const ids = a.options.map((o) => o.id);
  const [order, setOrder] = useState<string[]>(() => (mine?.order && mine.order.length === ids.length && mine.order.every((id) => ids.includes(id)) ? mine.order : ids));
  const move = (i: number, d: -1 | 1) =>
    setOrder((o) => {
      const j = i + d;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  return (
    <>
      <p className="fr-actform__hint">Most important at the top</p>
      <ol className="fr-actform__choices">
        {order.map((id, i) => (
          <li key={id} className="fr-actform__rank">
            <strong>{i + 1}</strong>
            <span>{a.options.find((o) => o.id === id)?.text || 'Untitled item'}</span>
            <IconButton size={32} icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton size={32} icon={ArrowDown} label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)} />
          </li>
        ))}
      </ol>
      <Button variant="primary" size="lg" loading={busy} onClick={() => onSubmit({ order })}>
        {mine ? 'Change my ranking' : 'Send ranking'}
      </Button>
    </>
  );
}

function RateForm({ a, mine, onSubmit, busy }: FormProps) {
  const scale = a.scale ?? 5;
  const [ratings, setRatings] = useState<Record<string, number>>(mine?.ratings ?? {});
  return (
    <>
      <p className="fr-actform__hint">1 = not at all, {scale} = completely</p>
      <ul className="fr-actform__choices">
        {a.options.map((o) => (
          <li key={o.id}>
            <div>{o.text || 'Untitled statement'}</div>
            <div className="fr-actform__scale" role="radiogroup" aria-label={o.text}>
              {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" role="radio" aria-checked={ratings[o.id] === n} onClick={() => setRatings((r) => ({ ...r, [o.id]: n }))}>
                  {n}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <Button variant="primary" size="lg" loading={busy} disabled={!Object.keys(ratings).length} onClick={() => onSubmit({ ratings })}>
        {mine ? 'Change my ratings' : 'Send ratings'}
      </Button>
    </>
  );
}

function QnaForm({ a, state, onState, actions }: ActivityFormProps & { a: ActivityInfo }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<ActivityState>) => {
    setError(null);
    try {
      onState(await fn());
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    if (await run(() => actions.ask(text.trim()))) setText('');
    setBusy(false);
  };
  const questions = state.results?.questions ?? [];
  const moderate = actions.moderate;
  return (
    <>
      {state.canAnswer ? (
        <form className="fr-actform__row" onSubmit={ask}>
          <Input aria-label="Your question" placeholder="Ask a question" value={text} maxLength={ENGAGE_MAX_QUESTION} autoFocus onChange={(e) => setText(e.target.value)} />
          <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()}>
            Ask
          </Button>
        </form>
      ) : null}
      <p className="fr-actform__hint">{a.anonymous ? 'Questions are anonymous.' : 'Your name is shown with your question.'}</p>
      {error ? (
        <p className="fr-actform__error" role="alert">
          {error}
        </p>
      ) : null}
      {state.results?.sealed ? <p className="fr-actform__hint">Questions show once the host reveals them.</p> : null}
      <ul className="fr-actform__choices">
        {questions.map((q) => {
          const on = state.myUpvotes.includes(q.id);
          return (
            <li key={q.id} className={`fr-actform__q${q.answered ? ' is-answered' : ''}`}>
              <button
                type="button"
                className="fr-actform__upvote"
                aria-pressed={on}
                aria-label={on ? `Remove your upvote (${q.votes})` : `Upvote (${q.votes})`}
                disabled={!state.canAnswer}
                onClick={() => void run(() => actions.upvote(q.id, !on))}
              >
                <ThumbsUp size={14} aria-hidden /> {q.votes}
              </button>
              <span>
                {q.text}
                <br />
                <small>{q.answered ? 'Answered' : (q.by ?? 'Anonymous')}</small>
              </span>
              {moderate ? (
                <>
                  <IconButton size={32} icon={Check} label={q.answered ? 'Mark as not answered' : 'Mark as answered'} active={q.answered} onClick={() => void run(() => moderate(q.id, { answered: !q.answered }))} />
                  <IconButton size={32} icon={EyeOff} label="Hide from the board" onClick={() => void run(() => moderate(q.id, { hidden: true }))} />
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The question, the form for its kind, and what happens to your answer. */
export function ActivityForm(props: ActivityFormProps) {
  const { activity: a, state, onState, actions } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async (answer: ActivityAnswer) => {
    setBusy(true);
    setError(null);
    try {
      onState(await actions.answer(answer));
      setSent(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    try {
      onState(await actions.withdraw());
      setSent(false);
    } catch (e) {
      setError(errorText(e));
    }
  };
  // Re-mount the form when the stored answer arrives, so it starts from it.
  const formKey = JSON.stringify(state.mine);
  const form = { a, mine: state.mine, onSubmit: submit, busy };
  return (
    <div className="fr-actform" data-testid="engage-answer" style={a.color ? { ['--fr-accent' as string]: a.color } : undefined}>
      <p className="fr-actform__question">{a.question || 'Untitled activity'}</p>
      {!state.canAnswer && a.kind !== 'qna' ? <p className="fr-actform__hint">{state.reason}</p> : null}
      {a.kind === 'qna' ? <QnaForm {...props} a={a} /> : null}
      {state.canAnswer && a.kind !== 'qna' ? (
        <div key={formKey} className="fr-actform">
          {a.kind === 'poll' ? <PollForm {...form} /> : null}
          {a.kind === 'wordcloud' ? <WordsForm {...form} /> : null}
          {a.kind === 'ranking' ? <RankForm {...form} /> : null}
          {a.kind === 'rating' ? <RateForm {...form} /> : null}
        </div>
      ) : null}
      {error ? (
        <p className="fr-actform__error" role="alert">
          {error}
        </p>
      ) : null}
      {sent ? (
        <p className="fr-actform__hint" role="status">
          Thanks — your answer is in. You can change it any time.
        </p>
      ) : null}
      {state.mine && state.canAnswer && a.kind !== 'qna' ? (
        <Button variant="ghost" size="sm" onClick={withdraw}>
          Take my answer back
        </Button>
      ) : null}
      <p className="fr-actform__hint">
        {a.kind === 'qna' ? '' : a.anonymous ? 'Anonymous: nobody sees who answered what.' : 'Open: your name may be shown with your answer.'}
        {a.results === 'reveal' && !state.revealed ? ' Results show once the host reveals them.' : ''}
      </p>
    </div>
  );
}
