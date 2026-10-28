// Every kind of notification, in one place: how it reads in the inbox and the email digest, where
// it links, and how it is offered in the email settings. A new source (workspace invites, …) adds
// its type to NotificationType (@freero/shared) and an entry here, then calls `notify` from its
// module (through notifications/index.ts) or from a listener in init.ts.
import type { NotificationType } from '@freero/shared';

/** What a notification stores (`notifications.data`), worded when it is created. */
export interface NotificationData {
  boardTitle?: string;
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
}

export interface NotificationTypeDef {
  /** Settings: the email toggle. */
  label: string;
  description: string;
  /** Inbox and digest headline. */
  title(actorName: string, d: NotificationData): string;
  /** App path it opens. */
  link(boardId: string | null, d: NotificationData): string;
  /** Digest link text. */
  linkLabel: string;
  /**
   * Emailed on its own by the module that creates it (not in digests, no email setting): notices
   * people must get whatever their preferences, like moderation decisions.
   */
  direct?: boolean;
}

const board = (d: NotificationData) => `“${d.boardTitle || 'Untitled board'}”`;
const boardPath = (id: string | null) => (id ? `/board/${encodeURIComponent(id)}` : '/app');
const threadPath = (id: string | null, d: NotificationData) =>
  d.threadId ? `${boardPath(id)}?thread=${encodeURIComponent(d.threadId)}` : boardPath(id);

const ROLE_PHRASE: Record<string, string> = { editor: 'edit', commenter: 'comment on', viewer: 'view' };

const ASK_PHRASE: Record<string, string> = { editor: 'edit', commenter: 'comment on', viewer: 'view' };

/** Moderation notices by action (modules/moderation). */
const MODERATION_TITLE: Record<string, (d: NotificationData) => string> = {
  'board.disable_link': (d) => `Freero’s moderators turned off link sharing for ${board(d)}`,
  'board.restore_link': (d) => `Link sharing works again for ${board(d)}`,
  'board.take_down': (d) => `Freero’s moderators removed ${board(d)} for review`,
  'board.restore': (d) => `${board(d)} is available again`,
  'board.delete': (d) => `Freero’s moderators deleted ${board(d)} for good`,
  'upload.remove': (d) => `Freero’s moderators removed a file of yours${d.boardTitle ? ` shown on ${board(d)}` : ''}`,
  'upload.restore': () => 'A file of yours is available again',
};

export const NOTIFICATION_TYPES: Record<NotificationType, NotificationTypeDef> = {
  'access.request': {
    label: 'Access requests',
    description: 'Someone asks for access to a board you own or administer.',
    title: (actor, d) => `${actor} asked to ${d.role && ASK_PHRASE[d.role] ? ASK_PHRASE[d.role] : 'open'} ${board(d)}`,
    link: (id) => `${boardPath(id)}?share=requests`,
    linkLabel: 'Review the request',
  },
  'access.response': {
    label: 'Answers to your access requests',
    description: 'Someone approves or declines your request to open a board.',
    title: (actor, d) =>
      d.approved
        ? `${actor} gave you access to ${d.role && ROLE_PHRASE[d.role] ? `${ROLE_PHRASE[d.role]} ` : ''}${board(d)}`
        : `${actor} declined your request to open a board`,
    link: (id, d) => boardPath(id ?? d.requestedBoardId ?? null),
    linkLabel: 'Open the board',
  },
  'comment.mention': {
    label: 'Mentions',
    description: 'Someone @mentions you in a comment.',
    title: (actor, d) => `${actor} mentioned you in ${board(d)}`,
    link: threadPath,
    linkLabel: 'Open the comment',
  },
  'comment.reply': {
    label: 'Replies',
    description: 'Someone replies in a comment thread you started or wrote in.',
    title: (actor, d) => `${actor} replied in ${board(d)}`,
    link: threadPath,
    linkLabel: 'Open the thread',
  },
  'board.invite': {
    label: 'Boards shared with you',
    description: 'Someone invites you to a board.',
    title: (actor, d) => `${actor} invited you to ${d.role && ROLE_PHRASE[d.role] ? `${ROLE_PHRASE[d.role]} ` : ''}${board(d)}`,
    link: (id) => boardPath(id),
    linkLabel: 'Open the board',
  },
  'workspace.invite': {
    label: 'Workspaces you are added to',
    description: 'Someone adds you to a team workspace.',
    title: (actor, d) =>
      `${actor} added you to the “${d.workspaceName || 'team'}” workspace${d.role && d.role !== 'member' ? ` as ${d.role === 'admin' ? 'an admin' : 'a guest'}` : ''}`,
    link: (_id, d) => (d.workspaceId ? `/app?ws=${encodeURIComponent(d.workspaceId)}` : '/app'),
    linkLabel: 'Open the workspace',
  },
  'moderation.action': {
    label: 'Moderation notices',
    description: 'Freero’s moderators acted on something of yours.',
    title: (_actor, d) => MODERATION_TITLE[d.moderationAction ?? '']?.(d) ?? 'A notice from Freero’s moderators',
    link: (id, d) => d.appealPath ?? boardPath(id),
    linkLabel: 'Details and appeal',
    direct: true,
  },
};

export const isNotificationType = (t: unknown): t is NotificationType =>
  typeof t === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, t);
