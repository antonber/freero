// Every kind of notification, in one place: how it reads in the inbox and the email digest, where
// it links, and how it is offered in the email settings. A new source (workspace invites, …) adds
// its type to NotificationType (@freero/shared) and an entry here, then calls `notify` from its
// module (through notifications/index.ts) or from a listener in init.ts.
import type { NotificationType } from '@freero/shared';
import { t } from './messages';

/** What a notification stores (`notifications.data`), worded when it is created. */
export interface NotificationData {
  boardTitle?: string;
  /** The container is a doc (KAI-162): links open /doc/<id>. */
  objectKind?: 'doc';
  threadId?: string;
  messageId?: string;
  /** Comment text, mentions shown as names, shortened. */
  excerpt?: string;
  role?: string;
  /** Workspace notifications: the workspace it is about. */
  workspaceId?: string;
  workspaceName?: string;
  /** access.response: approved or declined. */
  approved?: boolean;
  /**
   * access.response when declined: the board asked for. Stored here, not as the notification's
   * board — the requester has no access to it, and its title is not theirs to see.
   */
  requestedBoardId?: string;
  /** Who caused it when that is not an account (a guest on a shared link): their display name. */
  actorName?: string;
  /** Moderation notices: what was done (a ModerationActionKind) and the signed appeal page. */
  moderationAction?: string;
  appealPath?: string;
  /** Task cards (KAI-135): the card, its title then, and its due date (YYYY-MM-DD) or null. */
  elementId?: string;
  cardTitle?: string;
  dueDate?: string | null;
  /** Walkthroughs (KAI-133): the recording, its title, and the moment a comment is pinned to. */
  walkthroughId?: string;
  walkthroughTitle?: string;
  atMs?: number;
}

/** The reader's interface language (#5), or null for English. */
type L = string | null | undefined;

export interface NotificationTypeDef {
  /** Settings: the email toggle. */
  label(locale: L): string;
  description(locale: L): string;
  /** Inbox and digest headline, in the reader's language. */
  title(locale: L, actorName: string, d: NotificationData): string;
  /** App path it opens. */
  link(boardId: string | null, d: NotificationData): string;
  /** Digest link text. */
  linkLabel(locale: L): string;
  /**
   * Emailed on its own by the module that creates it (not in digests, no email setting): notices
   * people must get whatever their preferences, like moderation decisions.
   */
  direct?: boolean;
  /**
   * Sent to Slack as a direct message unless the person turned it off, once they connected Slack
   * (#105). Types without it are offered for Slack too, off until turned on (noisier ones).
   */
  slackByDefault?: boolean;
}

const board = (l: L, d: NotificationData) => t(l, 'quoted', { title: d.boardTitle || (d.objectKind === 'doc' ? t(l, 'untitledDoc') : t(l, 'untitledBoard')) });
const boardPath = (id: string | null, d?: NotificationData) => (id ? `/${d?.objectKind === 'doc' ? 'doc' : 'board'}/${encodeURIComponent(id)}` : '/app');
const threadPath = (id: string | null, d: NotificationData) =>
  d.threadId ? `${boardPath(id, d)}?thread=${encodeURIComponent(d.threadId)}` : boardPath(id, d);

const itemPath = (id: string | null, d: NotificationData) =>
  d.elementId ? `${boardPath(id, d)}?item=${encodeURIComponent(d.elementId)}` : boardPath(id, d);
/** Opens the walkthrough at the comment's moment (the walkthrough feature's `?walkthrough=&t=` deep link). */
const walkthroughPath = (id: string | null, d: NotificationData) =>
  d.walkthroughId ? `${boardPath(id)}?walkthrough=${encodeURIComponent(d.walkthroughId)}${d.atMs !== undefined ? `&t=${Math.max(0, Math.round(d.atMs))}` : ''}` : boardPath(id);
