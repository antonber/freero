// A team workspace's people: invite by email (accounts join at once, other addresses get an
// emailed link), change roles, remove, leave, and pending invites. The server decides what is
// allowed; this page only offers what it would accept.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LogOut, Mail, RotateCw, X } from 'lucide-react';
import type { WorkspaceInvite, WorkspaceMember, WorkspaceRole, WorkspaceSummary } from '@freero/shared';
import { Avatar, Button, IconButton, Input, Select, Spinner, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { inviteStatus } from '../../components/ShareDialog';

type Invitable = Exclude<WorkspaceRole, 'owner'>;

const ROLE_OPTIONS: SelectOption<WorkspaceRole>[] = [
  { value: 'owner', label: 'Owner', description: 'Everything, including policies and deleting the workspace' },
  { value: 'admin', label: 'Admin', description: 'Manages members, projects and policies' },
  { value: 'member', label: 'Member', description: 'Creates boards and edits the team’s boards' },
  { value: 'guest', label: 'Guest', description: 'Only boards and projects shared with them' },
];

/** What `me` may set someone's role to (mirrors the server's rule; the server re-checks). */
function assignable(me: WorkspaceRole, target: WorkspaceRole): WorkspaceRole[] {
  if (me === 'owner') return ['owner', 'admin', 'member', 'guest'];
  if (me === 'admin' && (target === 'member' || target === 'guest')) return ['member', 'guest'];
  return [];
}

function invitable(ws: WorkspaceSummary): Invitable[] {
  if (ws.role === 'owner') return ['admin', 'member', 'guest'];
  if (ws.role === 'admin') return ['member', 'guest'];
  return ws.role === 'member' && ws.policies.guestInvites === 'members' ? ['guest'] : [];
}

export function WorkspaceMembers({ workspace, onChanged, onLeft }: { workspace: WorkspaceSummary; onChanged: () => void; onLeft: () => void }) {
  const { user } = useAuth();
  const notify = useToast();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const roles = invitable(workspace);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Invitable>(roles.includes('member') ? 'member' : 'guest');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const manager = workspace.role === 'owner' || workspace.role === 'admin';

  const load = useCallback(async () => {
    try {
      const out = await api.listWorkspaceMembers(workspace.id);
      setMembers(out.members);
      setInvites(out.invites);
      setFailed(null);
    } catch (e) {
      setFailed(e instanceof ApiError ? e.message : 'Could not load the members');
    }
  }, [workspace.id]);

  useEffect(() => {
    setMembers(null);
    void load();
  }, [load]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return setInviteError('Enter a valid email address');
    setInviting(true);
    setInviteError(null);
    try {
      const out = await api.inviteToWorkspace(workspace.id, addr, role);
      if (out.member) notify(`${out.member.name} joined ${workspace.name}`, 'success');
      else if (out.invite) notify(`Invite sent to ${out.invite.email}`, 'success');
      setEmail('');
      await load();
      onChanged();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : 'Could not send the invite');
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (m: WorkspaceMember, next: WorkspaceRole) => {
    const prev = members;
    setMembers((list) => list?.map((x) => (x.userId === m.userId ? { ...x, role: next } : x)) ?? null);
    try {
      await api.setWorkspaceRole(workspace.id, m.userId, next);
      onChanged();
    } catch (err) {
      setMembers(prev);
      notify(err instanceof ApiError ? err.message : 'Could not change the role', 'error');
    }
  };

  const remove = async (m: WorkspaceMember) => {
    const self = m.userId === user?.id;
    try {
      await api.removeWorkspaceMember(workspace.id, m.userId);
      if (self) {
        notify(`You left ${workspace.name}`, 'info');
        onLeft();
        return;
      }
      setMembers((list) => list?.filter((x) => x.userId !== m.userId) ?? null);
      notify(`${m.name} was removed. Boards they owned here are now yours.`, 'info');
      onChanged();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not remove that person', 'error');
    }
  };

  const resend = async (inv: WorkspaceInvite) => {
    try {
      const { invite } = await api.resendWorkspaceInvite(workspace.id, inv.id);
      setInvites((list) => list.map((i) => (i.id === invite.id ? invite : i)));
      notify(`Sent a new invite link to ${invite.email}`, 'success');
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not resend the invite', 'error');
    }
  };

  const revoke = async (inv: WorkspaceInvite) => {
    try {
      await api.revokeWorkspaceInvite(workspace.id, inv.id);
      setInvites((list) => list.filter((i) => i.id !== inv.id));
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not revoke the invite', 'error');
    }
  };

  return (
    <section className="fr-dash-page" aria-label="Members">
      <header className="fr-dash-page__head">
        <h1 className="fr-collection__title">
          Members{members ? <span className="fr-collection__count">{members.length}</span> : null}
        </h1>
        <p className="fr-dash-page__lead">People in {workspace.name}. Members see every board the team shares; guests only what’s shared with them.</p>
      </header>

      {roles.length > 0 ? (
        user?.emailVerified === false ? (
          <p className="fr-dash-page__note">Confirm your email address to invite people.</p>
        ) : (
          <form className="fr-dash-members__invite" onSubmit={invite} noValidate>
            <Input
              type="email"
              placeholder="Invite by email"
              aria-label="Email address to invite"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setInviteError(null);
              }}
              error={inviteError ?? undefined}
              autoComplete="off"
            />
            <Select<Invitable>
              aria-label="Invite as"
              options={ROLE_OPTIONS.filter((o) => roles.includes(o.value as Invitable)) as SelectOption<Invitable>[]}
              value={role}
              onChange={setRole}
              width={140}
            />
            <Button type="submit" variant="primary" loading={inviting} disabled={!email.trim()}>
              Invite
            </Button>
          </form>
        )
      ) : null}

      {failed ? (
        <p className="fr-dash-page__note" role="alert">
          {failed}
        </p>
      ) : !members ? (
        <Spinner size={22} label="Loading members" />
      ) : (
        <ul className="fr-dash-members__list">
          {members.map((m) => {
            const self = m.userId === user?.id;
            // The last owner can't leave (the server refuses it too): hand the workspace over first.
            const soleOwner = m.role === 'owner' && members.filter((x) => x.role === 'owner').length === 1;
            const options = assignable(workspace.role, m.role);
            const mayRemove = !self && (workspace.role === 'owner' || (workspace.role === 'admin' && (m.role === 'member' || m.role === 'guest')));
            return (
              <li key={m.userId} className="fr-dash-members__row" data-testid="ws-member">
                <Avatar name={m.name} color={m.color} src={m.avatarUrl} size={34} />
                <div className="fr-dash-members__who">
                  <span className="fr-dash-members__name">
                    {m.name}
                    {self ? <span className="fr-dash-members__you"> (you)</span> : null}
                  </span>
                  <span className="fr-dash-members__email">{m.email}</span>
                </div>
                <div className="fr-dash-members__actions">
                  {options.length > 1 && !self ? (
                    <Select<WorkspaceRole>
                      aria-label={`Role for ${m.name}`}
                      size="sm"
                      variant="ghost"
                      options={ROLE_OPTIONS.filter((o) => options.includes(o.value))}
                      value={m.role}
                      onChange={(r) => changeRole(m, r)}
                    />
                  ) : (
                    <span className="fr-dash-members__role">{ROLE_OPTIONS.find((o) => o.value === m.role)?.label}</span>
                  )}
                  {mayRemove ? <IconButton size={32} icon={X} label={`Remove ${m.name}`} tooltipSide="top" onClick={() => remove(m)} /> : null}
                  {self && !soleOwner ? (
                    <Button size="sm" variant="ghost" icon={LogOut} onClick={() => remove(m)}>
                      Leave
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
          {invites.map((inv) => (
            <li key={inv.id} className="fr-dash-members__row fr-dash-members__row--pending" data-testid="ws-invite">
              <span className="fr-dash-members__pending" aria-hidden>
                <Mail size={16} />
              </span>
              <div className="fr-dash-members__who">
                <span className="fr-dash-members__name">{inv.email}</span>
                <span className="fr-dash-members__email">{inviteStatus(inv)}</span>
              </div>
              <div className="fr-dash-members__actions">
                <span className="fr-dash-members__role">{ROLE_OPTIONS.find((o) => o.value === inv.role)?.label}</span>
                {manager ? (
                  <>
                    <IconButton size={32} icon={RotateCw} label={`Resend invite to ${inv.email}`} tooltipSide="top" onClick={() => resend(inv)} />
                    <IconButton size={32} icon={X} label={`Revoke invite to ${inv.email}`} tooltipSide="top" onClick={() => revoke(inv)} />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
