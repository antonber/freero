// Retro mode UI: the start dialog and the stepper bar (top-center). The facilitator moves the
// retro along; everyone sees which step it is in and what to do now.
import { useMemo, useState } from 'react';
import { ArrowRight, Check, History, LayoutGrid, ListPlus, X } from 'lucide-react';
import { definePanel, useCollection, type Editor } from '@engine';
import { Button, Modal, SegmentedControl, Toggle } from '@ui';
import { addAction, advance, canManage, clusterAll, end, FORMATS, PHASES, readSession, RETRO_COLLECTION, start, START_DIALOG_ID, type RetroSession } from './lib/flow';
import { t } from './messages';
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
      title={t('runARetrospective2')}
      description={t('fiveStepsWriteOnYour')}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" icon={History} onClick={submit}>{t('startWriting')}</Button>
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
          <legend>{t('format')}</legend>
          {FORMATS.map((f) => (
            <label key={f.id ?? 'board'} className={`fr-retro-formats__opt${format === f.id ? ' is-on' : ''}`}>
              <input type="radio" name="fr-retro-format" checked={format === f.id} onChange={() => setFormat(f.id)} />
              <span>{f.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="fr-retro-form__row">
          <span>{t('writingTime')}</span>
          <SegmentedControl
            size="sm"
            aria-label={t('writingTime')}
            value={minutes}
            onChange={setMinutes}
            options={[
              { value: '3', label: t('n3Min') },
              { value: '5', label: t('n5Min') },
              { value: '10', label: t('n10Min') },
            ]}
          />
        </div>
        <div className="fr-retro-form__row">
          <span>{t('votesPerPerson')}</span>
          <SegmentedControl
            size="sm"
            aria-label={t('votesPerPerson')}
            value={votes}
            onChange={setVotes}
            options={[
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '5', label: '5' },
            ]}
          />
        </div>
        <Toggle label={t('participantsAddOnlyStickiesUntil')} checked={stickiesOnly} onChange={setStickiesOnly} />
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
    <div className="fr-retro-bar" data-fr-interactive="" role="region" aria-label={t('retrospective')}>
      <ol className="fr-retro-steps" aria-label={t('steps')}>
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
          {!manage && t('startedbynameMovesToTheNext', { startedByName: session.startedByName })}
        </span>
        {manage && session.phase === 'group' && (
          <Button size="sm" variant="ghost" icon={LayoutGrid} onClick={() => clusterAll(editor)}>{t('clusterByColour')}</Button>
        )}
        {session.phase === 'act' && (
          <Button size="sm" variant={manage ? 'ghost' : 'primary'} icon={ListPlus} onClick={() => addAction(editor)}>{t('addActionItem')}{session.actionIds.length ? ` (${session.actionIds.length})` : ''}
          </Button>
        )}
        {manage && phase.next && (
          <Button size="sm" variant="primary" iconRight={ArrowRight} onClick={() => advance(editor)}>
            {phase.next}
          </Button>
        )}
        {manage && (
          <Button size="sm" variant={phase.next ? 'ghost' : 'primary'} icon={phase.next ? X : Check} onClick={() => end(editor)}>
            {phase.next ? t('end') : t('finishRetro')}
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
