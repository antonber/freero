// Two dialogs of live activities (KAI-132): answering one (anyone on the board, guests when the
// activity allows it — answers go to the server, never into the board) and setting one up (editors).
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, EyeOff, Plus, ThumbsUp, Trash2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { ENGAGE_MAX_OPTIONS, ENGAGE_MAX_QUESTION, ENGAGE_MAX_WORDS, type ActivityAnswer, type ActivityElement, type ActivityKind, type ActivityState } from '@freero/shared';
import { definePanel, plainToRichText, richTextToPlain, useCanEdit, useElement, type Editor, type PanelProps } from '@engine';
import { Button, IconButton, Input, Modal, SegmentedControl, Select, Toggle } from '@ui';
import { ANSWER_DIALOG, KINDS, SETTINGS_DIALOG, kindLabel, starter, usesOptions } from './lib/activity';
import './engage.css';

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

function useActivityState(editor: Editor, id: string): [ActivityState | null, (s: ActivityState) => void, string | null] {
  const [state, setState] = useState<ActivityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!editor.host.engage) {
      setError('Activities need a board on a Freero server.');
      return;
    }
    editor.host.engage.state(id).then(
      (s) => !cancelled && setState(s),
      (e) => !cancelled && setError(errorText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [editor, id]);
  return [state, setState, error];
}

