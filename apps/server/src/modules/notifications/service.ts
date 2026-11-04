// Notifications: created from trusted server-side events (comment messages realtime applied from
// an authenticated socket, boards shared through the members API), listed in the app's inbox,
// delivered live to open tabs (live.ts), sent at once as a Slack direct message to people who
// connected Slack (#105), and emailed as batched digests — each one by Slack or by email, never both.
import { mac, macMatches } from '../../platform/secrets';
import type { AppNotification, BoardChangesFrequency, NotificationPrefs, NotificationsResponse, NotificationType } from '@freero/shared';
import { guestDisplayName, isGuestId, mentionedUserIds, mentionsAsNames } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { newId } from '../../platform/ids';
import { log, logError } from '../../platform/log';
import { appUrl, renderMail, sendMail } from '../../platform/mail';
import { getAccount, getGuests, getUsers } from '../auth/index';
import { boardWorkspaceId, getBoardAccess, getBoardTitle } from '../boards/index';
import {
  accessRequestOutcomes,
  invitedEmails,
  type AccessDecidedEvent,
  type AccessRequestedEvent,
  type BoardSharedEvent,
  type InviteAcceptedEvent,
} from '../members/index';
import type { CommentMessageEvent } from '../realtime/index';
import { sendSlackDm, slackConnectOffered, slackLinked, slackMayReach } from '../slack/index';
import { setBoardChangesFrequency } from './boardChanges';
import * as live from './live';
import { slackDeliveries } from './metrics';
import * as repo from './repo';
import { isNotificationType, NOTIFICATION_TYPES, type NotificationData } from './types';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  /** Who caused it; never notified about their own action. */
  actorId: string | null;
  /** Board it is about: only people with access to it are notified. */
  boardId: string | null;
  /** About something only owners and editors of that board can see (a hidden frame's content). */
  editorsOnly?: boolean;
  data: NotificationData;
  /** Each recipient gets at most one notification per key. */
  dedupeKey?: string;
}

/** Creates a notification (unless it is about the recipient's own action, a board they can't open, or a duplicate). */
export async function notify(n: NewNotification): Promise<boolean> {
  if (n.actorId && n.actorId === n.userId) return false;
  if (isGuestId(n.userId)) return false; // guests have no inbox
  if (n.actorId && isGuestId(n.actorId)) throw new Error('notify: a guest is not an account; pass actorId null and data.actorName');
  const access = n.boardId ? await getBoardAccess(n.boardId, n.userId) : null;
  if (access && (!access.role || (n.editorsOnly && access.role !== 'owner' && access.role !== 'editor'))) return false;
  // About a doc (KAI-162): its links open the doc page.
  const data = access?.kind === 'doc' ? { ...n.data, objectKind: 'doc' as const } : n.data;
  const id = newId(16);
  const created = await repo.insert({
    id,
    userId: n.userId,
    type: n.type,
    actorId: n.actorId,
    boardId: n.boardId,
    data,
    dedupeKey: n.dedupeKey ?? null,
    createdAt: Date.now(),
  });
  if (created) {
    live.changed(n.userId);
    // Once it is committed: a notification rolled back with its cause never reaches Slack.
    repo.afterCommit(() => track(toSlack({ id, userId: n.userId, type: n.type, actorId: n.actorId, boardId: n.boardId, data })));
  }
  return created;
}

// ---- Slack direct messages (#105) ----

const slackInFlight = new Set<Promise<unknown>>();
const track = (p: Promise<unknown>) => {
  slackInFlight.add(p);
  void p.finally(() => slackInFlight.delete(p));
};

/** Resolves once every Slack message started so far is done (shutdown, tests). */
export async function slackDeliveriesSettled(): Promise<void> {
  while (slackInFlight.size) await Promise.allSettled([...slackInFlight]);
}

/**
 * A new notification, as a direct message to the person's Slack when they connected one and want
 * this type there. Claimed first (repo.claimForSlack), so it is sent at most once and the email
 * digest leaves it out; handed back to the digest if Slack refused it. Never throws.
 */
