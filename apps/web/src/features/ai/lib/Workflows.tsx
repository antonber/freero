// Saved AI workflows (#1): named instructions for the board assistant, kept by a person and
// optionally shared with the board's workspace, run from the board menu. A run never writes the
// board: what it changes arrives as pending suggestions (accepting them is the suggestions
// feature's ordinary edit); this dialog only lists, edits and starts them.
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Play, Plus, Trash2, Users } from 'lucide-react';
import { AI_WORKFLOW_LIMITS, type AiWorkflow, type AiWorkflowList, type AiWorkflowScope } from '@freero/shared';
import type { Editor, PanelProps } from '@engine';
import { Button, IconButton, Input, Modal, SegmentedControl, Spinner, TextArea, Toggle } from '@ui';
import { t } from '../messages';

export const WORKFLOWS_DIALOG = 'ai.workflows';

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : t('theAssistantCouldnTAnswer'));

interface Draft {
  id: string | null;
  name: string;
  prompt: string;
  scope: AiWorkflowScope;
  shared: boolean;
}

function WorkflowForm({ draft, shareWith, busy, onChange, onCancel, onSave }: { draft: Draft; shareWith: AiWorkflowList['shareWith']; busy: boolean; onChange(d: Draft): void; onCancel(): void; onSave(): void }) {
  return (
    <form
      className="fr-ai-wf__form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <Input label={t('workflowName')} value={draft.name} maxLength={AI_WORKFLOW_LIMITS.name} placeholder={t('workflowNamePlaceholder')} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      <TextArea
        label={t('whatShouldItDo')}
        rows={4}
        value={draft.prompt}
        maxLength={AI_WORKFLOW_LIMITS.prompt}
        placeholder={t('workflowPromptPlaceholder')}
        onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
      />
      <SegmentedControl<AiWorkflowScope>
        aria-label={t('runsOn')}
        size="sm"
        value={draft.scope}
        onChange={(scope) => onChange({ ...draft, scope })}
        options={[
          { value: 'board', label: t('theWholeBoard') },
          { value: 'selection', label: t('theSelectedItems') },
        ]}
      />
      {shareWith && <Toggle checked={draft.shared} onChange={(shared) => onChange({ ...draft, shared })} label={t('shareWithWorkspace', { name: shareWith.name })} />}
      <div className="fr-ai-wf__form-actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!draft.name.trim() || !draft.prompt.trim()}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

function Row({ w, onRun, onEdit, onDelete, onUnshare, running }: { w: AiWorkflow; running: boolean; onRun(): void; onEdit(): void; onDelete(): void; onUnshare(): void }) {
  return (
    <li className="fr-ai-wf__row">
      <div className="fr-ai-wf__main">
        <p className="fr-ai-wf__name">{w.name}</p>
        <p className="fr-ai-wf__meta">
          {w.scope === 'selection' ? t('onTheSelectedItems') : t('onTheWholeBoard')}
          {w.workspaceId ? (
            <>
              {' · '}
              <Users size={12} aria-hidden /> {w.mine ? t('shared') : t('sharedByName', { name: w.ownerName })}
            </>
          ) : null}
        </p>
        <p className="fr-ai-wf__prompt">{w.prompt}</p>
      </div>
      <div className="fr-ai-wf__actions">
        <Button size="sm" variant="primary" icon={Play} loading={running} onClick={onRun}>
          {t('run')}
        </Button>
        {w.mine && <IconButton size={32} icon={Pencil} label={t('editWorkflow')} onClick={onEdit} />}
        {w.mine && <IconButton size={32} icon={Trash2} label={t('deleteWorkflow')} onClick={onDelete} />}
        {!w.mine && w.canUnshare && (
          <Button size="sm" variant="ghost" onClick={onUnshare}>
            {t('stopSharing')}
          </Button>
        )}
      </div>
    </li>
  );
}

export function WorkflowsDialog({ editor }: PanelProps) {
  const host = editor.host.assistant?.workflows;
  const [list, setList] = useState<AiWorkflowList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AiWorkflow | null>(null);
  const close = () => editor.closePanel(WORKFLOWS_DIALOG);

  const reload = useCallback(() => {
    host?.list().then(setList, (e: unknown) => (setList({ workflows: [], shareWith: null }), setError(message(e))));
  }, [host]);
  useEffect(reload, [reload]);
  if (!host) return null;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const save = (d: Draft) =>
    act(async () => {
      const input = { name: d.name.trim(), prompt: d.prompt.trim(), scope: d.scope, shared: d.shared };
      if (d.id) await host.update(d.id, input);
      else await host.create(input);
      setDraft(null);
      reload();
    });

  const run = async (w: AiWorkflow) => {
    if (running) return;
    const ids = editor.getSelection();
    if (w.scope === 'selection' && !ids.length) return setError(t('selectItemsFirst'));
    setRunning(w.id);
    setError(null);
    try {
      const r = await host.run(w.id, ids);
      close();
      if (r.proposal) editor.host.notify(t('workflowProposedCount', { name: w.name, count: r.proposal.count }), 'success', { action: { label: t('review'), run: () => editor.runCommand('suggestions.open') } });
      else editor.host.notify(r.proposalError ? t('couldnTProposeThatReason', { reason: r.proposalError }) : t('workflowNothingToChange', { name: w.name, answer: r.answer.slice(0, 200) }), 'info');
    } catch (e) {
      setError(message(e));
    } finally {
      setRunning(null);
    }
  };

  return (
    <Modal open onClose={close} title={t('aiWorkflows')} description={t('aiWorkflowsIntro')} width={560}>
      <div className="fr-ai-wf">
        {error && (
          <p className="fr-ai__error" role="alert">
            {error}
          </p>
        )}
        {draft ? (
          <WorkflowForm draft={draft} shareWith={list?.shareWith ?? null} busy={busy} onChange={setDraft} onCancel={() => setDraft(null)} onSave={() => void save(draft)} />
        ) : list === null ? (
          <div className="fr-ai-wf__loading">
            <Spinner />
          </div>
        ) : (
          <>
            {list.workflows.length ? (
              <ul className="fr-ai-wf__list">
                {list.workflows.map((w) => (
                  <Row
                    key={w.id}
                    w={w}
                    running={running === w.id}
                    onRun={() => void run(w)}
                    onEdit={() => setDraft({ id: w.id, name: w.name, prompt: w.prompt, scope: w.scope, shared: w.workspaceId !== null })}
                    onDelete={() => setConfirmDelete(w)}
                    onUnshare={() => void act(async () => (await host.update(w.id, { shared: false }), reload()))}
                  />
                ))}
              </ul>
            ) : (
              <p className="fr-ai__hint">{t('noWorkflowsYet')}</p>
            )}
            <Button variant="secondary" icon={Plus} onClick={() => setDraft({ id: null, name: '', prompt: '', scope: editor.getSelection().length ? 'selection' : 'board', shared: false })}>
              {t('newWorkflow')}
            </Button>
          </>
        )}
        <p className="fr-ai__fine">{t('workflowsOnlyPropose')}</p>
      </div>
      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          title={t('deleteName', { name: confirmDelete.name })}
          description={confirmDelete.workspaceId ? t('deleteSharedWorkflow') : undefined}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() =>
                  void act(async () => {
                    await host.remove(confirmDelete.id);
                    setConfirmDelete(null);
                    reload();
                  })
                }
              >
                {t('delete')}
              </Button>
            </>
          }
        />
      )}
    </Modal>
  );
}

/** Whether saved workflows can be run here: the assistant may propose (the person can edit) and the host has them. */
export const workflowsHere = (editor: Editor): boolean => !!editor.host.assistant?.canPropose && !!editor.host.assistant.workflows;
