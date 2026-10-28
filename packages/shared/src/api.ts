// REST + WebSocket contract between apps/web and apps/server.
// All REST endpoints live under /api, send/receive JSON, and authenticate via
// an HttpOnly cookie named `freero_session`. Errors: { error: string } with a
// 4xx/5xx status. 401 = not logged in, 403 = no access, 404 = not found.
import type { BoardElement } from './elements';

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export type LinkAccess = 'none' | 'viewer' | 'commenter' | 'editor';

export interface User {
  id: string;
  name: string;
  email: string;
  /** Hex color used for cursor/avatar. */
  color: string;
  avatarUrl: string | null;
  createdAt: number;
}

export interface BoardSummary {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  ownerName: string;
  role: Role;
  starred: boolean;
  /** Data URL or /uploads URL of the last saved thumbnail, or null. */
  thumbnail: string | null;
  linkAccess: LinkAccess;
  createdAt: number;
  updatedAt: number;
  /** When the current user last opened it. */
  lastOpenedAt: number | null;
  /** Trash only (filter=trash): when it was deleted, and when it will be deleted for good. */
  deletedAt?: number;
  purgeAt?: number;
  /** The workspace the board belongs to, and its project (folder) there, if any. */
  workspaceId: string;
  projectId: string | null;
  /**
   * Team access, when the board is in a team workspace: everyone in it (`private`: only the
   * members of its private project, plus the workspace's owners/admins) can edit it.
   */
  team: { name: string; private: boolean } | null;
  /**
   * You were invited to this board itself (a board membership you can leave). False when your
   * access comes only from ownership, your team or the link.
   */
  member: boolean;
  /** What the current user may do beyond their role, under the workspace's sharing policies. */
  permissions: BoardPermissions;
}

/**
 * Computed by the server for the current user (role + workspace policies); the UI only reflects
 * it — every one of these is checked again by the endpoint that does the work.
 */
export interface BoardPermissions {
  /** Export / download / duplicate the board (workspace "downloads" policy). */
  canExport: boolean;
  /** Invite people who are not in the board's workspace (workspace "external sharing" policy). */
  canShareExternally: boolean;
  /** Highest link access the workspace allows ('none': links are off). */
  maxLinkAccess: LinkAccess;
  /** Move the board between projects (its owner, or the workspace's owners/admins). */
  canMove: boolean;
  /** Hand the board to someone else (its owner, or the workspace's owners/admins). */
  canTransfer: boolean;
}