async function toSlack(n: { id: string; userId: string; type: NotificationType; actorId: string | null; boardId: string | null; data: NotificationData }): Promise<void> {
  let outcome: 'sent' | 'failed' | 'skipped' = 'skipped';
  try {
    const def = NOTIFICATION_TYPES[n.type];
    if (def.direct) return;
    const on = (await repo.slackPrefs(n.userId)).get(n.type) ?? def.slackByDefault === true;
    if (!on || !(await slackLinked(n.userId))) return;
    // About a board, doc or workspace whose team keeps apps out (API access off, the app blocked,
    // an IP allowlist it isn't exempt from): left to the email, like any app would be refused.
    const boardId = n.boardId ?? n.data.requestedBoardId ?? null;
    const workspaceId = (boardId ? await boardWorkspaceId(boardId) : null) ?? n.data.workspaceId ?? null;
    if (workspaceId && !(await slackMayReach(n.userId, workspaceId))) return;
    if (!(await repo.claimForSlack(n.id, Date.now()))) return;
    const actor = n.actorId ? (await getUsers([n.actorId])).get(n.actorId)?.name : undefined;
    const sent = await sendSlackDm(n.userId, {
      title: def.title(actor ?? n.data.actorName ?? 'Someone', n.data),
      quote: n.data.excerpt,
      url: appUrl(null, def.link(n.boardId, n.data)),
      linkLabel: def.linkLabel,
    });
    if (sent === 'sent') outcome = 'sent';
    else {
      outcome = 'failed';
      await repo.unclaimSlack(n.id);
    }
  } catch (e) {
    outcome = 'failed';
    logError('notifications: could not send to Slack; leaving it to the email', e);
    await repo.unclaimSlack(n.id).catch(() => undefined);
  } finally {
    slackDeliveries.inc({ outcome });
  }
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
  // A thread on someone's private draft: nobody else can read it (KAI-234).
  if (e.layer === 'private') return;
  // On an item in a hidden frame: only people who can see it hear about it, and no invite is
  // promised a thread they could not open.
  const editorsOnly = e.layer === 'editors';
  // A guest (no account, on a shared link) can't mention anyone: an anonymous visitor must not be
  // able to page a board's members or reach invited addresses. Their replies still notify.
  const guest = isGuestId(e.authorId);
  const before = new Set(e.previousText === null ? [] : mentionedUserIds(e.previousText));
  const mentioned = guest ? [] : mentionedUserIds(e.text);
  const newMentions = mentioned.filter((id) => !before.has(id) && id !== e.authorId);
  const replyTo = e.previousText === null ? e.participantIds.filter((id) => !mentioned.includes(id) && !isGuestId(id)) : [];
  // Addresses of people invited to the board who have no account yet: notified once they join.
  const hadEmails = new Set(e.previousText === null ? [] : emailsIn(e.previousText));
  const invited = guest || editorsOnly ? [] : await invitedEmails(e.boardId, emailsIn(e.text).filter((m) => !hadEmails.has(m)));
  if (!newMentions.length && !replyTo.length && !invited.length) return;
  const [boardTitle, names, guests] = await Promise.all([getBoardTitle(e.boardId), getUsers(mentionedUserIds(e.text)), guest ? getGuests([e.authorId]) : null]);
  if (boardTitle === null) return;
  const data: NotificationData = {
    boardTitle,
    threadId: e.threadId,
    messageId: e.messageId,
    excerpt: shorten(mentionsAsNames(e.text, (id) => names.get(id)?.name)),
    ...(guest ? { actorName: guestDisplayName(guests?.get(e.authorId)?.name ?? 'visitor') } : {}),
  };
  const actorId = guest ? null : e.authorId;
  const key = `${e.boardId}:${e.threadId}:${e.messageId}`;
  for (const userId of newMentions)
    await notify({ userId, type: 'comment.mention', actorId, boardId: e.boardId, data, dedupeKey: `mention:${key}`, editorsOnly });
  for (const userId of replyTo)
    await notify({ userId, type: 'comment.reply', actorId, boardId: e.boardId, data, dedupeKey: `reply:${key}`, editorsOnly });
  for (const email of invited)
    await repo.addPendingMention({ id: newId(16), boardId: e.boardId, email, actorId: e.authorId, data, dedupeKey: `mention:${key}`, createdAt: Date.now() });
}

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Distinct email addresses written in a comment (lower case, as invites store them). */
export function emailsIn(text: string): string[] {
  return [...new Set([...text.matchAll(EMAIL_IN_TEXT)].map((m) => m[0].toLowerCase()))];
}

