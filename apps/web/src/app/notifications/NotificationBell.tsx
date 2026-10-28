// The bell in the top bar (dashboard and board): unread badge, and the inbox in a popover. Each
// item opens its link — the board, or the board with the comment thread open.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlarmClock, AtSign, Bell, CalendarClock, CheckCheck, DoorOpen, KeyRound, MessageSquareReply, Settings, ShieldAlert, SquareCheckBig, UserPlus, Users } from 'lucide-react';
import type { AppNotification, NotificationType, Role } from '@freero/shared';
import { Avatar, Button, IconButton, Popover, Select, Spinner, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { relativeTime } from '../lib/time';
import {
  loadMoreNotifications,
  loadNotifications,
  markNotificationsRead,
  retainLiveConnection,
  useNotifications,
} from './store';
import './notifications.css';

const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  'comment.mention': AtSign,
  'comment.reply': MessageSquareReply,
  'board.invite': UserPlus,
  'workspace.invite': Users,
  'access.request': KeyRound,
  'access.response': DoorOpen,
  'moderation.action': ShieldAlert,
  'card.assigned': SquareCheckBig,
  'card.due_changed': CalendarClock,
  'card.due_soon': AlarmClock,
};

type GrantRole = Exclude<Role, 'owner'>;
const GRANT_OPTIONS: SelectOption<GrantRole>[] = [
  { value: 'editor', label: 'Can edit' },
  { value: 'commenter', label: 'Can comment' },
  { value: 'viewer', label: 'Can view' },
];
const GRANT_LABEL: Record<GrantRole, string> = { editor: 'can edit', commenter: 'can comment', viewer: 'can view' };
const OUTCOME: Record<string, string> = { approved: 'Approved', denied: 'Declined', withdrawn: 'No longer waiting' };

const badgeText = (n: number) => (n > 99 ? '99+' : String(n));