// ---- Workspaces ----
// Every board belongs to a workspace. Each user has a personal workspace (created on first use;
// only they are in it); team workspaces have members with workspace roles:
//   owner   everything, incl. policies, transfer and deletion; a workspace always keeps ≥ 1 owner
//   admin   manages members (not owners/admins), projects and policies; edits every board
//   member  creates boards; edits every board not in a private project they're not part of
//   guest   only boards (or private projects) they were invited to
// Board access = board owner > max(direct board membership, team access, link access), with link
// access capped by the workspace's `linkSharing` and outside access cut by `externalSharing`.
//
// GET    /api/workspaces                         -> { workspaces: WorkspaceSummary[] } (personal first)
// POST   /api/workspaces          body { name }  -> { workspace: WorkspaceSummary }    (a team; you own it)
// PATCH  /api/workspaces/:id      body { name?, policies?: Partial<WorkspacePolicies> } -> { workspace }  (owner/admin; team only)
// DELETE /api/workspaces/:id      body { confirm: <name> } -> { ok: true }  (owner; team only; deletes its boards)
// POST   /api/workspaces/:id/transfer body { userId } -> { workspace }  (owner; target becomes owner, you admin)
// GET    /api/workspaces/:id/members                -> { members: WorkspaceMember[], invites: WorkspaceInvite[] } (not guests)
// POST   /api/workspaces/:id/members  body { email, role } -> { member } | { invite }  (verified email;
//        owner/admin any non-owner role; members only guests, and only if guestInvites = 'members')
// PATCH  /api/workspaces/:id/members/:userId body { role } -> { member }  (owner: any; admin: member/guest)
// DELETE /api/workspaces/:id/members/:userId -> { ok: true }  (owner/admin, or yourself to leave). Cuts
//        live access at once; boards they owned there pass to whoever removed them.
// POST   /api/workspaces/:id/invites/:inviteId/resend -> { invite }   DELETE … -> { ok: true }
// GET    /api/workspace-invites/:token         -> { invite: WorkspaceInvitePreview } | 404
// POST   /api/workspace-invites/:token/accept  -> { workspaceId }
//
// Projects (folders):
// GET    /api/workspaces/:id/projects          -> { projects: ProjectSummary[] }  (the ones you can see)
// POST   /api/workspaces/:id/projects  body { name, access? } -> { project }   (members, not guests)
// PATCH  /api/projects/:id   body { name?, access? } -> { project }   (its creator or workspace owner/admin)
// DELETE /api/projects/:id   -> { ok: true }   (same; 409 while it still holds boards)
// GET    /api/projects/:id/members -> { members: { userId, name, color, avatarUrl }[] }
// PUT    /api/projects/:id/members/:userId -> { ok: true }   DELETE … -> { ok: true }  (manage: as PATCH)
export type WorkspaceKind = 'personal' | 'team';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';
export type ProjectAccess = 'workspace' | 'private';
export interface WorkspacePolicies {
  /** Who may give people outside the workspace access to its boards ('none': nobody, and such access stops working). */
  externalSharing: 'anyone' | 'admins' | 'none';
  /** Highest role "anyone with the link" may get on its boards; 'none' turns links off. */
  linkSharing: LinkAccess;
  /** Who may invite guests into the workspace (owners/admins always may). */
  guestInvites: 'admins' | 'members';
  /** Who may export, download or duplicate its boards: anyone with access, workspace members (not guests), or owners/admins. */
  downloads: 'anyone' | 'members' | 'admins';
}
export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /** Your role in it. */
  role: WorkspaceRole;
  memberCount: number;
  policies: WorkspacePolicies;
  createdAt: number;
}
export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  color: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  joinedAt: number;
}
export interface WorkspaceInvite {
  id: string;
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  invitedById: string;
  invitedByName: string;
  createdAt: number;
  expiresAt: number;
}
export interface WorkspaceInvitePreview {
  workspaceName: string;
  inviterName: string;
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  expiresAt: number;
}
export interface ProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  access: ProjectAccess;
  createdBy: string | null;
  /** You may rename it, change its access, manage its members and delete it. */
  canManage: boolean;
  createdAt: number;
}

/** Days a deleted board stays in its owner's trash (restorable) before it is deleted for good. */
export const TRASH_RETENTION_DAYS = 30;

export interface BoardMember {
  userId: string;
  name: string;
  /** Only sent to people who can manage sharing (owner, editors) and for your own row. */
  email?: string;
  color: string;
  avatarUrl: string | null;
  role: Role;
  /**
   * Has access through the board's team workspace, not a board invite (role: what the team grants).
   * The share dialog shows these as one "Everyone in <team>" row; pickers (mentions, assignees)
   * list them like anyone else.
   */
  team?: boolean;
}

