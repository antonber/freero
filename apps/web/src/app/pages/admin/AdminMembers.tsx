// Members of the workspace for its admins: search, role, two-step status, last activity, boards,
// deactivate / reactivate. Owners change anyone; admins only members and guests (the server
// decides; the controls follow the same rule).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ShieldAlert, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { ADMIN_SCOPES, type AdminMember, type AdminScope, type WorkspaceRole, type WorkspaceSummary } from '@freero/shared';
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

const SCOPE_LABELS: Record<AdminScope, string> = { members: 'Members', content: 'Content', security: 'Security' };
const SCOPE_HINTS: Record<AdminScope, string> = {
  members: 'People, invites, roles and deactivation',
  content: 'Sharing policies and every board: inventory, trash, archive, retention, templates',
  security: 'Sign-in, single sign-on, provisioning, IP allowlist, integrations, exports and the audit log',
};

/**
 * What an admin administers (#151). Owners tick the scopes; everyone else sees them. At least one
 * stays ticked (an admin of nothing is a member).
 */
function AdminScopes({ member, editable, onChange }: { member: AdminMember; editable: boolean; onChange: (s: AdminScope[] | null) => void }) {
  const scopes = member.adminScopes ?? ADMIN_SCOPES;
  if (!editable) return <div className="fr-admin__muted fr-admin-scopes">{scopes.length === ADMIN_SCOPES.length ? 'All admin areas' : scopes.map((s) => SCOPE_LABELS[s]).join(', ')}</div>;
  return (
    <div className="fr-admin-scopes" role="group" aria-label={`What ${member.name} administers`}>
      {ADMIN_SCOPES.map((s) => {
        const on = scopes.includes(s);
        return (
          <label key={s} className="fr-admin-scopes__item" title={SCOPE_HINTS[s]}>
            <input
              type="checkbox"
              checked={on}
              disabled={on && scopes.length === 1}
              onChange={() => {
                const next = on ? scopes.filter((x) => x !== s) : ADMIN_SCOPES.filter((x) => x === s || scopes.includes(x));
                onChange(next.length === ADMIN_SCOPES.length ? null : next);
              }}
            />
            {SCOPE_LABELS[s]}
          </label>
        );
      })}
    </div>
  );
}

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export function AdminMembers({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const { user } = useAuth();
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<AdminMember | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = workspace.role === 'owner';
  // An organisation's directory (#108): owners, admins and members; deactivating someone closes
  // all of its workspaces to them; people are added by email (an existing account).
  const org = workspace.kind === 'organisation';
  const roleOptions = org ? ROLE_OPTIONS.filter((o) => o.value !== 'guest') : ROLE_OPTIONS;
  const [email, setEmail] = useState('');
  const [addRole, setAddRole] = useState<'admin' | 'member'>('member');

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

  const setScopes = async (m: AdminMember, scopes: AdminScope[] | null) => {
    try {
      await api.setWorkspaceRole(workspace.id, m.userId, 'admin', scopes);
      notify(scopes ? `${m.name} now administers ${scopes.map((s) => SCOPE_LABELS[s].toLowerCase()).join(' and ')}` : `${m.name} administers everything`, 'success');
      load();
    } catch (e) {
      notify(errorText(e, 'Could not change what they administer'), 'error');
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

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { member } = await api.addOrganisationMember(workspace.id, email.trim(), addRole);
      notify(`${member.name} is in ${workspace.name}`, 'success');
      setEmail('');
      load();
    } catch (err) {
      notify(errorText(err, 'Could not add them'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!members) return <Spinner />;
  return (
    <section aria-labelledby="admin-members-title">
      <div className="fr-admin__head">
        <h1 id="admin-members-title" className="fr-admin__title">
          {org ? 'People' : 'Members'}
        </h1>
        <span className="fr-admin__muted">
          {members.length} {members.length === 1 ? 'person' : 'people'} ·{' '}
          {org ? 'its owners and admins, and everyone its single sign-on, provisioning or domain control brought in' : 'invite people from the workspace’s Members page'}
        </span>
      </div>
      {org ? (
        <form className="fr-admin-org__add" onSubmit={add}>
          <Input aria-label="Email of someone with a Freero account" placeholder="name@company.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select<'admin' | 'member'>
            aria-label="Their role in the organisation"
            options={[
              { value: 'member', label: 'Member' },
              { value: 'admin', label: 'Admin', disabled: !owner },
            ]}
            value={addRole}
            onChange={setAddRole}
            width={130}
          />
          <Button type="submit" loading={busy} disabled={!email.trim()}>
            Add
          </Button>
        </form>
      ) : null}
      <Input aria-label="Search members" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} className="fr-admin__search" />
      <div className="fr-admin-table-wrap">
        <table className="fr-admin-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col">Two-step</th>
              <th scope="col">Last active</th>
              {org ? null : <th scope="col">Boards</th>}
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
                      options={roleOptions.map((o) => ({ ...o, disabled: !owner && (o.value === 'owner' || o.value === 'admin') }))}
                      value={m.role}
                      onChange={(r) => void setRole(m, r)}
                      width={110}
                    />
                  ) : (
                    <span className="fr-admin-role">{ROLE_OPTIONS.find((o) => o.value === m.role)?.label}</span>
                  )}
                  {m.role === 'admin' ? (
                    <AdminScopes member={m} editable={owner && !m.deactivated && m.userId !== user?.id} onChange={(s) => void setScopes(m, s)} />
                  ) : null}
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
                {org ? null : <td>{m.boards}</td>}
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
                <td colSpan={org ? 5 : 6} className="fr-admin__muted">
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
          {org
            ? `They keep their roles and boards, but can’t open anything in any of ${workspace.name}’s workspaces — boards that are open now close at once. You can reactivate them any time.`
            : `They keep their role and the boards they own, but can’t open anything in ${workspace.name} — boards that are open now close at once. You can reactivate them any time.`}
        </p>
      </Modal>
    </section>
  );
}
