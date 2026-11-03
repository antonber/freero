// Two dialogs of live activities (KAI-132): answering one (anyone on the board, guests when the
// activity allows it — answers go to the server, never into the board) and setting one up (editors).
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { ENGAGE_MAX_OPTIONS, type ActivityElement, type ActivityKind, type ActivityState } from '@freero/shared';
import { definePanel, plainToRichText, richTextToPlain, useCanEdit, useElement, type Editor, type HostEngage, type PanelProps } from '@engine';
import { ActivityForm, Button, IconButton, Input, Modal, SegmentedControl, Select, Toggle, type ActivityActions } from '@ui';
import { ANSWER_DIALOG, KINDS, LINK_DIALOG, SETTINGS_DIALOG, STAGE_DIALOG, activityInfo, kindLabel, starter, usesOptions } from './lib/activity';
import { LinkDialog } from './lib/LinkDialog';
import { Stage } from './lib/Stage';
import './engage.css';

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** Answering through the board's server (Host.engage); moderation only for those who run activities. */
function activityActions(engage: HostEngage, id: string, canRun: boolean): ActivityActions {
  return {
    answer: (answer) => engage.answer(id, answer),
    withdraw: () => engage.withdraw(id),
    ask: (text) => engage.ask(id, text),
    upvote: (qid, on) => engage.upvote(id, qid, on),
    ...(canRun ? { moderate: (qid: string, patch: { answered?: boolean; hidden?: boolean }) => engage.moderate(id, qid, patch) } : {}),
  };
}

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

function AnswerDialog({ editor, props }: PanelProps) {
  const id = typeof props?.id === 'string' ? props.id : '';
  const a = useElement(id) as ActivityElement | undefined;
  const canEdit = useCanEdit();
  const close = () => editor.closePanel(ANSWER_DIALOG);
  const [state, setState, loadError] = useActivityState(editor, id);
  if (!a || a.type !== 'activity') {
    return (
      <Modal open onClose={close} title="Activity">
        <p>This activity is no longer on the board.</p>
      </Modal>
    );
  }
  const engage = editor.host.engage;
  return (
    <Modal open onClose={close} title={kindLabel(a.kind)} width={480}>
      {loadError ? (
        <p className="fr-actform__error" role="alert">
          {loadError}
        </p>
      ) : null}
      {state && engage ? <ActivityForm activity={activityInfo(a)} state={state} onState={setState} actions={activityActions(engage, a.id, canEdit)} /> : null}
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
  definePanel({ id: LINK_DIALOG, slot: 'dialog', order: 62, minRole: 'viewer', Component: LinkDialog }),
  definePanel({ id: STAGE_DIALOG, slot: 'dialog', order: 63, minRole: 'viewer', Component: Stage }),
];