export function NotificationBell({ size = 40, side = 'bottom' }: { size?: 32 | 40; side?: 'bottom' | 'top' }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const unread = useNotifications((s) => s.unread);
  const userId = user?.id;

  useEffect(() => (userId ? retainLiveConnection(userId) : undefined), [userId]);
  useEffect(() => {
    if (open) void loadNotifications();
  }, [open]);

  if (!user) return null;
  const label = unread ? `Notifications (${unread} unread)` : 'Notifications';
  return (
    <>
      <IconButton ref={ref} icon={Bell} label={label} size={size} active={open} onClick={() => setOpen((o) => !o)} className="fr-notif-bell">
        {unread > 0 && (
          <span className="fr-notif-bell__badge" aria-hidden>
            {badgeText(unread)}
          </span>
        )}
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side={side} align="end" width={380} aria-label="Notifications">
        <Inbox onNavigate={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function Inbox({ onNavigate }: { onNavigate: () => void }) {
  const navigate = useNavigate();
  const { items, unread, hasMore, loading, error } = useNotifications((s) => s);
  const now = Date.now();

  const openItem = (n: AppNotification) => {
    if (!n.readAt) void markNotificationsRead([n.id]);
    onNavigate();
    navigate(n.link);
  };

  return (
    <div className="fr-notif">
      <div className="fr-notif__head">
        <h2 className="fr-notif__title">Notifications</h2>
        {unread > 0 && (
          <Button size="sm" variant="ghost" icon={CheckCheck} onClick={() => void markNotificationsRead()}>
            Mark all as read
          </Button>
        )}
      </div>
      <div className="fr-notif__list" role="list">
        {items === null ? (
          error ? (
            <p className="fr-notif__empty">Notifications couldn’t be loaded. Try again in a moment.</p>
          ) : (
            <div className="fr-notif__loading">
              <Spinner size={20} />
            </div>
          )
        ) : items.length === 0 ? (
          <div className="fr-notif__empty">
            <Bell size={22} aria-hidden />
            <p>Nothing new. Mentions, replies to your comments, boards shared with you and access requests show up here.</p>
          </div>
        ) : (
          items.map((n) => <Item key={n.id} n={n} now={now} onOpen={() => openItem(n)} />)
        )}
        {hasMore && (
          <div className="fr-notif__more">
            <Button size="sm" variant="ghost" loading={loading} onClick={() => void loadMoreNotifications()}>
              Show older
            </Button>
          </div>
        )}
      </div>
      <div className="fr-notif__foot">
        <Link to="/settings#notifications" className="fr-notif__settings" onClick={onNavigate}>
          <Settings size={14} aria-hidden /> Email settings
        </Link>
      </div>
    </div>
  );
}

function Item({ n, now, onOpen }: { n: AppNotification; now: number; onOpen: () => void }) {
  const Icon = TYPE_ICON[n.type] ?? Bell;
  const button = (
    <button type="button" role="listitem" className={`fr-notif-item${n.readAt ? '' : ' is-unread'}`} onClick={onOpen}>
      <span className="fr-notif-item__avatar">
        <Avatar name={n.actor?.name ?? 'Someone'} color={n.actor?.color ?? '#8a89a3'} src={n.actor?.avatarUrl ?? null} size={32} />
        <span className="fr-notif-item__type" aria-hidden>
          <Icon size={11} strokeWidth={2.5} />
        </span>
      </span>
      <span className="fr-notif-item__main">
        <span className="fr-notif-item__title">{n.title}</span>
        {n.body ? <span className="fr-notif-item__body">{n.body}</span> : null}
        <span className="fr-notif-item__time">{relativeTime(n.createdAt, now)}</span>
      </span>
      {!n.readAt && <span className="fr-notif-item__dot" aria-label="Unread" />}
    </button>
  );
  if (!n.accessRequest || !n.boardId || !n.actor) return button;
  return (
    <div className={`fr-notif-req${n.readAt ? '' : ' is-unread'}`}>
      {button}
      <RequestActions id={n.id} unread={!n.readAt} boardId={n.boardId} requester={n.actor} request={n.accessRequest} />
    </div>
  );
}

/** Approve (as a role) / decline right in the inbox, or what became of the request. */
function RequestActions({
  id,
  unread,
  boardId,
  requester,
  request,
}: {
  id: string;
  unread: boolean;
  boardId: string;
  requester: NonNullable<AppNotification['actor']>;
  request: NonNullable<AppNotification['accessRequest']>;
}) {
  const notify = useToast();
  const [role, setRole] = useState<GrantRole>(request.role);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const decide = async (decision: 'approve' | 'deny') => {
    setBusy(decision);
    try {
      await api.decideAccessRequest(boardId, requester.id, decision, decision === 'approve' ? role : undefined);
      setDone(decision === 'approve' ? `Approved · ${GRANT_LABEL[role]}` : 'Declined');
      // Answered: nothing left to look at.
      if (unread) await markNotificationsRead([id]);
      void loadNotifications();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not answer the request', 'error');
      void loadNotifications();
    } finally {
      setBusy(null);
    }
  };

  if (done || !request.canDecide) {
    const label =
      done ??
      (request.status === 'approved' && request.decidedRole
        ? `Approved · ${GRANT_LABEL[request.decidedRole]}`
        : request.status === 'pending'
          ? 'Waiting for the board’s owner'
          : OUTCOME[request.status]);
    return <div className="fr-notif-req__outcome">{label}</div>;
  }
  return (
    <div className="fr-notif-req__actions">
      <Select<GrantRole> aria-label={`Let ${requester.name} in as`} size="sm" options={GRANT_OPTIONS} value={role} onChange={setRole} width={136} />
      <Button size="sm" variant="primary" loading={busy === 'approve'} disabled={busy !== null} onClick={() => void decide('approve')}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" loading={busy === 'deny'} disabled={busy !== null} onClick={() => void decide('deny')}>
        Decline
      </Button>
    </div>
  );
}
