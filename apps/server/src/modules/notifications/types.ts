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
}

const board = (d: NotificationData) => `“${d.boardTitle || 'Untitled board'}”`;
const boardPath = (id: string | null) => (id ? `/board/${encodeURIComponent(id)}` : '/app');
const threadPath = (id: string | null, d: NotificationData) =>
  d.threadId ? `${boardPath(id)}?thread=${encodeURIComponent(d.threadId)}` : boardPath(id);

const ROLE_PHRASE: Record<string, string> = { editor: 'edit', commenter: 'comment on', viewer: 'view' };

export const NOTIFICATION_TYPES: Record<NotificationType, NotificationTypeDef> = {
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
};

export const isNotificationType = (t: unknown): t is NotificationType =>
  typeof t === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, t);
