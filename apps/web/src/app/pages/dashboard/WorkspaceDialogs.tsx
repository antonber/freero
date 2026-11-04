// Dialogs of the dashboard's workspace features: new team workspace, project create/manage,
// board ownership transfer.
import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { BoardSummary, ProjectAccess, ProjectSummary, TeamAccess, WorkspaceGroup, WorkspaceSummary } from '@freero/shared';
import { Avatar, Button, IconButton, Input, Modal, Select, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';

import { t } from './messages';
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
    if (!name.trim()) return setError(t('giveTheWorkspaceAName'));
    setBusy(true);
    try {
      onCreated((await api.createWorkspace(name.trim())).workspace);
    } catch (err) {
      setError(errorText(err, t('couldNotCreateTheWorkspace')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('newTeamWorkspace2')}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={() => submit()}>{t('createWorkspace')}</Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <p style={{ margin: '0 0 12px', color: 'var(--fr-ink-2)' }}>{t('aSharedHomeForYour')}</p>
        <Input
          aria-label={t('workspaceName')}
          placeholder={t('eGProductTeam')}
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
  { value: 'workspace', label: t('everyoneInTheWorkspace'), description: t('everyMemberSeesItsBoards') },
  { value: 'private', label: t('private'), description: t('onlyPeopleYouAddAnd') },
];

const LEVEL_LABEL: Record<TeamAccess, string> = { editor: t('canEdit'), commenter: t('canComment'), viewer: t('canView') };
/** '' = the workspace's level. */
const levelOptions = (workspaceLevel: TeamAccess): SelectOption<TeamAccess | ''>[] => [
  { value: '', label: t('workspaceDefaultLevelLabel', { level_label: LEVEL_LABEL[workspaceLevel] }) },
  { value: 'editor', label: t('canEdit2') },
  { value: 'commenter', label: t('canComment2') },
  { value: 'viewer', label: t('canView2') },
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
  // #63: groups the project is shared with, and the workspace's groups to pick from.
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [allGroups, setAllGroups] = useState<WorkspaceGroup[]>([]);

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
      api.listProjectGroups(project.id).then((r) => setGroups(r.groups), () => setGroups([]));
      api.listGroups(workspace.id).then((r) => setAllGroups(r.groups), () => setAllGroups([]));
    }
  }, [open, project, workspace]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return setError(t('giveTheProjectAName'));
    setBusy(true);
    try {
      const { project: saved } = project
        ? await api.updateProject(project.id, { name: name.trim(), access, teamAccess: level || null })
        : await api.createProject(workspace.id, name.trim(), access, level || null);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err, t('couldNotSaveTheProject')));
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
      notify(errorText(err, t('couldNotAddThem')), 'error');
    }
  };

  const remove = async (userId: string) => {
    if (!project) return;
    try {
      await api.removeProjectMember(project.id, userId);
      setPeople((list) => list.filter((p) => p.userId !== userId));
    } catch (err) {
      notify(errorText(err, t('couldNotRemoveThem')), 'error');
    }
  };

  const shareWithGroup = async (groupId: string, shared: boolean) => {
    if (!project) return;
    try {
      setGroups((await api.setProjectGroup(project.id, groupId, shared)).groups);
    } catch (err) {
      notify(errorText(err, shared ? t('couldNotAddTheGroup') : t('couldNotRemoveTheGroup')), 'error');
    }
  };

  const candidates = everyone.filter((m) => !people.some((p) => p.userId === m.userId));
  const groupCandidates = allGroups.filter((g) => !groups.some((x) => x.id === g.id));
  const team = workspace.kind === 'team';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? t('projectSettings') : t('newProject')}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={() => submit()}>
            {project ? t('save') : t('createProject')}
          </Button>
        </>
      }
    >
      <form className="fr-dash-projdlg" onSubmit={submit} noValidate>
        <Input
          aria-label={t('projectName')}
          placeholder={t('projectName')}
          value={name}
          maxLength={80}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          error={error ?? undefined}
        />
        {team ? <Select<ProjectAccess> aria-label={t('whoCanSeeIt')} options={ACCESS_OPTIONS} value={access} onChange={setAccess} /> : null}
        {team ? (
          <label className="fr-dash-projdlg__level">
            <span className="fr-dash-settings__label">{access === 'private' ? t('peopleInTheProject') : t('members')}{' '}{t('onItsBoards')}</span>
            <Select<TeamAccess | ''>
              aria-label={t('whatMembersCanDoOn')}
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
          <h3 className="fr-dash-settings__title">{t('peopleInThisProject')}</h3>
          <ul className="fr-dash-members__list">
            {people.map((p) => (
              <li key={p.userId} className="fr-dash-members__row">
                <Avatar name={p.name} color={p.color} src={p.avatarUrl} size={28} />
                <span className="fr-dash-members__name">{p.name}</span>
                <div className="fr-dash-members__actions">
                  <IconButton size={32} icon={X} label={t('removeNameFromTheProject', { name: p.name })} tooltipSide="top" onClick={() => remove(p.userId)} />
                </div>
              </li>
            ))}
          </ul>
          {candidates.length > 0 ? (
            <Select<string>
              aria-label={t('addSomeoneToTheProject')}
              options={[{ value: '', label: t('addSomeone'), disabled: true }, ...candidates.map((m) => ({ value: m.userId, label: m.name }))]}
              value={adding}
              onChange={(v) => void add(v)}
            />
          ) : null}
          {groups.length || groupCandidates.length ? <h3 className="fr-dash-settings__title">{t('groupsInThisProject')}</h3> : null}
          <ul className="fr-dash-members__list">
            {groups.map((g) => (
              <li key={g.id} className="fr-dash-members__row">
                <span className="fr-dash-members__name">
                  {g.name} · {g.memberCount} {g.memberCount === 1 ? 'person' : 'people'}
                </span>
                <div className="fr-dash-members__actions">
                  <IconButton size={32} icon={X} label={t('removeNameFromTheProject', { name: g.name })} tooltipSide="top" onClick={() => void shareWithGroup(g.id, false)} />
                </div>
              </li>
            ))}
          </ul>
          {groupCandidates.length > 0 ? (
            <Select<string>
              aria-label={t('addAGroupToThe')}
              options={[{ value: '', label: t('addAGroup'), disabled: true }, ...groupCandidates.map((g) => ({ value: g.id, label: `${g.name} (${g.memberCount})` }))]}
              value=""
              onChange={(v) => v && void shareWithGroup(v, true)}
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
      notify(t('ownernameNowOwnsValue', { ownerName: updated.ownerName, value: board.title || t('untitledBoard') }), 'success');
      onTransferred(updated);
    } catch (err) {
      notify(errorText(err, t('couldNotTransferTheBoard')), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!board}
      onClose={onClose}
      title={t('transferOwnership')}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!target} onClick={submit}>{t('transfer')}</Button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', color: 'var(--fr-ink-2)' }}>
        {team
          ? t('pickAMemberOfThis')
          : 'Pick someone this board is shared with. It moves to their personal workspace; the current owner keeps edit access.'}
      </p>
      {candidates && candidates.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--fr-ink-3)' }}>{team ? t('inviteSomeoneToTheWorkspace') : t('shareTheBoardWithSomeone')}</p>
      ) : (
        <Select<string>
          aria-label={t('newOwner')}
          options={[{ value: '', label: candidates ? t('chooseTheNewOwner') : t('loading'), disabled: true }, ...(candidates ?? []).map((m) => ({ value: m.userId, label: m.name, description: m.email }))]}
          value={target}
          onChange={setTarget}
        />
      )}
    </Modal>
  );
}
