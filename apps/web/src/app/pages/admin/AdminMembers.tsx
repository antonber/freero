// Members of the workspace for its admins: search, role, two-step status, last activity, boards,
// deactivate / reactivate. Owners change anyone; admins only members and guests (the server
// decides; the controls follow the same rule).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldAlert, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import type { AdminMember, WorkspaceRole, WorkspaceSummary } from '@freero/shared';
import { Avatar, Button, Input, Modal, Select, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { relativeTime } from '../../lib/time';

const ROLE_OPTIONS: Array<{ value: WorkspaceRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'guest', label: 'Guest' },
];

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export function AdminMembers({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const { user } = useAuth();
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<AdminMember | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = workspace.role === 'owner';

  const load = useCallback(() => {
    api.adminMembers(workspace.id).then(
      (r) => setMembers(r.members),
      (e) => notify(errorText(e, 'Could not load the members'), 'error'),
    );
  }, [workspace.id, notify]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (members ?? []).filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle));
  }, [members, q]);

  // Owners manage anyone; admins members and guests (never themselves here).
  const manageable = (m: AdminMember) => m.userId !== user?.id && (owner || m.role === 'member' || m.role === 'guest');

  const setRole = async (m: AdminMember, role: WorkspaceRole) => {
    try {
      await api.setWorkspaceRole(workspace.id, m.userId, role);
      notify(`${m.name} is now ${role === 'admin' || role === 'owner' ? 'an' : 'a'} ${role}`, 'success');
      load();
    } catch (e) {
      notify(errorText(e, 'Could not change the role'), 'error');
    }
  };

  const setDeactivated = async (m: AdminMember, deactivated: boolean) => {
    setBusy(true);
    try {
      const { member } = await api.setMemberDeactivated(workspace.id, m.userId, deactivated);
      setMembers((all) => (all ?? []).map((x) => (x.userId === member.userId ? member : x)));
      notify(deactivated ? `${m.name} can no longer open this workspace’s boards` : `${m.name} is active again`, 'success');
      setConfirm(null);
    } catch (e) {
      notify(errorText(e, deactivated ? 'Could not deactivate them' : 'Could not reactivate them'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!members) return <Spinner />;
  return (
    <section aria-labelledby="admin-members-title">
      <div className="fr-admin__head">
        <h1 id="admin-members-title" className="fr-admin__title">
          Members
        </h1>
        <span className="fr-admin__muted">
          {members.length} {members.length === 1 ? 'person' : 'people'} · invite people from the workspace’s Members page
        </span>
      </div>
      <Input aria-label="Search members" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} className="fr-admin__search" />
      <div className="fr-admin-table-wrap">
        <table className="fr-admin-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col">Two-step</th>
              <th scope="col">Last active</th>
              <th scope="col">Boards</th>
              <th scope="col">
                <span className="fr-admin__sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.userId} className={m.deactivated ? 'fr-admin-table__row--off' : undefined}>
                <td>
                  <div className="fr-admin-person">
                    <Avatar name={m.name} color={m.color} src={m.avatarUrl} size={28} />
                    <div>
                      <div className="fr-admin-person__name">
                        {m.name}
                        {m.userId === user?.id ? <span className="fr-admin__muted"> (you)</span> : null}
                        {m.deactivated ? <span className="fr-admin-pill fr-admin-pill--off">Deactivated</span> : null}
                      </div>
                      <div className="fr-admin__muted">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {manageable(m) && !m.deactivated ? (
                    <Select<WorkspaceRole>
                      aria-label={`Role of ${m.name}`}
                      size="sm"
                      options={ROLE_OPTIONS.map((o) => ({ ...o, disabled: !owner && (o.value === 'owner' || o.value === 'admin') }))}
                      value={m.role}
                      onChange={(r) => void setRole(m, r)}
                      width={110}
                    />
                  ) : (
                    <span className="fr-admin-role">{ROLE_OPTIONS.find((o) => o.value === m.role)?.label}</span>
                  )}
                </td>
                <td>
                  {m.twoFactor ? (
                    <span className="fr-admin-pill fr-admin-pill--ok">
                      <ShieldCheck size={13} aria-hidden /> On
                    </span>
                  ) : (
                    <span className="fr-admin-pill fr-admin-pill--warn">
                      <ShieldAlert size={13} aria-hidden /> Off
                    </span>
                  )}
                </td>
                <td className="fr-admin__muted">{m.lastActiveAt ? relativeTime(m.lastActiveAt) : 'Signed out'}</td>
                <td>{m.boards}</td>
                <td className="fr-admin-table__actions">
                  {manageable(m) ? (
                    m.deactivated ? (
                      <Button size="sm" icon={UserCheck} onClick={() => void setDeactivated(m, false)} loading={busy && confirm === null}>
                        Reactivate
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={UserX} onClick={() => setConfirm(m)}>
                        Deactivate
                      </Button>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="fr-admin__muted">
                  Nobody matches “{q}”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={`Deactivate ${confirm?.name ?? ''}?`}
        width={440}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={() => confirm && void setDeactivated(confirm, true)}>
              Deactivate
            </Button>
          </>
        }
      >
        <p className="fr-admin__modal-text">
          They keep their role and the boards they own, but can’t open anything in {workspace.name} — boards that are open now close at
          once. You can reactivate them any time.
        </p>
      </Modal>
    </section>
  );
}