/** Someone asked for access: the people who decide hear about it (with the requester's message). */
export async function onAccessRequested(e: AccessRequestedEvent): Promise<void> {
  const data: NotificationData = { boardTitle: e.boardTitle, role: e.role, ...(e.message ? { excerpt: shorten(e.message) } : {}) };
  for (const userId of e.recipientIds)
    await notify({ userId, type: 'access.request', actorId: e.requesterId, boardId: e.boardId, data, dedupeKey: `access:${e.boardId}:${e.requesterId}:${e.createdAt}` });
}

/**
 * The requester hears back. A "no" doesn't name the board's title (they never had access) and
 * isn't tied to the board: the notification links to the board's request page instead.
 */
export async function onAccessDecided(e: AccessDecidedEvent): Promise<void> {
  await notify(
    e.approved
      ? { userId: e.requesterId, type: 'access.response', actorId: e.deciderId, boardId: e.boardId, data: { boardTitle: e.boardTitle, role: e.role ?? undefined, approved: true } }
      : { userId: e.requesterId, type: 'access.response', actorId: e.deciderId, boardId: null, data: { approved: false, requestedBoardId: e.boardId } },
  );
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

type Outcomes = Awaited<ReturnType<typeof accessRequestOutcomes>>;

function present(
  r: repo.NotificationRow,
  actors: Map<string, { id: string; name: string; color: string; avatarUrl: string | null }>,
  outcomes: Outcomes,
): AppNotification | null {
  if (!isNotificationType(r.type)) return null; // a type this version does not know (newer instance)
  const def = NOTIFICATION_TYPES[r.type];
  const actor = r.actorId ? actors.get(r.actorId) : undefined;
  const request = r.type === 'access.request' && r.boardId && actor ? outcomes.get(`${r.boardId}:${actor.id}`) : undefined;
  return {
    id: r.id,
    type: r.type,
    createdAt: r.createdAt,
    readAt: r.readAt,
    actor: actor ? { id: actor.id, name: actor.name, color: actor.color, avatarUrl: actor.avatarUrl } : null,
    title: def.title(actor?.name ?? r.data.actorName ?? 'Someone', r.data),
    body: r.data.excerpt ?? '',
    link: def.link(r.boardId, r.data),
    boardId: r.boardId,
    ...(request ? { accessRequest: request } : {}),
  };
}

export async function listFor(userId: string, opts: { before?: number | null; limit?: number } = {}): Promise<NotificationsResponse> {
  const limit = Math.min(MAX_PAGE, Math.max(1, opts.limit ?? DEFAULT_PAGE));
  const [rows, unread] = await Promise.all([repo.list(userId, limit, opts.before ?? null), repo.unreadCount(userId)]);
  const page = rows.slice(0, limit);
  const actors = await getUsers(page.flatMap((r) => (r.actorId ? [r.actorId] : [])));
  const requests = page.filter((r) => r.type === 'access.request' && r.boardId && r.actorId);
  const outcomes = await accessRequestOutcomes(
    userId,
    requests.map((r) => ({ boardId: r.boardId!, requesterId: r.actorId!, createdAt: r.createdAt })),
  );
  return {
    notifications: page.map((r) => present(r, actors, outcomes)).filter((n): n is AppNotification => n !== null),
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
/** The unsubscribe list of the "changes on your boards" email (boardChanges.ts). */
export const BOARD_CHANGES_LIST = 'board-changes';

export async function prefsFor(userId: string): Promise<NotificationPrefs> {
  const [p, slack] = await Promise.all([repo.prefs(userId), repo.slackPrefs(userId)]);
  return {
    emailAll: p.get(ALL) ?? true,
    types: (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).filter((type) => !NOTIFICATION_TYPES[type].direct).map((type) => ({
      type,
      label: NOTIFICATION_TYPES[type].label,
      description: NOTIFICATION_TYPES[type].description,
      email: p.get(type) ?? true,
      slack: slack.get(type) ?? NOTIFICATION_TYPES[type].slackByDefault === true,
    })),
    boardChanges: (await repo.boardChangeDigestOf(userId))?.frequency ?? 'off',
    slack: slackConnectOffered() ? { linked: await slackLinked(userId) } : null,
  };
}

export async function updatePrefs(
  userId: string,
  patch: {
    emailAll?: boolean;
    email?: Partial<Record<NotificationType, boolean>>;
    slack?: Partial<Record<NotificationType, boolean>>;
    boardChanges?: BoardChangesFrequency;
  },
): Promise<NotificationPrefs> {
  if (typeof patch.emailAll === 'boolean') await repo.setPref(userId, ALL, patch.emailAll);
  if (patch.boardChanges) await setBoardChangesFrequency(userId, patch.boardChanges);
  for (const [type, on] of Object.entries(patch.email ?? {})) if (isNotificationType(type) && typeof on === 'boolean') await repo.setPref(userId, type, on);
  for (const [type, on] of Object.entries(patch.slack ?? {}))
    if (isNotificationType(type) && !NOTIFICATION_TYPES[type].direct && typeof on === 'boolean') await repo.setSlackPref(userId, type, on);
  return prefsFor(userId);
}

// ---- one-click unsubscribe (signed link, no session) ----

// Signed through platform/secrets (same digest as before, so links already sent keep working;
// links signed under SESSION_SECRET_PREVIOUS keep working through a rotation).
// A token for one list (the "changes on your boards" email) is signed over its name too, so it
// can't be used for another list, and an all-emails token can't be bent into a list one.
const message = (userId: string, list?: string) => `notifications.unsubscribe:${userId}${list ? `:${list}` : ''}`;

/** The signed unsubscribe link token: every notification email, or only `list`. */
export function unsubscribeToken(userId: string, list?: string): string {
  return `${Buffer.from(userId).toString('base64url')}.${mac(message(userId, list)).toString('base64url')}`;
}

/** The user the token was made for (for `list`, when given), or null when it is not one of ours. */
export function verifyUnsubscribeToken(token: string, list?: string): string | null {
  const [id, sig] = token.split('.');
  if (!id || !sig) return null;
  const given = Buffer.from(sig, 'base64url');
  // Only the exact token we issued: base64url decoding ignores a final character's spare bits (and
  // stray characters), so a link altered there would otherwise still verify.
  if (given.toString('base64url') !== sig) return null;
  const userId = Buffer.from(id, 'base64url').toString();
  if (Buffer.from(userId).toString('base64url') !== id) return null;
  return macMatches(message(userId, list), given) ? userId : null;
}

/**
 * Turns all notification emails off for the token's user, or with `list` 'board-changes' only
 * the "changes on your boards" email; returns their address (null: bad token).
 */
export async function unsubscribe(token: string, list?: string): Promise<string | null> {
  if (list !== undefined && list !== BOARD_CHANGES_LIST) return null;
  const userId = verifyUnsubscribeToken(token, list);
  if (!userId) return null;
  let email: string;
  try {
    email = (await getAccount(userId)).email;
  } catch {
    return null; // account gone
  }
  if (list === BOARD_CHANGES_LIST) await repo.setBoardChangeDigest(userId, null, Date.now());
  else await repo.setPref(userId, ALL, false);
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
    // Direct types were emailed on their own when they were created; ones sent to Slack (#105)
    // reached the person there.
    const due = claimed.filter(
      (r) => r.readAt === null && r.slackedAt === null && isNotificationType(r.type) && !NOTIFICATION_TYPES[r.type].direct && prefs.get(r.type) !== false,
    );
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
      heading: def.title(actors.get(r.actorId ?? '')?.name ?? r.data.actorName ?? 'Someone', r.data),
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
