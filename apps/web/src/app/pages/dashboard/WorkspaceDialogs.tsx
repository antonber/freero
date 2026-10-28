// Dialogs of the dashboard's workspace features: new team workspace, project create/manage,
// board ownership transfer.
import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { BoardSummary, ProjectAccess, ProjectSummary, TeamAccess, WorkspaceSummary } from '@freero/shared';
import { Avatar, Button, IconButton, Input, Modal, Select, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function CreateWorkspaceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (w: WorkspaceSummary) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName('');
      setError(null);
    }
  }, [open]);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return setError('Give the workspace a name');
    setBusy(true);
    try {
      onCreated((await api.createWorkspace(name.trim())).workspace);
    } catch (err) {
      setError(errorText(err, 'Could not create the workspace'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New team workspace"
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => submit()}>
            Create workspace
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <p style={{ margin: '0 0 12px', color: 'var(--fr-ink-2)' }}>A shared home for your team’s boards. You’ll be its owner and can invite people next.</p>
        <Input
          aria-label="Workspace name"
          placeholder="e.g. Product team"
          value={name}
          maxLength={80}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
        />
      </form>
    </Modal>
  );
}

const ACCESS_OPTIONS: SelectOption<ProjectAccess>[] = [
  { value: 'workspace', label: 'Everyone in the workspace', description: 'Every member sees its boards' },
  { value: 'private', label: 'Private', description: 'Only people you add (and workspace admins)' },
];

const LEVEL_LABEL: Record<TeamAccess, string> = { editor: 'can edit', commenter: 'can comment', viewer: 'can view' };
/** '' = the workspace's level. */
const levelOptions = (workspaceLevel: TeamAccess): SelectOption<TeamAccess | ''>[] => [
  { value: '', label: `Workspace default (${LEVEL_LABEL[workspaceLevel]})` },
  { value: 'editor', label: 'Can edit' },
  { value: 'commenter', label: 'Can comment' },
  { value: 'viewer', label: 'Can view' },
];

type Person = { userId: string; name: string; color: string; avatarUrl: string | null };