function PollForm({ a, mine, onSubmit, busy }: { a: ActivityElement; mine: ActivityAnswer | null; onSubmit: (ans: ActivityAnswer) => void; busy: boolean }) {
  const max = Math.max(1, Math.min(a.maxChoices ?? 1, a.options.length));
  const [picked, setPicked] = useState<string[]>(mine?.choices ?? []);
  const toggle = (id: string) =>
    setPicked((p) => (max === 1 ? [id] : p.includes(id) ? p.filter((x) => x !== id) : p.length < max ? [...p, id] : p));
  return (
    <>
      <p className="fr-engage-form__hint">{max === 1 ? 'Pick one' : `Pick up to ${max}`}</p>
      <ul className="fr-engage-form__choices" role={max === 1 ? 'radiogroup' : 'group'}>
        {a.options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              className="fr-engage-form__choice"
              role={max === 1 ? 'radio' : 'checkbox'}
              aria-checked={picked.includes(o.id)}
              onClick={() => toggle(o.id)}
            >
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

function WordsForm({ mine, onSubmit, busy }: { mine: ActivityAnswer | null; onSubmit: (ans: ActivityAnswer) => void; busy: boolean }) {
  const [words, setWords] = useState<string[]>(() => {
    const w = [...(mine?.words ?? [])];
    while (w.length < ENGAGE_MAX_WORDS) w.push('');
    return w;
  });
  const filled = words.map((w) => w.trim()).filter(Boolean);
  return (
    <form
      className="fr-engage-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (filled.length) onSubmit({ words: filled });
      }}
    >
      <p className="fr-engage-form__hint">Up to {ENGAGE_MAX_WORDS} words or short phrases</p>
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

function RankForm({ a, mine, onSubmit, busy }: { a: ActivityElement; mine: ActivityAnswer | null; onSubmit: (ans: ActivityAnswer) => void; busy: boolean }) {
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
      <p className="fr-engage-form__hint">Most important at the top</p>
      <ol className="fr-engage-form__choices">
        {order.map((id, i) => (
          <li key={id} className="fr-engage-form__rank">
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

function RateForm({ a, mine, onSubmit, busy }: { a: ActivityElement; mine: ActivityAnswer | null; onSubmit: (ans: ActivityAnswer) => void; busy: boolean }) {
  const scale = a.scale ?? 5;
  const [ratings, setRatings] = useState<Record<string, number>>(mine?.ratings ?? {});
  return (
    <>
      <p className="fr-engage-form__hint">1 = not at all, {scale} = completely</p>
      <ul className="fr-engage-form__choices">
        {a.options.map((o) => (
          <li key={o.id}>
            <div>{o.text || 'Untitled statement'}</div>
            <div className="fr-engage-form__scale" role="radiogroup" aria-label={o.text}>
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

function QnaForm({ editor, a, state, setState }: { editor: Editor; a: ActivityElement; state: ActivityState; setState: (s: ActivityState) => void }) {
  const canEdit = useCanEdit();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const engage = editor.host.engage!;
  const run = async (fn: () => Promise<ActivityState>) => {
    setError(null);
    try {
      setState(await fn());
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
    if (await run(() => engage.ask(a.id, text.trim()))) setText('');
    setBusy(false);
  };
  const questions = state.results?.questions ?? [];
  return (
    <>
      {state.canAnswer ? (
        <form className="fr-engage-form__row" onSubmit={ask}>
          <Input aria-label="Your question" placeholder="Ask a question" value={text} maxLength={ENGAGE_MAX_QUESTION} autoFocus onChange={(e) => setText(e.target.value)} />
          <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()}>
            Ask
          </Button>
        </form>
      ) : null}
      <p className="fr-engage-form__hint">{a.anonymous ? 'Questions are anonymous.' : 'Your name is shown with your question.'}</p>
      {error ? <p className="fr-engage-form__error" role="alert">{error}</p> : null}
      {state.results?.sealed ? <p className="fr-engage-form__hint">Questions show once the host reveals them.</p> : null}
      <ul className="fr-engage-form__choices">
        {questions.map((q) => {
          const on = state.myUpvotes.includes(q.id);
          return (
            <li key={q.id} className={`fr-engage-form__q${q.answered ? ' is-answered' : ''}`}>
              <button
                type="button"
                className="fr-engage-form__upvote"
                aria-pressed={on}
                aria-label={on ? `Remove your upvote (${q.votes})` : `Upvote (${q.votes})`}
                disabled={!state.canAnswer}
                onClick={() => void run(() => engage.upvote(a.id, q.id, !on))}
              >
                <ThumbsUp size={14} aria-hidden /> {q.votes}
              </button>
              <span>
                {q.text}
                <br />
                <small>{q.answered ? 'Answered' : q.by ?? 'Anonymous'}</small>
              </span>
              {canEdit ? (
                <>
                  <IconButton size={32} icon={Check} label={q.answered ? 'Mark as not answered' : 'Mark as answered'} active={q.answered} onClick={() => void run(() => engage.moderate(a.id, q.id, { answered: !q.answered }))} />
                  <IconButton size={32} icon={EyeOff} label="Hide from the board" onClick={() => void run(() => engage.moderate(a.id, q.id, { hidden: true }))} />
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function AnswerDialog({ editor, props }: PanelProps) {
  const id = typeof props?.id === 'string' ? props.id : '';
  const a = useElement(id) as ActivityElement | undefined;
  const close = () => editor.closePanel(ANSWER_DIALOG);
  const [state, setState, loadError] = useActivityState(editor, id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (!a || a.type !== 'activity') {
    return (
      <Modal open onClose={close} title="Activity">
        <p>This activity is no longer on the board.</p>
      </Modal>
    );
  }
  const submit = async (answer: ActivityAnswer) => {
    setBusy(true);
    setError(null);
    try {
      setState(await editor.host.engage!.answer(a.id, answer));
      setSent(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    try {
      setState(await editor.host.engage!.withdraw(a.id));
      setSent(false);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const question = richTextToPlain(a.question).trim() || 'Untitled activity';
  // Re-mount the form when the stored answer arrives, so it starts from it.
  const formKey = state ? JSON.stringify(state.mine) : 'loading';
  return (
    <Modal open onClose={close} title={kindLabel(a.kind)} width={480}>
      <div className="fr-engage-form" data-testid="engage-answer">
        <p className="fr-engage-form__question">{question}</p>
        {loadError ? <p className="fr-engage-form__error" role="alert">{loadError}</p> : null}
        {state && !state.canAnswer && a.kind !== 'qna' ? <p className="fr-engage-form__hint">{state.reason}</p> : null}
        {state && a.kind === 'qna' ? <QnaForm editor={editor} a={a} state={state} setState={setState} /> : null}
        {state && state.canAnswer && a.kind !== 'qna' ? (
          <div key={formKey} className="fr-engage-form">
            {a.kind === 'poll' ? <PollForm a={a} mine={state.mine} onSubmit={submit} busy={busy} /> : null}
            {a.kind === 'wordcloud' ? <WordsForm mine={state.mine} onSubmit={submit} busy={busy} /> : null}
            {a.kind === 'ranking' ? <RankForm a={a} mine={state.mine} onSubmit={submit} busy={busy} /> : null}
            {a.kind === 'rating' ? <RateForm a={a} mine={state.mine} onSubmit={submit} busy={busy} /> : null}
          </div>
        ) : null}
        {error ? <p className="fr-engage-form__error" role="alert">{error}</p> : null}
        {sent ? <p className="fr-engage-form__hint" role="status">Thanks — your answer is in. You can change it any time.</p> : null}
        {state?.mine && state.canAnswer && a.kind !== 'qna' ? (
          <Button variant="ghost" size="sm" onClick={withdraw}>
            Take my answer back
          </Button>
        ) : null}
        <p className="fr-engage-form__hint">
          {a.kind === 'qna' ? '' : a.anonymous ? 'Anonymous: nobody sees who answered what.' : 'Open: your name may be shown with your answer.'}
          {a.results === 'reveal' && !state?.revealed ? ' Results show once the host reveals them.' : ''}
        </p>
      </div>
    </Modal>
  );
}

/** A new kind keeps what the editor wrote; starter text and missing options follow the kind. */
function switchKind(a: ActivityElement, kind: ActivityKind): Partial<ActivityElement> {
  const next = starter(kind, () => nanoid(8));
  const untouched = richTextToPlain(a.question).trim() === starter(a.kind, () => '').question;
  return {
    kind,
    ...(untouched ? { question: plainToRichText(next.question) } : {}),
    ...(usesOptions(kind) && a.options.length < 2 ? { options: next.options } : {}),
  };
}

function SettingsDialog({ editor, props }: PanelProps) {
  const id = typeof props?.id === 'string' ? props.id : '';
  const a = useElement(id) as ActivityElement | undefined;
  const close = () => editor.closePanel(SETTINGS_DIALOG);
  if (!a || a.type !== 'activity') return null;
  const set = (patch: Partial<ActivityElement>) => editor.update<ActivityElement>(a.id, patch);
  const setOptions = (options: ActivityElement['options']) => set({ options });
  return (
    <Modal open onClose={close} title={`${kindLabel(a.kind)} settings`} width={520} footer={<Button variant="primary" onClick={close}>Done</Button>}>
      <div className="fr-engage-form">
        <span className="fr-engage-form__label">Kind</span>
        <Select<ActivityKind> aria-label="Kind" options={KINDS.map((k) => ({ value: k.value, label: k.label, description: k.hint }))} value={a.kind} onChange={(kind) => set(switchKind(a, kind))} />
        {usesOptions(a.kind) ? (
          <>
            <span className="fr-engage-form__label">{a.kind === 'poll' ? 'Choices' : a.kind === 'ranking' ? 'Items to rank' : 'Statements to rate'}</span>
            {a.options.map((o, i) => (
              <div key={o.id} className="fr-engage-form__row">
                <Input
                  aria-label={`Option ${i + 1}`}
                  value={o.text}
                  maxLength={120}
                  onChange={(e) => setOptions(a.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))}
                />
                <IconButton size={32} icon={Trash2} label="Remove" disabled={a.options.length <= 2} onClick={() => setOptions(a.options.filter((x) => x.id !== o.id))} />
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              disabled={a.options.length >= ENGAGE_MAX_OPTIONS}
              onClick={() => setOptions([...a.options, { id: nanoid(8), text: `Option ${a.options.length + 1}` }])}
            >
              Add
            </Button>
          </>
        ) : null}
        {a.kind === 'poll' ? (
          <Toggle label="People may pick several" checked={(a.maxChoices ?? 1) > 1} onChange={(on) => set({ maxChoices: on ? Math.max(2, a.options.length) : 1 })} />
        ) : null}
        {a.kind === 'rating' ? (
          <SegmentedControl<'5' | '10'>
            aria-label="Scale"
            options={[
              { value: '5', label: '1–5' },
              { value: '10', label: '1–10' },
            ]}
            value={(a.scale ?? 5) === 10 ? '10' : '5'}
            onChange={(v) => set({ scale: Number(v) })}
          />
        ) : null}
        <Toggle label="Anonymous (names are never shown with answers)" checked={a.anonymous} onChange={(anonymous) => set({ anonymous })} />
        <Toggle label="Hide results until I reveal them" checked={a.results === 'reveal'} onChange={(on) => set({ results: on ? 'reveal' : 'live' })} />
        <Toggle label="Visitors without an account can answer" checked={a.guests} onChange={(guests) => set({ guests })} />
        <Toggle label="Answers are closed" checked={!!a.closed} onChange={(closed) => set({ closed })} />
      </div>
    </Modal>
  );
}

export default [
  definePanel({ id: ANSWER_DIALOG, slot: 'dialog', order: 60, minRole: 'viewer', Component: AnswerDialog }),
  definePanel({ id: SETTINGS_DIALOG, slot: 'dialog', order: 61, minRole: 'editor', Component: SettingsDialog }),
];
