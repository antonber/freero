// Retro mode UI: the start dialog and the stepper bar (top-center). The facilitator moves the
// retro along; everyone sees which step it is in and what to do now.
import { useMemo, useState } from 'react';
import { ArrowRight, Check, History, LayoutGrid, ListPlus, X } from 'lucide-react';
import { definePanel, useCollection, type Editor } from '@engine';
import { Button, Modal, SegmentedControl, Toggle } from '@ui';
import { addAction, advance, canManage, clusterAll, end, FORMATS, PHASES, readSession, RETRO_COLLECTION, start, START_DIALOG_ID, type RetroSession } from './lib/flow';
import './retro.css';

function useSession(): RetroSession | undefined {
  const entries = useCollection<RetroSession>(RETRO_COLLECTION);
  return useMemo(() => readSession(entries.find(([k]) => k === 'session')?.[1]), [entries]);
}

function StartDialog({ editor }: { editor: Editor }) {
  const close = () => editor.closePanel(START_DIALOG_ID);
  const empty = editor.getElements().length === 0;
  const [format, setFormat] = useState<string | null>(empty ? FORMATS[0].id : null);
  const [minutes, setMinutes] = useState('5');
  const [votes, setVotes] = useState('3');
  const [stickiesOnly, setStickiesOnly] = useState(true);
  const submit = () => {
    start(editor, { template: format, minutes: Number(minutes), votes: Number(votes), stickiesOnly });
    close();
  };
  return (
    <Modal
      open
      onClose={close}
      title="Run a retrospective"
      description="Five steps: write on your own, reveal and group, vote, discuss, agree on actions. You move everyone along."
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon={History} onClick={submit}>
            Start writing
          </Button>
        </>
      }
    >
      <form
        className="fr-retro-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset className="fr-retro-formats">
          <legend>Format</legend>
          {FORMATS.map((f) => (
            <label key={f.id ?? 'board'} className={`fr-retro-formats__opt${format === f.id ? ' is-on' : ''}`}>
              <input type="radio" name="fr-retro-format" checked={format === f.id} onChange={() => setFormat(f.id)} />
              <span>{f.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="fr-retro-form__row">
          <span>Writing time</span>
          <SegmentedControl
            size="sm"
            aria-label="Writing time"
            value={minutes}
            onChange={setMinutes}
            options={[
              { value: '3', label: '3 min' },
              { value: '5', label: '5 min' },
              { value: '10', label: '10 min' },
            ]}
          />
        </div>
        <div className="fr-retro-form__row">
          <span>Votes per person</span>
          <SegmentedControl
            size="sm"
            aria-label="Votes per person"
            value={votes}
            onChange={setVotes}
            options={[
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '5', label: '5' },
            ]}
          />
        </div>
        <Toggle label="Participants add only stickies until the action step" checked={stickiesOnly} onChange={setStickiesOnly} />
      </form>
    </Modal>
  );
}

function StepperBar({ editor }: { editor: Editor }) {
  const session = useSession();
  if (!session) return null;
  const at = PHASES.findIndex((p) => p.id === session.phase);
  const phase = PHASES[at];
  const manage = canManage(editor, session);
  return (
    <div className="fr-retro-bar" data-fr-interactive="" role="region" aria-label="Retrospective">
      <ol className="fr-retro-steps" aria-label="Steps">
        {PHASES.map((p, i) => (
          <li key={p.id} className={i < at ? 'is-done' : i === at ? 'is-current' : undefined} aria-current={i === at ? 'step' : undefined}>
            <span className="fr-retro-steps__dot">{i < at ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
            {p.label}
          </li>
        ))}
      </ol>
      <div className="fr-retro-bar__row">
        <span className="fr-retro-bar__hint">
          {phase.hint}
          {!manage && ` ${session.startedByName} moves to the next step.`}
        </span>
        {manage && session.phase === 'group' && (
          <Button size="sm" variant="ghost" icon={LayoutGrid} onClick={() => clusterAll(editor)}>
            Cluster by colour
          </Button>
        )}
        {session.phase === 'act' && (
          <Button size="sm" variant={manage ? 'ghost' : 'primary'} icon={ListPlus} onClick={() => addAction(editor)}>
            Add action item{session.actionIds.length ? ` (${session.actionIds.length})` : ''}
          </Button>
        )}
        {manage && phase.next && (
          <Button size="sm" variant="primary" iconRight={ArrowRight} onClick={() => advance(editor)}>
            {phase.next}
          </Button>
        )}
        {manage && (
          <Button size="sm" variant={phase.next ? 'ghost' : 'primary'} icon={phase.next ? X : Check} onClick={() => end(editor)}>
            {phase.next ? 'End' : 'Finish retro'}
          </Button>
        )}
      </div>
    </div>
  );
}

export default [
  definePanel({ id: 'retro.bar', slot: 'top-center', order: 1, Component: StepperBar }),
  definePanel({ id: START_DIALOG_ID, slot: 'dialog', order: 50, Component: StartDialog }),
];
