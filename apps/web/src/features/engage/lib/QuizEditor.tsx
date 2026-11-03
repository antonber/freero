// Setting up a quiz (#147): its questions and answers on the element (board content, editors), and
// which answers are right on the SERVER (Host.engage.setKey) — never in the board, where every
// participant's client could read them.
import { useEffect, useState } from 'react';
import { CircleCheck, Circle, Plus, Trash2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { ENGAGE_MAX_QUIZ_QUESTIONS, type ActivityElement, type QuizQuestion } from '@freero/shared';
import type { Editor } from '@engine';
import { Button, IconButton, Input, Select } from '@ui';
import { newQuizQuestion } from './activity';

const LIMITS = [
  { value: '0', label: 'No time limit' },
  { value: '10', label: '10 seconds' },
  { value: '20', label: '20 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '120', label: '2 minutes' },
];
const MAX_ANSWERS = 6;

export function QuizEditor({ editor, a }: { editor: Editor; a: ActivityElement }) {
  const engage = editor.host.engage;
  const [key, setKey] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    engage?.state(a.id).then(
      (s) => setKey(s.key ?? {}),
      () => undefined,
    );
  }, [engage, a.id]);
  const questions = a.questions ?? [];
  const setQuestions = (next: QuizQuestion[]) => editor.update<ActivityElement>(a.id, { questions: next });
  const patch = (qid: string, p: Partial<QuizQuestion>) => setQuestions(questions.map((q) => (q.id === qid ? { ...q, ...p } : q)));

  const toggleRight = async (q: QuizQuestion, optionId: string) => {
    const cur = key[q.id] ?? [];
    const right = cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId];
    const next = { ...key, [q.id]: right };
    setKey(next);
    // People may pick several only where several are right (that much is not a secret).
    if (!!q.multi !== right.length > 1) patch(q.id, { multi: right.length > 1 });
    if (!engage?.setKey) return setError('Right answers need a board on a Freero server.');
    try {
      setKey((await engage.setKey(a.id, next)).key ?? next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the right answers');
    }
  };

  return (
    <div className="fr-engage-quizedit">
      <p className="fr-engage-quizedit__note">Right answers stay on the server until you show them; nobody else can read them from the board.</p>
      {questions.map((q, qi) => (
        <fieldset key={q.id} className="fr-engage-quizedit__q">
          <legend>Question {qi + 1}</legend>
          <div className="fr-engage-form__row">
            <Input aria-label={`Question ${qi + 1}`} value={q.text} maxLength={200} onChange={(e) => patch(q.id, { text: e.target.value })} />
            <IconButton size={32} icon={Trash2} label="Remove question" disabled={questions.length <= 1} onClick={() => setQuestions(questions.filter((x) => x.id !== q.id))} />
          </div>
          {q.options.map((o, oi) => {
            const right = (key[q.id] ?? []).includes(o.id);
            return (
              <div key={o.id} className="fr-engage-quizedit__answer">
                <IconButton
                  size={32}
                  icon={right ? CircleCheck : Circle}
                  label={right ? 'Right answer (click to unmark)' : 'Mark as a right answer'}
                  active={right}
                  onClick={() => void toggleRight(q, o.id)}
                />
                <Input
                  aria-label={`Question ${qi + 1}, answer ${oi + 1}`}
                  value={o.text}
                  maxLength={120}
                  onChange={(e) => patch(q.id, { options: q.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
                />
                <IconButton size={32} icon={Trash2} label="Remove answer" disabled={q.options.length <= 2} onClick={() => patch(q.id, { options: q.options.filter((x) => x.id !== o.id) })} />
              </div>
            );
          })}
          <div className="fr-engage-form__row">
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              disabled={q.options.length >= MAX_ANSWERS}
              onClick={() => patch(q.id, { options: [...q.options, { id: nanoid(8), text: `Answer ${String.fromCharCode(65 + q.options.length)}` }] })}
            >
              Add answer
            </Button>
            <Select<string> aria-label={`Time limit of question ${qi + 1}`} options={LIMITS} value={String(q.seconds ?? 0)} onChange={(v) => patch(q.id, { seconds: Number(v) })} />
          </div>
          {!(key[q.id] ?? []).length ? <p className="fr-engage-quizedit__warn">Mark at least one right answer</p> : null}
        </fieldset>
      ))}
      <Button
        variant="ghost"
        size="sm"
        icon={Plus}
        disabled={questions.length >= ENGAGE_MAX_QUIZ_QUESTIONS}
        onClick={() => setQuestions([...questions, newQuizQuestion(() => nanoid(8), questions.length + 1)])}
      >
        Add question
      </Button>
      {error ? (
        <p className="fr-actform__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