// ---- Auth ----
// POST /api/auth/signup   body SignupRequest -> AuthResponse  (sets cookie; emails a verification link)
// POST /api/auth/login    body LoginRequest  -> AuthResponse  (sets cookie)
// POST /api/auth/logout   -> { ok: true }                     (clears cookie)
// GET  /api/auth/session  -> SessionResponse (always 200; user null when signed out)
// GET  /api/auth/me       -> AuthResponse | 401
// PATCH /api/auth/me      body { name?, color?, avatarUrl? } -> AuthResponse
// PUT  /api/auth/me/avatar raw image body (PNG/JPEG/GIF/WebP) -> AuthResponse (resized server-side)
// DELETE /api/auth/me/avatar -> AuthResponse
//
// Email + password (single-use emailed tokens; answers never reveal whether an email has an account):
// POST /api/auth/verify-email/send  -> { ok: true }   (signed in; re-sends the verification link)
// POST /api/auth/verify-email       body { token } -> { ok: true } | 400 (invalid / used / expired)
// POST /api/auth/password/forgot    body { email } -> { ok: true }   (always, account or not)
// POST /api/auth/password/reset     body { token, password } -> AuthResponse (signs in; ends every other session)
// POST /api/auth/password           body { currentPassword, newPassword } -> { ok: true } (ends other sessions)
// POST /api/auth/email              body { email, password } -> { ok: true } (sends a link to the NEW address)
// POST /api/auth/email/confirm      body { token } -> { ok: true } (the new address becomes the account's;
//                                   a verified previous address gets a "this wasn't me" link, 7 days)
// POST /api/auth/email/revert       body { token, password } -> LoginResponse ("this wasn't me": back to the
//                                   previous address, new password, two-step/providers added since removed,
//                                   every session ended; then signs in like a reset link)
// Security notices (no opt-out) are mailed for password/email/two-step/recovery-code/provider changes,
// deletion, and a sign-in from a browser that has not signed in to the account before.
//
// Sessions (signed-in devices):
// GET    /api/auth/sessions         -> { sessions: SessionInfo[] }
// DELETE /api/auth/sessions/:id     -> { ok: true }  (closes that session's board sockets too)
// POST   /api/auth/sessions/revoke-others -> { revoked: number }
//
// Account deletion (grace period, then purged; boards you own are deleted with it):
// POST /api/auth/account/delete     body { password } -> { deletionScheduledFor } (signs out everywhere)
// POST /api/auth/account/restore    -> AuthResponse  (signed in with a session made during the grace period)
// While deletion is scheduled, every other signed-in endpoint answers 403 { code: 'account_pending_deletion' }.
//
// Sign in with a provider (OpenID Connect, authorization code + PKCE). Browser navigations, not fetches:
// GET /api/auth/providers                         -> { providers: SignInProvider[] } (only configured ones)
// GET /api/auth/oidc/:provider/start?intent=login|link|reauth&next=/path -> 302 to the provider
// GET /api/auth/oidc/:provider/callback           -> 302 to `next`, to /login/two-factor?next=…, or to
//                                                    /login?error=<OidcErrorCode> (/settings?error=… for link/reauth)
// A provider account signs in to the Freero account it is connected to. It is connected
// automatically only to the account whose address the provider asserts as verified — after that
// account's second step when it has two-factor on. An account with no password always keeps at
// least one connected provider.
//
// Two-factor (authenticator app, TOTP):
// POST /api/auth/login, /api/auth/password/reset, /api/auth/email/revert -> LoginResponse: { twoFactorRequired: true } instead of
//      a session when the account has two-factor on (an HttpOnly cookie carries the pending sign-in)
// POST /api/auth/login/two-factor   body { code } (6 digits, or a recovery code) -> AuthResponse
// GET  /api/auth/security           -> SecurityInfo
// DELETE /api/auth/identities/:id   -> SecurityInfo  (409 when it is the last way to sign in)
// POST /api/auth/two-factor/setup   body { password? } -> TwoFactorSetup (enable it with a code from the app)
// POST /api/auth/two-factor/enable  body { code } -> { recoveryCodes: string[] } (signs out other sessions)
// POST /api/auth/two-factor/disable body { password?, code } -> { ok: true }
// POST /api/auth/two-factor/recovery-codes body { password?, code } -> { recoveryCodes: string[] }
// `password` is required when the account has one; passwordless accounts instead need a session that
// signed in (or re-confirmed with its provider: intent=reauth) within the last few minutes — otherwise
// 403 { code: 'reauth_required' }. The same applies to email change and account deletion.
//
// Two-step recovery (KAI-99; the threat model is in ARCHITECTURE.md):
// POST /api/auth/two-factor/undo    body { token, password } -> LoginResponse ("this wasn't me" from the
//                                   two-step-on notice: authenticator + providers removed, new password,
//                                   every session ended; 409 while the address differs from where it went)
// POST /api/auth/login/two-factor/recovery -> TwoFactorRecoveryStarted (from the pending sign-in; 403
//                                   { code: 'recovery_needs_password' } after a reset link or a provider not
//                                   connected yet; the same one again while it runs)
// POST /api/auth/two-factor/recovery/finish body { token, password } -> LoginResponse (the link mailed when ready)
// POST /api/auth/two-factor/recovery/cancel-link body { token } -> { ok: true } (the link in the recovery mails)
// POST /api/auth/two-factor/recovery/cancel -> SecurityInfo (signed in)
// Any accepted second-factor code also cancels a recovery in progress.
export interface SignupRequest { name: string; email: string; password: string }
export interface LoginRequest { email: string; password: string }
export type LoginResponse = AuthResponse | { twoFactorRequired: true };

export const REAUTH_REQUIRED = 'reauth_required';

export interface SignInProvider {
  id: string;
  /** "Google", "Microsoft". */
  label: string;
}

export interface LinkedIdentity {
  id: string;
  provider: string;
  providerLabel: string;
  /** The address the provider last asserted (may differ from the account's). */
  email: string | null;
  createdAt: number;
  lastUsedAt: number;
}

