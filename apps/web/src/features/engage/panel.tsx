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
import { QuizEditor } from './lib/QuizEditor';
import { t } from './messages';
import './engage.css';

const errorText = (e: unknown) => (e instanceof Error ? e.message : t('somethingWentWrong'));

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

function useActivityState(editor: Editor, id: string, version = ''): [ActivityState | null, (s: ActivityState) => void, string | null] {
  const [state, setState] = useState<ActivityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!editor.host.engage) {
      setError(t('activitiesNeedABoardOn'));
      return;
    }
    editor.host.engage.state(id).then(
      (s) => !cancelled && setState(s),
      (e) => !cancelled && setError(errorText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [editor, id, version]);
  return [state, setState, error];
}

function AnswerDialog({ editor, props }: PanelProps) {
  const id = typeof props?.id === 'string' ? props.id : '';
  const a = useElement(id) as ActivityElement | undefined;
  const canEdit = useCanEdit();
  const close = () => editor.closePanel(ANSWER_DIALOG);
  // A quiz moving on, or answers opening / closing, changes what this person may do: ask again.
  const [state, setState, loadError] = useActivityState(editor, id, `${a?.quiz?.step}:${a?.quiz?.openedAt}:${a?.quiz?.showAnswer}:${a?.closed}:${a?.guests}`);
  if (!a || a.type !== 'activity') {
    return (
      <Modal open onClose={close} title={t('activity')}>
        <p>{t('thisActivityIsNoLonger')}</p>
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
    // What the new kind needs and the activity doesn't have yet (axes, quiz questions).
    ...Object.fromEntries(Object.entries(next.extra).filter(([k]) => a[k as keyof ActivityElement] === undefined || k === 'results' || k === 'anonymous')),
  };
}

/** A 2×2 matrix's axes (#147): what each end of the across and up axes means. */
function AxesFields({ a, set }: { a: ActivityElement; set: (patch: Partial<ActivityElement>) => void }) {
  const ax = a.axes ?? { x: ['Low', 'High'], y: ['Low', 'High'] };
  const field = (axis: 'x' | 'y', end: 0 | 1, label: string) => (
    <Input
      aria-label={label}
      placeholder={label}
      value={ax[axis][end]}
      maxLength={40}
      onChange={(e) => {
        const pair: [string, string] = [...ax[axis]];
        pair[end] = e.target.value;
        set({ axes: { ...ax, [axis]: pair } });
      }}
    />
  );
  return (
    <>
      <span className="fr-engage-form__label">{t('acrossLeftRight')}</span>
      <div className="fr-engage-form__row">
        {field('x', 0, t('leftEnd'))}
        {field('x', 1, t('rightEnd'))}
      </div>
      <span className="fr-engage-form__label">{t('upBottomTop')}</span>
      <div className="fr-engage-form__row">
        {field('y', 0, t('bottomEnd'))}
        {field('y', 1, t('topEnd'))}
      </div>
    </>
  );
}

function SettingsDialog({ editor, props }: PanelProps) {
  const id = typeof props?.id === 'string' ? props.id : '';
  const a = useElement(id) as ActivityElement | undefined;
  const close = () => editor.closePanel(SETTINGS_DIALOG);
  if (!a || a.type !== 'activity') return null;
  const set = (patch: Partial<ActivityElement>) => editor.update<ActivityElement>(a.id, patch);
  const setOptions = (options: ActivityElement['options']) => set({ options });
  return (
    <Modal open onClose={close} title={t('kindlabelSettings', { kindLabel: kindLabel(a.kind) })} width={520} footer={<Button variant="primary" onClick={close}>{t('done')}</Button>}>
      <div className="fr-engage-form">
        <span className="fr-engage-form__label">{t('kind')}</span>
        <Select<ActivityKind> aria-label={t('kind')} options={KINDS.map((k) => ({ value: k.value, label: k.label, description: k.hint }))} value={a.kind} onChange={(kind) => set(switchKind(a, kind))} />
        {usesOptions(a.kind) ? (
          <>
            <span className="fr-engage-form__label">
              {a.kind === 'poll' ? t('choices') : a.kind === 'ranking' ? t('itemsToRank') : a.kind === 'matrix' ? t('itemsToPlace') : t('statementsToRate')}
            </span>
            {a.options.map((o, i) => (
              <div key={o.id} className="fr-engage-form__row">
                <Input
                  aria-label={t('optionValue', { value: i + 1 })}
                  value={o.text}
                  maxLength={120}
                  onChange={(e) => setOptions(a.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))}
                />
                <IconButton size={32} icon={Trash2} label={t('remove')} disabled={a.options.length <= 2} onClick={() => setOptions(a.options.filter((x) => x.id !== o.id))} />
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              disabled={a.options.length >= ENGAGE_MAX_OPTIONS}
              onClick={() => setOptions([...a.options, { id: nanoid(8), text: t('optionValue', { value: a.options.length + 1 }) }])}
            >{t('add')}</Button>
          </>
        ) : null}
        {a.kind === 'matrix' ? <AxesFields a={a} set={set} /> : null}
        {a.kind === 'quiz' ? <QuizEditor editor={editor} a={a} /> : null}
        {a.kind === 'poll' ? (
          <Toggle label={t('peopleMayPickSeveral')} checked={(a.maxChoices ?? 1) > 1} onChange={(on) => set({ maxChoices: on ? Math.max(2, a.options.length) : 1 })} />
        ) : null}
        {a.kind === 'rating' ? (
          <SegmentedControl<'5' | '10'>
            aria-label={t('scale')}
            options={[
              { value: '5', label: '1–5' },
              { value: '10', label: '1–10' },
            ]}
            value={(a.scale ?? 5) === 10 ? '10' : '5'}
            onChange={(v) => set({ scale: Number(v) })}
          />
        ) : null}
        <Toggle label={t('anonymousNamesAreNeverShown')} checked={a.anonymous} onChange={(anonymous) => set({ anonymous })} />
        <Toggle
          label={a.kind === 'quiz' ? t('hideTheLeaderboardUntilI') : t('hideResultsUntilIReveal')}
          checked={a.results === 'reveal'}
          onChange={(on) => set({ results: on ? 'reveal' : 'live' })}
        />
        <Toggle label={t('visitorsWithoutAnAccountCan')} checked={a.guests} onChange={(guests) => set({ guests })} />
        <Toggle label={t('answersAreClosed')} checked={!!a.closed} onChange={(closed) => set({ closed })} />
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
