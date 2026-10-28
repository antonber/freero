// The bell in the top bar (dashboard and board): unread badge, and the inbox in a popover. Each
// item opens its link — the board, or the board with the comment thread open.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AtSign, Bell, CheckCheck, MessageSquareReply, Settings, ShieldAlert, UserPlus, Users } from 'lucide-react';
import type { AppNotification, NotificationType } from '@freero/shared';
import { Avatar, Button, IconButton, Popover, Spinner } from '@ui';
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
  'moderation.action': ShieldAlert,
};

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
            <p>Nothing new. Mentions, replies to your comments and boards shared with you show up here.</p>
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
  return (
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
}
