// Notifications: created from trusted server-side events (comment messages realtime applied from
// an authenticated socket, boards shared through the members API), listed in the app's inbox,
// delivered live to open tabs (live.ts) and emailed as batched digests.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppNotification, NotificationPrefs, NotificationsResponse, NotificationType } from '@freero/shared';
import { mentionedUserIds, mentionsAsNames } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { newId } from '../../platform/ids';
import { log, logError } from '../../platform/log';
import { appUrl, renderMail, sendMail } from '../../platform/mail';
import { getAccount, getUsers } from '../auth/index';
import { getBoardAccess, getBoardTitle } from '../boards/index';
import { invitedEmails, type BoardSharedEvent, type InviteAcceptedEvent } from '../members/index';
import type { CommentMessageEvent } from '../realtime/index';
import * as live from './live';
import * as repo from './repo';
import { isNotificationType, NOTIFICATION_TYPES, type NotificationData } from './types';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  /** Who caused it; never notified about their own action. */
  actorId: string | null;
  /** Board it is about: only people with access to it are notified. */
  boardId: string | null;
  data: NotificationData;
  /** Each recipient gets at most one notification per key. */
  dedupeKey?: string;
}

/** Creates a notification (unless it is about the recipient's own action, a board they can't open, or a duplicate). */
export async function notify(n: NewNotification): Promise<boolean> {
  if (n.actorId && n.actorId === n.userId) return false;
  if (n.boardId && !(await getBoardAccess(n.boardId, n.userId)).role) return false;
  const created = await repo.insert({
    id: newId(16),
    userId: n.userId,
    type: n.type,
    actorId: n.actorId,
    boardId: n.boardId,
    data: n.data,
    dedupeKey: n.dedupeKey ?? null,
    createdAt: Date.now(),
  });
  if (created) live.changed(n.userId);
  return created;
}

const EXCERPT_MAX = 280;
const shorten = (s: string, max = EXCERPT_MAX) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/**
 * A comment message was written or edited (realtime, attributed to the author's socket). New
 * @mentions notify the mentioned people; a new message also notifies everyone else in the thread.
 * One notification per person per message: a mention wins over a reply.
 */
export async function onCommentMessage(e: CommentMessageEvent): Promise<void> {
  const before = new Set(e.previousText === null ? [] : mentionedUserIds(e.previousText));
  const mentioned = mentionedUserIds(e.text);
  const newMentions = mentioned.filter((id) => !before.has(id) && id !== e.authorId);
  const replyTo = e.previousText === null ? e.participantIds.filter((id) => !mentioned.includes(id)) : [];
  // Addresses of people invited to the board who have no account yet: notified once they join.
  const hadEmails = new Set(e.previousText === null ? [] : emailsIn(e.previousText));
  const invited = await invitedEmails(e.boardId, emailsIn(e.text).filter((m) => !hadEmails.has(m)));
  if (!newMentions.length && !replyTo.length && !invited.length) return;
  const [boardTitle, names] = await Promise.all([getBoardTitle(e.boardId), getUsers(mentioned)]);
  if (boardTitle === null) return;
  const data: NotificationData = {
    boardTitle,
    threadId: e.threadId,
    messageId: e.messageId,
    excerpt: shorten(mentionsAsNames(e.text, (id) => names.get(id)?.name)),
  };
  const key = `${e.boardId}:${e.threadId}:${e.messageId}`;
  for (const userId of newMentions)
    await notify({ userId, type: 'comment.mention', actorId: e.authorId, boardId: e.boardId, data, dedupeKey: `mention:${key}` });
  for (const userId of replyTo)
    await notify({ userId, type: 'comment.reply', actorId: e.authorId, boardId: e.boardId, data, dedupeKey: `reply:${key}` });
  for (const email of invited)
    await repo.addPendingMention({ id: newId(16), boardId: e.boardId, email, actorId: e.authorId, data, dedupeKey: `mention:${key}`, createdAt: Date.now() });
}

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Distinct email addresses written in a comment (lower case, as invites store them). */
export function emailsIn(text: string): string[] {
  return [...new Set([...text.matchAll(EMAIL_IN_TEXT)].map((m) => m[0].toLowerCase()))];
}