export interface SecurityInfo {
  hasPassword: boolean;
  identities: LinkedIdentity[];
  /** Configured providers (connect buttons). */
  providers: SignInProvider[];
  twoFactor: {
    enabled: boolean;
    recoveryCodesLeft: number;
    /** Set when something (a workspace policy) requires two-factor: it can't be turned off. */
    requiredBy: string | null;
    /** A "lost my authenticator" recovery in progress (epoch ms): it removes two-step verification from `readyAt` on. */
    recovery: { startedAt: number; readyAt: number } | null;
  };
  /** Until when this session counts as recently signed in (passwordless confirmations), epoch ms. */
  recentAuthUntil: number;
}

export interface TwoFactorRecoveryStarted {
  /** When the link that finishes it will be mailed (epoch ms). */
  readyAt: number;
}

export const RECOVERY_NEEDS_PASSWORD = 'recovery_needs_password';

export interface TwoFactorSetup {
  /** Base32 secret, for typing it into an app by hand. */
  secret: string;
  /** otpauth:// URI (what the QR code encodes). */
  uri: string;
  /** The QR code as a data: URL (PNG). */
  qr: string;
}

/** `?error=` codes the OIDC callback redirects with. */
export type OidcErrorCode =
  | 'cancelled' // the user declined at the provider
  | 'failed' // the provider's answer could not be verified, or the request expired
  | 'unavailable' // unknown / unconfigured provider, or it could not be reached
  | 'email_in_use' // an account uses that address, but the provider doesn't vouch for it
  | 'no_email' // the provider shared no address
  | 'identity_in_use' // link: that provider account is connected to another Freero account
  | 'provider_linked' // link: this account already has an identity of that provider
  | 'wrong_account'; // reauth: a different provider account than the one connected

/** The signed-in user's own account (other people only ever see `User`). */
export interface Account extends User {
  emailVerified: boolean;
  /** Set while the account is scheduled for deletion: it is purged at this instant unless restored. */
  deletionScheduledFor: number | null;
}
export interface AuthResponse { user: Account }
export interface SessionResponse { user: Account | null }

export interface SessionInfo {
  id: string;
  /** The session this request was made with. */
  current: boolean;
  createdAt: number;
  lastSeenAt: number;
  /** Raw User-Agent of the device that signed in (may be empty). */
  userAgent: string;
  /** Approximate network: the client address with its host part masked (e.g. "203.0.113.x"). */
  network: string;
  /** "City, Country" (or the country) when the server has a GeoIP database and knows the address. */
  location: string | null;
  /** How it signed in: 'password', 'email_link' (a password reset link) or a provider id. */
  method: string;
  /** The provider's label when `method` is a provider ("Google"). */
  methodLabel: string | null;
  /** It passed the two-factor step. */
  twoFactor: boolean;
}

export const ACCOUNT_PENDING_DELETION = 'account_pending_deletion';

// ---- Boards ----
// GET    /api/boards?workspace=<id>&project=<id>&filter=all|mine|shared|starred|recent|trash&q=text
//                                 -> { boards: BoardSummary[] }
//        `workspace` = the current workspace (default: your personal one; 404 unless you're in it).
//        all/mine/trash: boards of that workspace you can open (trash: your own deleted ones);
//                        `all` in your PERSONAL workspace also lists boards shared from outside.
//        shared: boards shared with you directly from workspaces you are NOT in (any workspace).
//        starred/recent: that workspace's boards plus those shared from outside.
//        `project`: only that project's boards.
// POST   /api/boards               body CreateBoardRequest -> { board: BoardSummary }
//                                 (in `workspaceId`, default personal; not as a guest)
// POST   /api/boards/:id/transfer  body { userId } -> { board }  (board owner or workspace owner/admin;
//                                 team workspace: to a non-guest member; personal: to a board member,
//                                 and the board moves to their personal workspace. The previous
//                                 owner keeps editor access. 403 over the new owner's board quota)
// GET    /api/boards/:id           -> { board: BoardSummary }   (also records lastOpenedAt;
//                                     if the user has no membership but linkAccess != 'none',
//                                     returns the board with role = linkAccess)
// PATCH  /api/boards/:id           body UpdateBoardRequest -> { board: BoardSummary }  (owner/editor; linkAccess owner only)
// DELETE /api/boards/:id           -> { ok: true }  (owner only) moves it to the trash: gone from every
//                                    list and for every member (404, sockets closed 4403) until restored;
//                                    deleted for good TRASH_RETENTION_DAYS later
// POST   /api/boards/:id/restore   -> { board: BoardSummary }  (owner only; 404 unless in your trash;
//                                    403 over the board quota)
// DELETE /api/boards/:id/permanent -> { ok: true }  (owner only; only boards in the trash)
// POST   /api/boards/:id/duplicate -> { board: BoardSummary }  (copies the Yjs state)
// PUT    /api/boards/:id/star      -> { ok: true }
// DELETE /api/boards/:id/star      -> { ok: true }
// PUT    /api/boards/:id/thumbnail body { dataUrl: string } -> { ok: true } (editor+)
export interface CreateBoardRequest { title?: string; description?: string; workspaceId?: string; projectId?: string | null }
/** `projectId`: move it into that project of its workspace (null: the workspace root); `permissions.canMove`. */
export interface UpdateBoardRequest { title?: string; description?: string; linkAccess?: LinkAccess; projectId?: string | null }