const walkthrough = (l: L, d: NotificationData) => t(l, 'walkthrough', { title: d.walkthroughTitle || t(l, 'untitledWalkthrough') });
const card = (l: L, d: NotificationData) => t(l, 'quoted', { title: d.cardTitle || t(l, 'untitledCard') });
/** "Fri 30 Oct" (due dates are calendar days, read in UTC so every reader agrees), in the reader's language. */
export const dueDay = (date: string, locale?: L): string => {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const lang = !locale || locale === 'en' ? 'en-GB' : locale;
  return Number.isNaN(ms) ? date : new Date(ms).toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const role = (d: NotificationData) => d.role ?? '';

/** Moderation notices by action (modules/moderation). */
const MODERATION_TITLE: Record<string, (l: L, d: NotificationData) => string> = {
  'board.disable_link': (l, d) => t(l, 'moderation.board.disable_link', { board: board(l, d) }),
  'board.restore_link': (l, d) => t(l, 'moderation.board.restore_link', { board: board(l, d) }),
  'board.take_down': (l, d) => t(l, 'moderation.board.take_down', { board: board(l, d) }),
  'board.restore': (l, d) => t(l, 'moderation.board.restore', { board: board(l, d) }),
  'board.delete': (l, d) => t(l, 'moderation.board.delete', { board: board(l, d) }),
  'upload.remove': (l, d) => (d.boardTitle ? t(l, 'moderation.upload.removeOn', { board: board(l, d) }) : t(l, 'moderation.upload.remove')),
  'upload.restore': (l) => t(l, 'moderation.upload.restore'),
  // Community listings (#87): `boardTitle` carries the listing's name.
  'listing.approve': (l, d) => t(l, 'moderation.listing.approve', { listing: d.boardTitle ?? '' }),
  'listing.reject': (l, d) => t(l, 'moderation.listing.reject', { listing: d.boardTitle ?? '' }),
  'listing.remove': (l, d) => t(l, 'moderation.listing.remove', { listing: d.boardTitle ?? '' }),
  'listing.restore': (l, d) => t(l, 'moderation.listing.restore', { listing: d.boardTitle ?? '' }),
};

export const NOTIFICATION_TYPES: Record<NotificationType, NotificationTypeDef> = {
  'access.request': {
    label: (l) => t(l, 'access.request.label'),
    description: (l) => t(l, 'access.request.description'),
    linkLabel: (l) => t(l, 'access.request.link'),
    title: (l, actor, d) => t(l, 'access.request.title', { actor, role: role(d), board: board(l, d) }),
    link: (id, d) => `${boardPath(id, d)}?share=requests`,
    slackByDefault: true,
  },
  'access.response': {
    label: (l) => t(l, 'access.response.label'),
    description: (l) => t(l, 'access.response.description'),
    linkLabel: (l) => t(l, 'access.response.link'),
    title: (l, actor, d) => (d.approved ? t(l, 'access.response.approved', { actor, role: role(d), board: board(l, d) }) : t(l, 'access.response.declined', { actor })),
    link: (id, d) => boardPath(id ?? d.requestedBoardId ?? null, d),
    slackByDefault: true,
  },
  'comment.mention': {
    label: (l) => t(l, 'comment.mention.label'),
    description: (l) => t(l, 'comment.mention.description'),
    linkLabel: (l) => t(l, 'comment.mention.link'),
    title: (l, actor, d) => t(l, 'comment.mention.title', { actor, board: board(l, d) }),
    link: threadPath,
    slackByDefault: true,
  },
  'comment.reply': {
    label: (l) => t(l, 'comment.reply.label'),
    description: (l) => t(l, 'comment.reply.description'),
    linkLabel: (l) => t(l, 'comment.reply.link'),
    title: (l, actor, d) => t(l, 'comment.reply.title', { actor, board: board(l, d) }),
    link: threadPath,
    slackByDefault: true,
  },
  'board.invite': {
    label: (l) => t(l, 'board.invite.label'),
    description: (l) => t(l, 'board.invite.description'),
    linkLabel: (l) => t(l, 'board.invite.link'),
    title: (l, actor, d) => t(l, 'board.invite.title', { actor, role: role(d), board: board(l, d) }),
    link: (id, d) => boardPath(id, d),
    slackByDefault: true,
  },
  'workspace.invite': {
    label: (l) => t(l, 'workspace.invite.label'),
    description: (l) => t(l, 'workspace.invite.description'),
    linkLabel: (l) => t(l, 'workspace.invite.link'),
    title: (l, actor, d) => t(l, 'workspace.invite.title', { actor, workspace: d.workspaceName || t(l, 'team'), role: d.role || 'member' }),
    link: (_id, d) => (d.workspaceId ? `/app?ws=${encodeURIComponent(d.workspaceId)}` : '/app'),
    slackByDefault: true,
  },
  'card.assigned': {
    label: (l) => t(l, 'card.assigned.label'),
    description: (l) => t(l, 'card.assigned.description'),
    linkLabel: (l) => t(l, 'card.assigned.link'),
    title: (l, actor, d) =>
      d.dueDate
        ? t(l, 'card.assigned.titleDue', { actor, card: card(l, d), board: board(l, d), due: dueDay(d.dueDate, l) })
        : t(l, 'card.assigned.title', { actor, card: card(l, d), board: board(l, d) }),
    link: itemPath,
    slackByDefault: true,
  },
  'card.due_changed': {
    label: (l) => t(l, 'card.due_changed.label'),
    description: (l) => t(l, 'card.due_changed.description'),
    linkLabel: (l) => t(l, 'card.due_changed.link'),
    title: (l, actor, d) =>
      d.dueDate
        ? t(l, 'card.due_changed.set', { actor, card: card(l, d), board: board(l, d), due: dueDay(d.dueDate, l) })
        : t(l, 'card.due_changed.removed', { actor, card: card(l, d), board: board(l, d) }),
    link: itemPath,
    slackByDefault: true,
  },
  'card.due_soon': {
    label: (l) => t(l, 'card.due_soon.label'),
    description: (l) => t(l, 'card.due_soon.description'),
    linkLabel: (l) => t(l, 'card.due_soon.link'),
    title: (l, _actor, d) => t(l, 'card.due_soon.title', { card: card(l, d), board: board(l, d), due: d.dueDate ? dueDay(d.dueDate, l) : t(l, 'soon') }),
    link: itemPath,
    slackByDefault: true,
  },
  // KAI-249: from modules/api's control room. The actor is the app or token (`actorName`), acting
  // for the recipient; the excerpt is the task's note as the agent wrote it.
  'agent.blocked': {
    label: (l) => t(l, 'agent.blocked.label'),
    description: (l) => t(l, 'agent.blocked.description'),
    linkLabel: (l) => t(l, 'agent.blocked.link'),
    title: (l, actor, d) => t(l, 'agent.blocked.title', { actor, card: card(l, d), board: board(l, d) }),
    link: itemPath,
    slackByDefault: true,
  },
  'walkthrough.mention': {
    label: (l) => t(l, 'walkthrough.mention.label'),
    description: (l) => t(l, 'walkthrough.mention.description'),
    linkLabel: (l) => t(l, 'walkthrough.mention.link'),
    title: (l, actor, d) => t(l, 'walkthrough.mention.title', { actor, walkthrough: walkthrough(l, d), board: board(l, d) }),
    link: walkthroughPath,
    slackByDefault: true,
  },
  'walkthrough.comment': {
    label: (l) => t(l, 'walkthrough.comment.label'),
    description: (l) => t(l, 'walkthrough.comment.description'),
    linkLabel: (l) => t(l, 'walkthrough.comment.link'),
    title: (l, actor, d) => t(l, 'walkthrough.comment.title', { actor, walkthrough: walkthrough(l, d), board: board(l, d) }),
    link: walkthroughPath,
  },
  // #127: the excerpt is the emoji. One per person per walkthrough (dedupe), not one per click.
  'walkthrough.reaction': {
    label: (l) => t(l, 'walkthrough.reaction.label'),
    description: (l) => t(l, 'walkthrough.reaction.description'),
    linkLabel: (l) => t(l, 'walkthrough.reaction.link'),
    title: (l, actor, d) => t(l, 'walkthrough.reaction.title', { actor, emoji: d.excerpt ?? '', walkthrough: walkthrough(l, d), board: board(l, d) }).replace(/\s+/g, ' '),
    link: walkthroughPath,
  },
  // modules/problems: an operator marked a problem the person reported as fixed. The excerpt is
  // the start of their own note, so they recognise which one.
  'problem.fixed': {
    label: (l) => t(l, 'problem.fixed.label'),
    description: (l) => t(l, 'problem.fixed.description'),
    linkLabel: (l) => t(l, 'problem.fixed.link'),
    title: (l) => t(l, 'problem.fixed.title'),
    link: () => '/settings#problems',
  },
  'moderation.action': {
    label: (l) => t(l, 'moderation.action.label'),
    description: (l) => t(l, 'moderation.action.description'),
    linkLabel: (l) => t(l, 'moderation.action.link'),
    title: (l, _actor, d) => MODERATION_TITLE[d.moderationAction ?? '']?.(l, d) ?? t(l, 'moderation.action.title'),
    link: (id, d) => d.appealPath ?? boardPath(id, d),
    direct: true,
  },
};

export const isNotificationType = (x: unknown): x is NotificationType =>
  typeof x === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, x);