/** A board was shared with an existing account. */
export async function onBoardShared(e: BoardSharedEvent): Promise<void> {
  await notify({ userId: e.userId, type: 'board.invite', actorId: e.byId, boardId: e.boardId, data: { boardTitle: e.boardTitle, role: e.role } });
}

/** How long a mention of an invited address waits for them to join (an invite's lifetime). */
const PENDING_MENTION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * An invite sent to an address became access: comments that named that address while the
 * person had no account become mentions for them (linking to the thread, like any mention).
 */
export async function onInviteAccepted(e: InviteAcceptedEvent): Promise<void> {
  for (const p of await repo.takePendingMentions(e.boardId, e.email, Date.now() - PENDING_MENTION_TTL_MS))
    await notify({ userId: e.userId, type: 'comment.mention', actorId: p.actorId, boardId: p.boardId, data: p.data, dedupeKey: p.dedupeKey });
}

/** Forgets mentions of invited addresses whose invite has expired meanwhile. */
export function sweepPendingMentions(now = Date.now()): Promise<void> {
  return repo.sweepPendingMentions(now - PENDING_MENTION_TTL_MS);
}

// ---- inbox ----

const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

function present(r: repo.NotificationRow, actors: Map<string, { id: string; name: string; color: string; avatarUrl: string | null }>): AppNotification | null {
  if (!isNotificationType(r.type)) return null; // a type this version does not know (newer instance)
  const def = NOTIFICATION_TYPES[r.type];
  const actor = r.actorId ? actors.get(r.actorId) : undefined;
  return {
    id: r.id,
    type: r.type,
    createdAt: r.createdAt,
    readAt: r.readAt,
    actor: actor ? { id: actor.id, name: actor.name, color: actor.color, avatarUrl: actor.avatarUrl } : null,
    title: def.title(actor?.name ?? 'Someone', r.data),
    body: r.data.excerpt ?? '',
    link: def.link(r.boardId, r.data),
    boardId: r.boardId,
  };
}

export async function listFor(userId: string, opts: { before?: number | null; limit?: number } = {}): Promise<NotificationsResponse> {
  const limit = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const [rows, unread] = await Promise.all([repo.list(userId, limit, opts.before ?? null), repo.unreadCount(userId)]);
  const page = rows.slice(0, limit);
  const actors = await getUsers(page.flatMap((r) => (r.actorId ? [r.actorId] : [])));
  return {
    notifications: page.map((r) => present(r, actors)).filter((n): n is AppNotification => n !== null),
    unread,
    hasMore: rows.length > limit,
  };
}

export async function markRead(userId: string, ids: string[] | null): Promise<number> {
  if ((await repo.markRead(userId, ids, Date.now())) > 0) live.changed(userId);
  return repo.unreadCount(userId);
}

// ---- email preferences ----

const ALL = '*';

export async function prefsFor(userId: string): Promise<NotificationPrefs> {
  const p = await repo.prefs(userId);
  return {
    emailAll: p.get(ALL) ?? true,
    types: (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).map((type) => ({
      type,
      label: NOTIFICATION_TYPES[type].label,
      description: NOTIFICATION_TYPES[type].description,
      email: p.get(type) ?? true,
    })),
  };
}

export async function updatePrefs(userId: string, patch: { emailAll?: boolean; email?: Partial<Record<NotificationType, boolean>> }): Promise<NotificationPrefs> {
  if (typeof patch.emailAll === 'boolean') await repo.setPref(userId, ALL, patch.emailAll);
  for (const [type, on] of Object.entries(patch.email ?? {})) if (isNotificationType(type) && typeof on === 'boolean') await repo.setPref(userId, type, on);
  return prefsFor(userId);
}

// ---- one-click unsubscribe (signed link, no session) ----