// ---- Version history ----
// Editors and owners only: an older version can hold content someone removed before sharing the
// board more widely (e.g. with a view link), so viewers and commenters never see history.
// GET   /api/boards/:id/versions              -> { versions: BoardVersion[] }  (newest first)
// GET   /api/boards/:id/versions/:vid/state   -> application/octet-stream: the version's Yjs state
// POST  /api/boards/:id/versions              body { name } -> { version: BoardVersion }
//       Names the board as it is right now (including edits not saved yet, on any instance).
// PATCH /api/boards/:id/versions/:vid         body { name } -> { version: BoardVersion }
//       Names or renames a version; named versions are never pruned.
// POST  /api/boards/:id/versions/:vid/restore -> { before: BoardVersion }
//       Applies the version to the live board as a NEW change, so everyone connected (on every
//       instance) converges on it. The board as it was just before is kept as a 'before-restore'
//       version (`before`): restoring that one undoes the restore. Comments, votes and the timer
//       are not rolled back (Y_KEPT_ON_RESTORE).
export type BoardVersionKind = 'auto' | 'named' | 'before-restore';
export interface BoardVersion {
  id: number;
  kind: BoardVersionKind;
  /** Set for named versions. */
  name: string | null;
  createdAt: number;
  /** Who named it / who restored (null for automatic versions, or an account deleted since). */
  createdBy: { id: string; name: string } | null;
}
export const MAX_VERSION_NAME = 80;

// ---- Saved templates (a board or a selection saved for reuse) ----
// You see your own templates plus those shared with a team workspace you are a member (not a
// guest) of.
// GET    /api/templates      -> { templates: SavedTemplateSummary[] }  (visible to you, newest first)
// GET    /api/templates/:id  -> { template: SavedTemplate }           (404 unless visible to you)
// POST   /api/templates      body SaveTemplateRequest -> { template: SavedTemplateSummary }
//                            (400 invalid / too large, 403 over MAX_TEMPLATES_PER_USER, or when
//                            `boardId`'s workspace doesn't let you download its content)
// PATCH  /api/templates/:id  body { workspaceId: string | null } -> { template }  (its owner; share
//                            with a team workspace you're a member of, or make it personal again)
// DELETE /api/templates/:id  -> { ok: true }  (its owner only)
export interface SavedTemplateSummary {
  id: string;
  name: string;
  description: string;
  /** /uploads URL of the preview image, or null. */
  thumbnail: string | null;
  ownerId: string;
  /** The team workspace it is shared with, or null (personal). */
  workspaceId: string | null;
  elementCount: number;
  createdAt: number;
  updatedAt: number;
}
/**
 * Board content as the web engine exports it (elements with their ids as on the source board,
 * plus per-element content kept outside the elements map). Opaque to the server; inserting it
 * gives every element a fresh id (the copy/paste path).
 */
export interface TemplateContent {
  elements: BoardElement[];
  content?: Record<string, unknown>;
}
export interface SavedTemplate extends SavedTemplateSummary {
  content: TemplateContent;
}
export interface SaveTemplateRequest {
  name: string;
  description?: string;
  /** PNG/JPEG/WebP data URL (max 512KB), or omitted. */
  thumbnail?: string;
  content: TemplateContent;
  /** The board the content comes from: its workspace's "downloads" policy applies. */
  boardId?: string;
  /** Share it with this team workspace right away (you must be a member). */
  workspaceId?: string | null;
}

