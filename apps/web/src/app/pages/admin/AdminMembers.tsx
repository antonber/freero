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

import { t } from './messages';
const ROLE_OPTIONS: Array<{ value: WorkspaceRole; label: string }> = [
  { value: 'owner', label: t('owner') },
  { value: 'admin', label: t('admin') },
  { value: 'member', label: t('member') },
  { value: 'guest', label: t('guest') },
];

const SCOPE_LABELS: Record<AdminScope, string> = { members: 'Members', content: 'Content', security: 'Security' };
const SCOPE_HINTS: Record<AdminScope, string> = {
  members: t('peopleInvitesRolesAndDeactivation'),
  content: t('sharingPoliciesAndEveryBoard'),
  security: t('signInSingleSignOn'),
};

/**
 * What an admin administers (#151). Owners tick the scopes; everyone else sees them. At least one
 * stays ticked (an admin of nothing is a member).
 */
function AdminScopes({ member, editable, onChange }: { member: AdminMember; editable: boolean; onChange: (s: AdminScope[] | null) => void }) {
  const scopes = member.adminScopes ?? ADMIN_SCOPES;
  if (!editable) return <div className="fr-admin__muted fr-admin-scopes">{scopes.length === ADMIN_SCOPES.length ? t('allAdminAreas') : scopes.map((s) => SCOPE_LABELS[s]).join(', ')}</div>;
  return (
    <div className="fr-admin-scopes" role="group" aria-label={t('whatNameAdministers', { name: member.name })}>
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
      (e) => notify(errorText(e, t('couldNotLoadTheMembers')), 'error'),
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
      notify(t('nameIsNowValueRole', { name: m.name, value: role === 'admin' || role === 'owner' ? t('an') : t('a'), role }), 'success');
      load();
    } catch (e) {
      notify(errorText(e, t('couldNotChangeTheRole')), 'error');
    }
  };

  const setScopes = async (m: AdminMember, scopes: AdminScope[] | null) => {
    try {
      await api.setWorkspaceRole(workspace.id, m.userId, 'admin', scopes);
      notify(scopes ? t('nameNowAdministersJoin', { name: m.name, join: scopes.map((s) => SCOPE_LABELS[s].toLowerCase()).join(' and ') }) : t('nameAdministersEverything', { name: m.name }), 'success');
      load();
    } catch (e) {
      notify(errorText(e, t('couldNotChangeWhatThey')), 'error');
    }
  };

  const setDeactivated = async (m: AdminMember, deactivated: boolean) => {
    setBusy(true);
    try {
      const { member } = await api.setMemberDeactivated(workspace.id, m.userId, deactivated);
      setMembers((all) => (all ?? []).map((x) => (x.userId === member.userId ? member : x)));
      notify(deactivated ? t('nameCanNoLongerOpen', { name: m.name }) : t('nameIsActiveAgain', { name: m.name }), 'success');
      setConfirm(null);
    } catch (e) {
      notify(errorText(e, deactivated ? t('couldNotDeactivateThem') : t('couldNotReactivateThem')), 'error');
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { member } = await api.addOrganisationMember(workspace.id, email.trim(), addRole);
      notify(t('nameIsInName2', { name: member.name, name2: workspace.name }), 'success');
      setEmail('');
      load();
    } catch (err) {
      notify(errorText(err, t('couldNotAddThem')), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!members) return <Spinner />;
  return (
    <section aria-labelledby="admin-members-title">
      <div className="fr-admin__head">
        <h1 id="admin-members-title" className="fr-admin__title">
          {org ? t('people') : t('members')}
        </h1>
        <span className="fr-admin__muted">
          {members.length} {members.length === 1 ? 'person' : 'people'} ·{' '}
          {org ? t('itsOwnersAndAdminsAnd') : t('invitePeopleFromTheWorkspace')}
        </span>
      </div>
      {org ? (
        <form className="fr-admin-org__add" onSubmit={add}>
          <Input aria-label={t('emailOfSomeoneWithA')} placeholder="name@company.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select<'admin' | 'member'>
            aria-label={t('theirRoleInTheOrganisation')}
            options={[
              { value: 'member', label: t('member') },
              { value: 'admin', label: t('admin'), disabled: !owner },
            ]}
            value={addRole}
            onChange={setAddRole}
            width={130}
          />
          <Button type="submit" loading={busy} disabled={!email.trim()}>{t('add')}</Button>
        </form>
      ) : null}
      <Input aria-label={t('searchMembers')} placeholder={t('searchByNameOrEmail')} value={q} onChange={(e) => setQ(e.target.value)} className="fr-admin__search" />
      <div className="fr-admin-table-wrap">
        <table className="fr-admin-table">
          <thead>
            <tr>
              <th scope="col">{t('person')}</th>
              <th scope="col">{t('role')}</th>
              <th scope="col">{t('twoStep')}</th>
              <th scope="col">{t('lastActive')}</th>
              {org ? null : <th scope="col">{t('boards')}</th>}
              <th scope="col">
                <span className="fr-admin__sr">{t('actions')}</span>
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
                        {m.userId === user?.id ? <span className="fr-admin__muted">{' '}{t('you')}</span> : null}
                        {m.deactivated ? <span className="fr-admin-pill fr-admin-pill--off">{t('deactivated')}</span> : null}
                      </div>
                      <div className="fr-admin__muted">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {manageable(m) && !m.deactivated ? (
                    <Select<WorkspaceRole>
                      aria-label={t('roleOfName', { name: m.name })}
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
                      <ShieldCheck size={13} aria-hidden />{' '}{t('on')}</span>
                  ) : (
                    <span className="fr-admin-pill fr-admin-pill--warn">
                      <ShieldAlert size={13} aria-hidden />{' '}{t('off')}</span>
                  )}
                </td>
                <td className="fr-admin__muted">{m.lastActiveAt ? relativeTime(m.lastActiveAt) : t('signedOut')}</td>
                {org ? null : <td>{m.boards}</td>}
                <td className="fr-admin-table__actions">
                  {manageable(m) ? (
                    m.deactivated ? (
                      <Button size="sm" icon={UserCheck} onClick={() => void setDeactivated(m, false)} loading={busy && confirm === null}>{t('reactivate')}</Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={UserX} onClick={() => setConfirm(m)}>{t('deactivate')}</Button>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={org ? 5 : 6} className="fr-admin__muted">{t('nobodyMatchesQ', { q })}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t('deactivateValue', { value: confirm?.name ?? '' })}
        width={440}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={() => confirm && void setDeactivated(confirm, true)}>{t('deactivate')}</Button>
          </>
        }
      >
        <p className="fr-admin__modal-text">
          {org
            ? t('theyKeepTheirRolesAnd', { name: workspace.name })
            : t('theyKeepTheirRoleAnd', { name: workspace.name })}
        </p>
      </Modal>
    </section>
  );
}