const sign = (userId: string) => createHmac('sha256', getConfig().sessionSecret).update(`notifications.unsubscribe:${userId}`).digest();

export function unsubscribeToken(userId: string): string {
  return `${Buffer.from(userId).toString('base64url')}.${sign(userId).toString('base64url')}`;
}

/** The user the token was made for, or null when it is not one of ours. */
export function verifyUnsubscribeToken(token: string): string | null {
  const [id, mac] = token.split('.');
  if (!id || !mac) return null;
  const userId = Buffer.from(id, 'base64url').toString();
  const given = Buffer.from(mac, 'base64url');
  const want = sign(userId);
  return given.length === want.length && timingSafeEqual(given, want) ? userId : null;
}

/** Turns all notification emails off for the token's user; returns their address (null: bad token). */
export async function unsubscribe(token: string): Promise<string | null> {
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return null;
  let email: string;
  try {
    email = (await getAccount(userId)).email;
  } catch {
    return null; // account gone
  }
  await repo.setPref(userId, ALL, false);
  return email;
}

// ---- email digests ----

/** Max people handled per run (the next run continues). */
const DIGEST_BATCH = 200;
const DIGEST_MAX_ITEMS = 20;

/**
 * Emails everyone whose oldest pending notification is older than the delay one digest with all of
 * them. Read ones, types they opted out of, unverified addresses and accounts being deleted are
 * skipped (and never emailed later). Claim-then-send: a failed send hands them back to the next run.
 */
export async function sendDigests(now = Date.now()): Promise<number> {
  const config = getConfig();
  let sent = 0;
  for (const userId of await repo.usersWithEmailDue(now - config.notifyEmailDelayMs, DIGEST_BATCH)) {
    const claimed = await repo.claimForEmail(userId, now);
    const prefs = await repo.prefs(userId);
    if (prefs.get(ALL) === false) continue;
    const due = claimed.filter((r) => r.readAt === null && isNotificationType(r.type) && prefs.get(r.type) !== false);
    if (!due.length) continue;
    let account;
    try {
      account = await getAccount(userId);
    } catch {
      continue; // deleted meanwhile
    }
    if (!account.emailVerified || account.deletionScheduledFor) continue;
    try {
      await sendMail({ to: account.email, ...(await renderDigest(userId, due)) });
      sent++;
    } catch (e) {
      await repo.unclaim(due.map((r) => r.id));
      logError('notifications: could not send a digest; retrying next run', e);
    }
  }
  if (sent) log(`notifications: sent ${sent} digest email(s)`);
  return sent;
}

async function renderDigest(userId: string, rows: repo.NotificationRow[]) {
  const actors = await getUsers(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])));
  const shown = rows.slice(-DIGEST_MAX_ITEMS);
  const items = shown.map((r) => {
    const def = NOTIFICATION_TYPES[r.type as NotificationType];
    return {
      heading: def.title(actors.get(r.actorId ?? '')?.name ?? 'Someone', r.data),
      quote: r.data.excerpt || undefined,
      link: { label: def.linkLabel, url: appUrl(null, def.link(r.boardId, r.data)) },
    };
  });
  const more = rows.length - shown.length;
  const token = unsubscribeToken(userId);
  const subject = rows.length === 1 ? items[0].heading : `${rows.length} new notifications on Freero`;
  return renderMail({
    subject,
    title: rows.length === 1 ? 'You have a new notification' : `You have ${rows.length} new notifications`,
    paragraphs: more > 0 ? [`Here are the latest ${shown.length}; ${more} more are waiting in Freero.`] : [],
    items,
    action: { label: 'Open Freero', url: appUrl(null, '/app') },
    outro: 'You get these emails for activity you haven’t seen in Freero yet. Choose which ones in your account settings.',
    unsubscribe: {
      label: 'Unsubscribe from notification emails',
      url: appUrl(null, `/unsubscribe?token=${encodeURIComponent(token)}`),
      oneClickUrl: appUrl(null, `/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`),
    },
  });
}