// ---- Members / sharing ----
// GET    /api/boards/:id/members              -> { members: BoardMember[] }
// POST   /api/boards/:id/members  body InviteRequest -> InviteResponse
//        (owner/editor with a verified email, else 403). An existing account becomes a member
//        ({ member }); any other address gets a pending invite emailed to it ({ invite }). An editor
//        re-inviting with a different role gets 409: only the owner changes roles.
// PATCH  /api/boards/:id/members/:userId body { role } -> { member }   (owner only)
// DELETE /api/boards/:id/members/:userId -> { ok: true } (owner, or self to leave)
export interface InviteRequest { email: string; role: Exclude<Role, 'owner'> }
export type InviteResponse = { member: BoardMember; invite?: never } | { invite: PendingInvite; member?: never };

// Pending invites (people without an account yet). The emailed link is /invite/<token>.
// GET    /api/boards/:id/invites                    -> { invites: PendingInvite[] }  (owner/editor)
// POST   /api/boards/:id/invites/:inviteId/resend   -> { invite: PendingInvite }     (new link + expiry; old link dies)
// DELETE /api/boards/:id/invites/:inviteId          -> { ok: true }  (owner, or the editor who sent it)
// GET    /api/invites/:token          -> { invite: InvitePreview } | 404 (unknown, used, revoked or expired)
// POST   /api/invites/:token/accept   -> { boardId, role }  (signed in; single-use)
export interface PendingInvite {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  invitedById: string;
  invitedByName: string;
  createdAt: number;
  expiresAt: number;
}
export interface InvitePreview {
  boardTitle: string;
  inviterName: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  expiresAt: number;
}
export interface AcceptInviteResponse { boardId: string; role: Role }

// ---- Board people ----
// GET /api/boards/:id/people?ids=a,b,c -> { people: BoardPerson[] }  (any role on the board)
//     Profiles (name, color, photo) of the listed users who have access to the board or appear in
//     its comments (authors and @mentions), so a comment keeps its author's photo and a mention
//     its name after they leave. Other ids are left out. At most 100 ids.
export interface BoardPerson { id: string; name: string; color: string; avatarUrl: string | null }

// ---- Notifications ----
// GET  /api/notifications?before=<ms>&limit=<n> -> NotificationsResponse  (newest first; 30 by default)
// POST /api/notifications/read   body { ids?: string[] } -> { unread }  (no ids: mark all read)
// GET  /api/notifications/prefs  -> NotificationPrefs
// PUT  /api/notifications/prefs  body { email?: { [type]: boolean }, emailAll?: boolean } -> NotificationPrefs
// POST /api/notifications/unsubscribe?token=<t>  (no session needed: the signed link from a digest
//      email, also its RFC 8058 one-click target) -> { ok: true, email } | 400
// WebSocket /ws/notifications (session cookie): the server sends a JSON NotificationsLiveMessage
//      whenever the user's notifications change, whichever instance created them.
//
// Types are open-ended: a new source (e.g. workspace invites) adds its type here and its entry in
// the server's modules/notifications/types.ts; the inbox shows `title` / `body` as sent.
export type NotificationType = 'board.invite' | 'comment.mention' | 'comment.reply' | 'workspace.invite';

export interface AppNotification {
  id: string;
  type: NotificationType;
  createdAt: number;
  readAt: number | null;
  /** Who caused it (null once their account is gone). */
  actor: BoardPerson | null;
  /** Plain text, already worded ("Ann mentioned you in “Roadmap”"). */
  title: string;
  /** Plain-text excerpt (a comment, mentions shown as names), or ''. */
  body: string;
  /** App path to open: the board, or the board with ?thread=<id>. */
  link: string;
  boardId: string | null;
}
export interface NotificationsResponse { notifications: AppNotification[]; unread: number; hasMore: boolean }
export interface NotificationTypePref { type: NotificationType; label: string; description: string; email: boolean }
export interface NotificationPrefs {
  /** Master switch for notification emails (the one-click unsubscribe turns it off). */
  emailAll: boolean;
  types: NotificationTypePref[];
}
export type NotificationsLiveMessage = { type: 'changed'; unread: number };

// ---- Uploads ----
// POST /api/uploads  raw body (image/png|jpeg|gif|webp|svg+xml), header Content-Type,
//                    max 15MB -> { url: string }  e.g. "/uploads/ab12cd.png"
// GET  /uploads/:file  static file

