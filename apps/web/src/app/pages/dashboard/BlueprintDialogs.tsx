// Blueprints (#161): save a project's boards and docs as a reusable setup, and start a new project
// from one. The server makes the copies (one transaction) and decides who may see and use what.
import { useEffect, useState } from 'react';
import { FileText, LayoutGrid, Share2, Trash2 } from 'lucide-react';
import { BLUEPRINT_MAX_ITEMS, type BlueprintSummary, type ProjectSummary, type WorkspaceSummary } from '@freero/shared';
import { Button, IconButton, Input, Modal, Spinner, TextArea, Toggle, useToast } from '@ui';
import { api, ApiError } from '../../api/client';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function SaveBlueprintDialog({ project, workspace, onClose }: { project: ProjectSummary; workspace: WorkspaceSummary; onClose: () => void }) {
  const notify = useToast();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [steps, setSteps] = useState('');
  const [share, setShare] = useState(workspace.kind === 'team');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) return setError('Give the blueprint a name');
    setBusy(true);
    try {
      const { blueprint } = await api.saveBlueprint(project.id, {
        name: name.trim(),
        description,
        steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
        workspaceId: share && workspace.kind === 'team' ? workspace.id : null,
      });
      notify(`Saved “${blueprint.name}” with ${blueprint.items.length} ${blueprint.items.length === 1 ? 'board' : 'boards and docs'}`, 'success');
      onClose();
    } catch (e) {
      setError(errorText(e, 'Could not save the blueprint'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Save as blueprint"
      width={480}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save blueprint
          </Button>
        </>
      }
    >
      <div className="fr-dash-projdlg">
        <p className="fr-dash-projdlg__hint">
          The boards and docs of “{project.name}” (up to {BLUEPRINT_MAX_ITEMS}) are saved as they are now, without their comments. Anyone you share it with can start a new
          project from it, with copies of each.
        </p>
        <Input aria-label="Blueprint name" placeholder="Blueprint name" value={name} maxLength={80} autoFocus onChange={(e) => (setName(e.target.value), setError(null))} error={error ?? undefined} />
        <TextArea aria-label="What it is for" placeholder="What it is for" value={description} rows={3} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
        <TextArea aria-label="Steps, one per line" placeholder={'Steps, one per line\ne.g. Fill in the plan\nRun the kickoff'} value={steps} rows={4} onChange={(e) => setSteps(e.target.value)} />
        {workspace.kind === 'team' ? <Toggle label={`Share with ${workspace.name}`} checked={share} onChange={setShare} /> : null}
      </div>
    </Modal>
  );
}

export function UseBlueprintDialog({
  workspace,
  parent,
  onClose,
  onCreated,
}: {
  workspace: WorkspaceSummary;
  /** Where the new project goes (a sub-project), null for the top. */
  parent: ProjectSummary | null;
  onClose: () => void;
  onCreated: (project: ProjectSummary) => void;
}) {
  const notify = useToast();
  const [list, setList] = useState<BlueprintSummary[] | null>(null);
  const [chosen, setChosen] = useState<BlueprintSummary | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.listBlueprints().then(
      (r) => {
        if (!live) return;
        setList(r.blueprints);
        if (r.blueprints[0]) pick(r.blueprints[0]);
      },
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, []);
  const pick = (b: BlueprintSummary) => {
    setChosen(b);
    setName(b.name);
  };
  const create = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const { project, boards } = await api.useBlueprint(chosen.id, { workspaceId: workspace.id, name: name.trim() || chosen.name, parentId: parent?.id ?? null });
      notify(`Created “${project.name}” with ${boards.length} ${boards.length === 1 ? 'board' : 'boards and docs'}`, 'success');
      onCreated(project);
    } catch (e) {
      notify(errorText(e, 'Could not create the project'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (b: BlueprintSummary) => {
    try {
      await api.deleteBlueprint(b.id);
      setList((l) => l?.filter((x) => x.id !== b.id) ?? null);
      if (chosen?.id === b.id) setChosen(null);
    } catch (e) {
      notify(errorText(e, 'Could not delete the blueprint'), 'error');
    }
  };
  const unshare = async (b: BlueprintSummary) => {
    try {
      const { blueprint } = await api.updateBlueprint(b.id, { workspaceId: null });
      setList((l) => (blueprint.mine ? (l?.map((x) => (x.id === b.id ? blueprint : x)) ?? null) : (l?.filter((x) => x.id !== b.id) ?? null)));
    } catch (e) {
      notify(errorText(e, 'Could not stop sharing it'), 'error');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={parent ? `New sub-project of “${parent.name}” from a blueprint` : 'New project from a blueprint'}
      width={640}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!chosen} onClick={() => void create()}>
            Create project
          </Button>
        </>
      }
    >
      {list === null ? (
        <div className="fr-dash-bp__loading">
          <Spinner size={20} />
        </div>
      ) : list.length === 0 ? (
        <p className="fr-dash-projdlg__hint">No blueprints yet. Open a project’s menu and choose “Save as blueprint…” to make one from its boards and docs.</p>
      ) : (
        <div className="fr-dash-bp">
          <ul className="fr-dash-bp__list" aria-label="Blueprints">
            {list.map((b) => (
              <li key={b.id}>
                <button type="button" className={`fr-dash-bp__item${chosen?.id === b.id ? ' fr-dash-bp__item--on' : ''}`} aria-pressed={chosen?.id === b.id} onClick={() => pick(b)}>
                  <span className="fr-dash-bp__name">{b.name}</span>
                  <span className="fr-dash-bp__meta">
                    {b.items.length} {b.items.length === 1 ? 'item' : 'items'} · {b.mine ? 'yours' : b.ownerName}
                    {b.workspaceId ? ' · shared' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {chosen ? (
            <div className="fr-dash-bp__detail">
              {chosen.description ? <p className="fr-dash-projpage__desc">{chosen.description}</p> : null}
              {chosen.steps.length ? (
                <ol className="fr-dash-bp__steps">
                  {chosen.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              ) : null}
              <ul className="fr-dash-bp__items" aria-label="What it makes">
                {chosen.items.map((i, k) => (
                  <li key={k}>
                    {i.kind === 'doc' ? <FileText size={14} aria-hidden /> : <LayoutGrid size={14} aria-hidden />} {i.title || 'Untitled'}
                  </li>
                ))}
              </ul>
              <Input aria-label="New project name" placeholder="New project name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              {chosen.mine || chosen.canUnshare ? (
                <div className="fr-dash-projpage__tools">
                  {chosen.canUnshare ? (
                    <Button size="sm" variant="ghost" icon={Share2} onClick={() => void unshare(chosen)}>
                      Stop sharing
                    </Button>
                  ) : null}
                  {chosen.mine ? <IconButton icon={Trash2} label="Delete blueprint" size={32} onClick={() => void remove(chosen)} /> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
