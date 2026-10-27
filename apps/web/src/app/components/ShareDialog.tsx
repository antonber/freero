import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Globe, Link2, Lock, LogOut, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { BoardMember, BoardSummary, LinkAccess, Role } from '@freero/shared';
import { Avatar, Button, IconButton, Input, Modal, Select, Spinner, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { copyText } from '../lib/hooks';
import './ShareDialog.css';

type InviteRole = Exclude<Role, 'owner'>;

const ROLE_OPTIONS: SelectOption<InviteRole>[] = [
  { value: 'editor', label: 'Can edit', description: 'Add and change anything on the board' },
  { value: 'commenter', label: 'Can comment', description: 'View and leave comments' },
  { value: 'viewer', label: 'Can view', description: 'Look around, no changes' },
];

const LINK_OPTIONS: SelectOption<LinkAccess>[] = [
  { value: 'none', label: 'No access' },
  { value: 'viewer', label: 'Can view' },
  { value: 'commenter', label: 'Can comment' },
  { value: 'editor', label: 'Can edit' },
];

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', editor: 'Can edit', commenter: 'Can comment', viewer: 'Can view' };

export interface ShareDialogProps {
  boardId: string;
  open: boolean;
  onClose: () => void;
  /** Optional: the board summary if the caller already has it (skips a fetch). */
  board?: BoardSummary;
  /** Called after link access changes, with the updated board. */
  onBoardChange?: (board: BoardSummary) => void;
  /** Called after the current user left the board. Default: go to the dashboard. */
  onLeft?: () => void;
}

export function boardUrl(boardId: string): string {
  return `${location.origin}/board/${boardId}`;
}

export function ShareDialog({ boardId, open, onClose, board: givenBoard, onBoardChange, onLeft }: ShareDialogProps) {
  const { user } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const [board, setBoard] = useState<BoardSummary | null>(givenBoard ?? null);
  const [members, setMembers] = useState<BoardMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('editor');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(null);
    setInviteError(null);
    setMembers(null);
    if (givenBoard) setBoard(givenBoard);
    Promise.all([givenBoard ? Promise.resolve({ board: givenBoard }) : api.getBoard(boardId), api.listMembers(boardId)])
      .then(([b, m]) => {
        if (cancelled) return;
        setBoard(b.board);
        setMembers(m.members);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof ApiError ? e.message : 'Could not load sharing settings');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boardId]);

  const myRole: Role | undefined = board?.role;
  const isOwner = myRole === 'owner';
  const canInvite = myRole === 'owner' || myRole === 'editor';
  const isMember = !!members?.some((m) => m.userId === user?.id);

  const sorted = useMemo(() => {
    if (!members) return [];
    const rank = (m: BoardMember) => (m.role === 'owner' ? 0 : m.userId === user?.id ? 1 : 2);
    return [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [members, user?.id]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setInviteError('Enter a valid email address');
      return;
    }
    setInviting(true);
    setInviteError(null);
    try {
      const { member } = await api.invite(boardId, { email: addr, role: inviteRole });
      setMembers((list) => [...(list ?? []).filter((m) => m.userId !== member.userId), member]);
      setEmail('');
      notify(`${member.name} can now access this board`, 'success');
    } catch (err) {
      setInviteError(
        err instanceof ApiError
          ? err.status === 404
            ? `No Freero account uses ${addr} yet. Ask them to sign up first.`
            : err.message
          : 'Could not send the invite',
      );
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (m: BoardMember, role: InviteRole) => {
    const prev = members;
    setMembers((list) => list?.map((x) => (x.userId === m.userId ? { ...x, role } : x)) ?? null);
    try {
      await api.setMemberRole(boardId, m.userId, role);
    } catch (err) {
      setMembers(prev);
      notify(err instanceof ApiError ? err.message : 'Could not change the role', 'error');
    }
  };

  const remove = async (m: BoardMember) => {
    const prev = members;
    setMembers((list) => list?.filter((x) => x.userId !== m.userId) ?? null);
    try {
      await api.removeMember(boardId, m.userId);
      notify(`Removed ${m.name}`, 'info');
    } catch (err) {
      setMembers(prev);
      notify(err instanceof ApiError ? err.message : 'Could not remove that person', 'error');
    }
  };

  const leave = async () => {
    if (!user) return;
    setLeaving(true);
    try {
      await api.removeMember(boardId, user.id);
      setConfirmLeave(false);
      onClose();
      notify('You left the board', 'info');
      if (onLeft) onLeft();
      else navigate('/app');
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not leave the board', 'error');
    } finally {
      setLeaving(false);
    }
  };

  const changeLinkAccess = async (linkAccess: LinkAccess) => {
    if (!board) return;
    const prev = board;
    setBoard({ ...board, linkAccess });
    try {
      const { board: updated } = await api.updateBoard(boardId, { linkAccess });
      setBoard(updated);
      onBoardChange?.(updated);
    } catch (err) {
      setBoard(prev);
      notify(err instanceof ApiError ? err.message : 'Could not update link access', 'error');
    }
  };

  const copy = async () => {
    const ok = await copyText(boardUrl(boardId));
    notify(ok ? 'Board link copied' : 'Could not copy the link', ok ? 'success' : 'error');
  };

  const linkAccess = board?.linkAccess ?? 'none';

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={board ? `Share “${board.title || 'Untitled board'}”` : 'Share board'}
        width={520}
        footer={
          <div className="fr-share__footer">
            <Button icon={Link2} onClick={copy}>
              Copy link
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        }
      >
        {loadError ? (
          <div className="fr-share__error" role="alert">
            {loadError}
          </div>
        ) : !members || !board ? (
          <div className="fr-share__loading">
            <Spinner size={22} label="Loading sharing settings" />
          </div>
        ) : (
          <div className="fr-share">
            {canInvite ? (
              <form className="fr-share__invite" onSubmit={invite} noValidate>
                <Input
                  className="fr-share__email"
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
                <Select<InviteRole> aria-label="Invite as" options={ROLE_OPTIONS} value={inviteRole} onChange={setInviteRole} width={140} />
                <Button type="submit" variant="primary" loading={inviting} disabled={!email.trim()}>
                  Invite
                </Button>
              </form>
            ) : (
              <p className="fr-share__note">Only the owner and editors can invite people.</p>
            )}

            <section aria-label="People with access">
              <h3 className="fr-share__heading">People with access</h3>
              <ul className="fr-share__members">
                {sorted.map((m) => {
                  const isMe = m.userId === user?.id;
                  return (
                    <li key={m.userId} className="fr-share__member" data-testid="share-member">
                      <Avatar name={m.name} color={m.color} src={m.avatarUrl} size={34} />
                      <div className="fr-share__who">
                        <span className="fr-share__name">
                          {m.name}
                          {isMe ? <span className="fr-share__you"> (you)</span> : null}
                        </span>
                        <span className="fr-share__email-text">{m.email}</span>
                      </div>
                      <div className="fr-share__member-actions">
                        {isOwner && m.role !== 'owner' ? (
                          <>
                            <Select<InviteRole>
                              aria-label={`Role for ${m.name}`}
                              size="sm"
                              variant="ghost"
                              options={ROLE_OPTIONS}
                              value={m.role as InviteRole}
                              onChange={(r) => changeRole(m, r)}
                            />
                            <IconButton size={32} icon={X} label={`Remove ${m.name}`} tooltipSide="top" onClick={() => remove(m)} />
                          </>
                        ) : (
                          <span className="fr-share__role">{ROLE_LABEL[m.role]}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="fr-share__link" aria-label="Link access">
              <span className={`fr-share__link-icon${linkAccess === 'none' ? '' : ' fr-share__link-icon--open'}`}>
                {linkAccess === 'none' ? <Lock size={17} aria-hidden /> : <Globe size={17} aria-hidden />}
              </span>
              <div className="fr-share__who">
                <span className="fr-share__name">Anyone with the link</span>
                <span className="fr-share__email-text">
                  {linkAccess === 'none' ? 'Only people added above can open it' : 'Must be signed in to Freero'}
                </span>
              </div>
              {isOwner ? (
                <Select<LinkAccess> aria-label="Link access" size="sm" options={LINK_OPTIONS} value={linkAccess} onChange={changeLinkAccess} width={136} />
              ) : (
                <span className="fr-share__role">{LINK_OPTIONS.find((o) => o.value === linkAccess)?.label}</span>
              )}
            </section>

            {!isOwner && isMember ? (
              <div className="fr-share__leave">
                <Button variant="ghost" size="sm" icon={LogOut} onClick={() => setConfirmLeave(true)}>
                  Leave board
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Leave this board?"
        width={400}
        footer={
          <>
            <Button onClick={() => setConfirmLeave(false)}>Cancel</Button>
            <Button variant="danger" loading={leaving} onClick={leave}>
              Leave board
            </Button>
          </>
        }
      >
        You'll lose access until someone invites you again.
      </Modal>
    </>
  );
}
