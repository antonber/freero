// User groups of the workspace for its members admins (#63): make a group, put members of the
// workspace in it or take them out, rename or delete it. Boards and projects are shared with a group
// from their share dialog; access follows the group at once. Directory groups (SCIM) are listed
// beside them, read-only: Provisioning manages those.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Trash2, UserPlus, X } from 'lucide-react';
import type { DirectoryGroup, WorkspaceGroup, WorkspaceMember, WorkspaceSummary } from '@freero/shared';
import { Avatar, Button, IconButton, Input, Select, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export function AdminGroups({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [groups, setGroups] = useState<WorkspaceGroup[] | null>(null);
  const [directory, setDirectory] = useState<DirectoryGroup[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listGroups(workspace.id).then(
      (r) => {
        setGroups(r.groups);
        setDirectory(r.directory);
      },
      (e) => notify(errorText(e, 'Could not load the groups'), 'error'),
    );
  }, [workspace.id, notify]);
  useEffect(load, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { group } = await api.createGroup(workspace.id, name.trim());
      setName('');
      setOpen(group.id);
      load();
    } catch (err) {
      notify(errorText(err, 'Could not make the group'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (g: WorkspaceGroup) => {
    try {
      await api.deleteGroup(g.id);
      notify(`Deleted “${g.name}”: what was shared with it no longer reaches its members`, 'success');
      load();
    } catch (err) {
      notify(errorText(err, 'Could not delete the group'), 'error');
    }
  };

  if (!groups) return <Spinner />;
  return (
    <section aria-labelledby="admin-groups-title">
      <div className="fr-admin__head">
        <h1 id="admin-groups-title" className="fr-admin__title">
          Groups
        </h1>
        <span className="fr-admin__muted">Share a board or project with a group instead of each person. Joining or leaving a group changes what someone opens right away.</span>
      </div>
      <form className="fr-admin-org__add" onSubmit={create}>
        <Input aria-label="New group name" placeholder="Design, Contractors…" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" loading={busy} disabled={!name.trim()}>
          Make group
        </Button>
      </form>
      <ul className="fr-admin-groups">
        {groups.map((g) => (
          <li key={g.id} className="fr-admin-card fr-admin-groups__item">
            <div className="fr-admin-groups__head">
              <button type="button" className="fr-admin-groups__name" aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
                {g.name}
              </button>
              <span className="fr-admin__muted">
                {g.memberCount} {g.memberCount === 1 ? 'person' : 'people'}
                {g.guestCount ? ` · ${g.guestCount} guest${g.guestCount === 1 ? '' : 's'}` : ''}
              </span>
              <IconButton size={32} icon={Trash2} label={`Delete ${g.name}`} tooltipSide="top" onClick={() => void remove(g)} />
            </div>
            {open === g.id ? <GroupMembers workspace={workspace} group={g} onChanged={load} /> : null}
          </li>
        ))}
        {groups.length === 0 ? <li className="fr-admin__muted">No groups yet.</li> : null}
      </ul>
      {directory.length ? (
        <>
          <h2 className="fr-admin__subtitle">From your directory</h2>
          <p className="fr-admin__muted">Your identity provider keeps these in step (Provisioning). Their members change there.</p>
          <ul className="fr-admin-groups">
            {directory.map((d) => (
              <li key={d.id} className="fr-admin-card fr-admin-groups__head">
                <span className="fr-admin-groups__name">{d.name}</span>
                <span className="fr-admin__muted">
                  {d.memberCount} {d.memberCount === 1 ? 'person' : 'people'} · read-only
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function GroupMembers({ workspace, group, onChanged }: { workspace: WorkspaceSummary; group: WorkspaceGroup; onChanged: () => void }) {
  const notify = useToast();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [everyone, setEveryone] = useState<WorkspaceMember[]>([]);
  const load = useCallback(() => {
    api.listGroupMembers(group.id).then((r) => setMembers(r.members), () => setMembers([]));
  }, [group.id]);
  useEffect(() => {
    load();
    api.listWorkspaceMembers(workspace.id).then((r) => setEveryone(r.members), () => setEveryone([]));
  }, [load, workspace.id]);

  const set = async (userId: string, member: boolean) => {
    try {
      await api.setGroupMember(group.id, userId, member);
      load();
      onChanged();
    } catch (err) {
      notify(errorText(err, member ? 'Could not add them' : 'Could not take them out'), 'error');
    }
  };

  if (!members) return <Spinner />;
  const candidates = everyone.filter((m) => !members.some((x) => x.userId === m.userId));
  return (
    <div className="fr-admin-groups__members">
      <ul className="fr-admin-groups__people">
        {members.map((m) => (
          <li key={m.userId} className="fr-admin-person">
            <Avatar name={m.name} color={m.color} src={m.avatarUrl} size={24} />
            <span>
              {m.name}
              {m.role === 'guest' ? <span className="fr-admin-pill">Guest</span> : null}
            </span>
            <IconButton size={32} icon={X} label={`Take ${m.name} out of ${group.name}`} tooltipSide="top" onClick={() => void set(m.userId, false)} />
          </li>
        ))}
      </ul>
      {candidates.length ? (
        <div className="fr-admin-groups__add">
          <UserPlus size={16} aria-hidden />
          <Select<string>
            aria-label={`Add someone to ${group.name}`}
            options={[{ value: '', label: 'Add someone…', disabled: true }, ...candidates.map((m) => ({ value: m.userId, label: `${m.name}${m.role === 'guest' ? ' (guest)' : ''}` }))]}
            value=""
            onChange={(v) => v && void set(v, true)}
            width={280}
          />
        </div>
      ) : null}
    </div>
  );
}