// ---- Link previews ----
// GET /api/unfurl?url=<http(s) URL> -> UnfurlResponse   (signed-in users; rate limited)
//     The server fetches the page itself (http/https only, default ports, no private/loopback/
//     link-local addresses — checked again for every redirect and at connect time — with
//     timeouts and size caps) and reads its title / description / preview image.
//     400 bad URL, 422 not previewable (blocked address, not HTML, too large, timeout).
//
// POST /api/unfurl/image  { url } -> 201 { url: "/uploads/<key>" }   (signed-in; rate limited)
//     Copies an image placed on a board by URL into the user's uploads (same fetch protections;
//     the bytes must really be PNG / JPEG / GIF / WebP / SVG). 413 over the upload quota.
// GET  /api/unfurl/image?url=<http(s) URL> -> the image bytes (nothing stored), for exports of
//     boards that still link images from hosts without CORS.
//     Both: 400 bad URL, 422 not reachable / not an image / too large / timeout.
export interface ImportImageRequest { url: string }
export interface UnfurlResponse {
  /** Final URL after redirects. */
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** Preview image as a data: URL (fetched by the server, size-capped), or null. */
  image: string | null;
}

/**
 * Origins whose players a link card may frame (after a click). The web app builds iframe srcs
 * only on these, and the server's Content-Security-Policy `frame-src` allows exactly these.
 */
export const EMBED_FRAME_ORIGINS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.loom.com'] as const;

// ---- Realtime ----
// WebSocket: /ws/boards/:id  — standard y-websocket protocol (sync + awareness),
// i.e. the client uses `new WebsocketProvider(wsBase + '/ws/boards', boardId, doc)`.
// Auth via the same cookie on the upgrade request. The server closes with
// code 4401 (unauthenticated) or 4403 (no access). Viewers receive updates but
// their document updates are dropped; commenters may only modify 'comments', and there only
// the records they own (server/realtime/commentRules.ts: their messages and reactions, threads
// they started; anyone may resolve/reopen and detach).
// Custom message (server -> client) sent right after connect so the client knows
// its effective role. Encoding (lib0): writeVarUint(WS_MESSAGE_ROLE) then
// writeVarString(JSON.stringify({ type: 'role', role })). Clients register it via
// y-websocket's `provider.messageHandlers[WS_MESSAGE_ROLE]`.
export const WS_MESSAGE_ROLE = 100;

// ---- Board layers (content the server withholds) ----
// Besides the shared doc, a board has server-held LAYER docs that only some connections may
// sync (see "Board layers" in ARCHITECTURE.md):
//   'private'  one per user: only that user's sockets read it, and only while they may edit.
//              Private-mode drafts and ballots of hidden votes live here until revealed.
//   'editors'  owners/editors only: contents of hidden frames.
// They travel over the board's socket (relayed between instances by the server), in an envelope:
//   writeVarUint(WS_MESSAGE_LAYER), writeVarString(layer), then a y-protocols sync message
//   (step 1 / step 2 / update) for that layer's doc, in both directions. The server ignores
//   envelopes for layers the socket may not read and drops writes from sockets that may not
//   edit.
export const WS_MESSAGE_LAYER = 101;
export type BoardLayer = 'private' | 'editors';
export const BOARD_LAYERS: readonly BoardLayer[] = ['private', 'editors'];

// Client -> server: writeVarUint(WS_MESSAGE_LAYER_OP), writeVarString(JSON.stringify(op)).
// Owners/editors only. The server applies it in order with the socket's doc updates.
//   reveal:  moves the entries of `collection` (keys starting with `prefix`) out of EVERY user's
//            private layer into the shared doc (one transaction), e.g. revealing private-mode
//            drafts ('elements') or the ballots of a hidden vote ('voting', `${sessionId}:`).
//   discard: deletes those entries from every user's private layer without revealing them.
//   `mine: true` limits either to the sender's own private layer (sharing one's leftovers).
// Only the private layers of people who may still edit the board are revealed; the server holds
// the sender's later messages until the op is applied, so it stays in order with them.
export const WS_MESSAGE_LAYER_OP = 102;
export interface LayerOp {
  type: 'reveal' | 'discard';
  collection: string;
  prefix?: string;
  mine?: boolean;
}

export const SESSION_COOKIE = 'freero_session';
export const SERVER_PORT = 4000;