/** New project (`project` null) or rename / access / people of an existing one. */
export function ProjectDialog({
  open,
  workspace,
  project,
  onClose,
  onSaved,
}: {
  open: boolean;
  workspace: WorkspaceSummary;
  project: ProjectSummary | null;
  onClose: () => void;
  onSaved: (p: ProjectSummary) => void;
}) {
  const notify = useToast();
  const [name, setName] = useState('');
  const [access, setAccess] = useState<ProjectAccess>('workspace');
  const [level, setLevel] = useState<TeamAccess | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [everyone, setEveryone] = useState<Person[]>([]);
  const [adding, setAdding] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setAccess(project?.access ?? 'workspace');
    setLevel(project?.teamAccess ?? '');
    setError(null);
    setAdding('');
    setPeople([]);
    if (project && workspace.kind === 'team') {
      api.listProjectMembers(project.id).then(({ members }) => setPeople(members), () => setPeople([]));
      api.listWorkspaceMembers(workspace.id).then(({ members }) => setEveryone(members), () => setEveryone([]));
    }
  }, [open, project, workspace]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return setError('Give the project a name');
    setBusy(true);
    try {
      const { project: saved } = project
        ? await api.updateProject(project.id, { name: name.trim(), access, teamAccess: level || null })
        : await api.createProject(workspace.id, name.trim(), access, level || null);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err, 'Could not save the project'));
    } finally {
      setBusy(false);
    }
  };

  const add = async (userId: string) => {
    if (!project) return;
    try {
      await api.addProjectMember(project.id, userId);
      const p = everyone.find((m) => m.userId === userId);
      if (p) setPeople((list) => [...list, p]);
      setAdding('');
    } catch (err) {
      notify(errorText(err, 'Could not add them'), 'error');
    }
  };

  const remove = async (userId: string) => {
    if (!project) return;
    try {
      await api.removeProjectMember(project.id, userId);
      setPeople((list) => list.filter((p) => p.userId !== userId));
    } catch (err) {
      notify(errorText(err, 'Could not remove them'), 'error');
    }
  };

  const candidates = everyone.filter((m) => !people.some((p) => p.userId === m.userId));
  const team = workspace.kind === 'team';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? 'Project settings' : 'New project'}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => submit()}>
            {project ? 'Save' : 'Create project'}
          </Button>
        </>
      }
    >
      <form className="fr-dash-projdlg" onSubmit={submit} noValidate>
        <Input
          aria-label="Project name"
          placeholder="Project name"
          value={name}
          maxLength={80}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
        />
        {team ? <Select<ProjectAccess> aria-label="Who can see it" options={ACCESS_OPTIONS} value={access} onChange={setAccess} /> : null}
        {team ? (
          <label className="fr-dash-projdlg__level">
            <span className="fr-dash-settings__label">{access === 'private' ? 'People in the project' : 'Members'} on its boards</span>
            <Select<TeamAccess | ''>
              aria-label="What members can do on its boards"
              options={levelOptions(workspace.policies.teamAccess)}
              value={level}
              onChange={setLevel}
              width={220}
            />
          </label>
        ) : null}
      </form>
      {project && team && access === 'private' ? (
        <div className="fr-dash-projdlg__people">
          <h3 className="fr-dash-settings__title">People in this project</h3>
          <ul className="fr-dash-members__list">
            {people.map((p) => (
              <li key={p.userId} className="fr-dash-members__row">
                <Avatar name={p.name} color={p.color} src={p.avatarUrl} size={28} />
                <span className="fr-dash-members__name">{p.name}</span>
                <div className="fr-dash-members__actions">
                  <IconButton size={32} icon={X} label={`Remove ${p.name} from the project`} tooltipSide="top" onClick={() => remove(p.userId)} />
                </div>
              </li>
            ))}
          </ul>
          {candidates.length > 0 ? (
            <Select<string>
              aria-label="Add someone to the project"
              options={[{ value: '', label: 'Add someone…', disabled: true }, ...candidates.map((m) => ({ value: m.userId, label: m.name }))]}
              value={adding}
              onChange={(v) => void add(v)}
            />
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * Hands a board to someone else: in a team workspace any member who isn't a guest; in a personal
 * workspace someone already invited to the board (it then moves to their personal workspace).
 */
export function TransferBoardDialog({
  board,
  workspace,
  onClose,
  onTransferred,
}: {
  board: BoardSummary | null;
  workspace: WorkspaceSummary | null;
  onClose: () => void;
  onTransferred: (b: BoardSummary) => void;
}) {
  const notify = useToast();
  const [candidates, setCandidates] = useState<Array<{ userId: string; name: string; email?: string }> | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const team = workspace?.kind === 'team' && board?.workspaceId === workspace.id;

  useEffect(() => {
    if (!board) return;
    setTarget('');
    setCandidates(null);
    const load = team
      ? api.listWorkspaceMembers(board.workspaceId).then(({ members }) => members.filter((m) => m.role !== 'guest'))
      : api.listMembers(board.id).then(({ members }) => members);
    load
      .then((list) => setCandidates(list.filter((m) => m.userId !== board.ownerId)))
      .catch(() => setCandidates([]));
  }, [board, team]);

  const submit = async () => {
    if (!board || !target) return;
    setBusy(true);
    try {
      const { board: updated } = await api.transferBoard(board.id, target);
      notify(`${updated.ownerName} now owns “${board.title || 'Untitled board'}”`, 'success');
      onTransferred(updated);
    } catch (err) {
      notify(errorText(err, 'Could not transfer the board'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!board}
      onClose={onClose}
      title="Transfer ownership"
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!target} onClick={submit}>
            Transfer
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', color: 'var(--fr-ink-2)' }}>
        {team
          ? 'Pick a member of this workspace. The current owner keeps edit access.'
          : 'Pick someone this board is shared with. It moves to their personal workspace; the current owner keeps edit access.'}
      </p>
      {candidates && candidates.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--fr-ink-3)' }}>{team ? 'Invite someone to the workspace first.' : 'Share the board with someone first.'}</p>
      ) : (
        <Select<string>
          aria-label="New owner"
          options={[{ value: '', label: candidates ? 'Choose the new owner' : 'Loading…', disabled: true }, ...(candidates ?? []).map((m) => ({ value: m.userId, label: m.name, description: m.email }))]}
          value={target}
          onChange={setTarget}
        />
      )}
    </Modal>
  );
}
