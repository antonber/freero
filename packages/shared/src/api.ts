// REST + WebSocket contract between apps/web and apps/server.
// All REST endpoints live under /api, send/receive JSON, and authenticate via
// an HttpOnly cookie named `freero_session`. Errors: { error: string } with a
// 4xx/5xx status. 401 = not logged in, 403 = no access, 404 = not found.
import type { BoardLabelSummary } from './compliance';
import type { ActivityElement, BoardElement, TableCopyContent } from './elements';
import type { ChartCopyContent } from './charts';
import type { Rect } from './geometry';
import type { StructureInput } from './layout/types';
import type { BoardOutline } from './outline/types';
import type { ActivityResults } from './ydoc';

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
/**
 * [additive, #122] A role a board member may be given (PATCH /boards/:id/members/:userId): the
 * invitable roles plus 'coowner', an editor who also manages the board's sharing. A co-owner's
 * `role` reads 'editor' everywhere (`BoardSummary`, `BoardMember`, the socket's role message) with
 * `coOwner: true` beside it, so a client that doesn't know co-owners treats them as editors, never
 * as owners.
 */
export type BoardMemberRole = Exclude<Role, 'owner'> | 'coowner';
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

/**
 * What a container is (KAI-162): a board (the canvas) or a doc (a collaborative document). Both
 * are rows of the same table with the same sharing, membership, link, trash and workspace rules;
 * only their content differs (`/board/<id>` vs `/doc/<id>`, `/ws/boards` vs `/ws/docs`).
 */
export type ObjectKind = 'board' | 'doc';
export const OBJECT_KINDS: readonly ObjectKind[] = ['board', 'doc'];

/** The title of a board nobody has named yet (new boards; a cleared title). */
export const DEFAULT_BOARD_TITLE = 'Untitled board';

export interface BoardSummary {
  id: string;
  /** [additive] 'doc' for a doc (KAI-162); boards say 'board'. */
  kind: ObjectKind;
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
  /**
   * [additive, #153] When it was archived: kept, read-only for everyone (its owner included: `role`
   * reads at most 'viewer') and out of the default lists until someone unarchives it. Absent: live.
   */
  archivedAt?: number;
  /** [additive, #158] Its classification label: its caps are already in `permissions` (the server enforces them). */
  label?: BoardLabelSummary;
  /** The workspace the board belongs to, and its project (folder) there, if any. */
  workspaceId: string;
  projectId: string | null;
  /**
   * Team access, when the board is in a team workspace: everyone in it (`private`: only the
   * members of its private project) gets `access` on it — the project's team access level, else
   * the workspace's. The workspace's owners/admins always edit.
   */
  team: { name: string; private: boolean; access: TeamAccess } | null;
  /**
   * You were invited to this board itself (a board membership you can leave). False when your
   * access comes only from ownership, your team or the link.
   */
  member: boolean;
  /** What the current user may do beyond their role, under the workspace's sharing policies. */
  permissions: BoardPermissions;
  /**
   * Freero's moderators turned link sharing off for this board (KAI-142): `linkAccess` reads
   * 'none' and the owner can't turn it back on until they restore it.
   */
  linkBlocked?: boolean;
  /**
   * [additive] Share-link protection (KAI-145), sent to the board's owner only: a password the
   * link asks for, and when it stops working. `linkAccess` already reads 'none' once it expired;
   * `storedAccess` is the role the link gives again when the expiry is moved or removed.
   */
  linkProtection?: { password: boolean; expiresAt: number | null; expired: boolean; storedAccess: LinkAccess };
  /** [additive] The board's call (KAI-134): a meeting link its editors set, or a Jitsi room. */
  call?: BoardCall | null;
  /**
   * [additive] Its owner lets other sites embed it live (#2, `/embed/b/:id`): what the embed shows
   * still follows the board's sharing exactly. Absent: off.
   */
  embeddable?: boolean;
  /**
   * [additive, #122] You co-own it: your `role` reads 'editor' (what clients that don't know
   * co-owners understand) and you also manage its sharing — members' roles (not the owner's),
   * invites, the link with its password and expiry, embedding and the sharing settings. Never its
   * deletion, its transfer or the owner's own access.
   */
  coOwner?: boolean;
  /**
   * [additive, #123] The board's own sharing settings (its owner and co-owners change them), always
   * within its workspace's policies: a board can be stricter than its workspace, never looser.
   * Absent: both on.
   */
  sharing?: BoardSharingSettings;
}

/** [additive, #123] A board's own sharing settings (`BoardSummary.sharing`, PATCH /boards/:id `sharing`). */
export interface BoardSharingSettings {
  /** Editors may invite people (owners and co-owners always may). Off: an editor's invite is 403 `board_sharing_restricted`. */
  editorsCanShare: boolean;
  /**
   * Viewers and commenters (guests too) may copy, duplicate, export, back up and download files
   * from it. Off: those routes answer them 403 `downloads_restricted`, and their clipboard copy is off.
   */
  viewersCanExport: boolean;
}
/** `code` of a 403: the board's "Editors can share" is off (#123). */
export const BOARD_SHARING_RESTRICTED = 'board_sharing_restricted';
/** `code` of a 403 (#39): the workspace requires a password and/or an expiry on board links. */
export const LINK_POLICY_REQUIRED = 'link_policy_required';

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
  /** [additive, #153] Archive or unarchive it: its owner, or the workspace's content admins. Absent: no. */
  canArchive?: boolean;
  /** [additive] The board's link also lets in visitors without an account, as guests (workspace policy `publicLinks`). */
  guestLinks?: boolean;
  /** [additive] This server offers boards a Jitsi room of their own (operator's JITSI_BASE_URL, KAI-134). */
  jitsiCalls?: boolean;
  /**
   * [additive] Live embeds (KAI-127) may be activated on this board: false when its workspace turned
   * them off (policy `liveEmbeds`); links then stay preview cards. Absent: on.
   */
  liveEmbeds?: boolean;
  /** [additive] Further https origins the server's operator allows to be framed (`EMBED_EXTRA_ORIGINS`). */
  embedOrigins?: string[];
  /**
   * [additive] Its workspace lets its boards be embedded on other sites (policy `boardEmbeds`, #2).
   * Absent: allowed.
   */
  boardEmbeds?: boolean;
  /**
   * [additive, #122] You manage the board's sharing: its owner or a co-owner (members' roles, the
   * link, its password and expiry, embedding, the sharing settings). Absent: `role === 'owner'`.
   */
  manageSharing?: boolean;
  /** [additive, #123] You may invite people: owners, co-owners, and editors while "Editors can share" is on. Absent: owners and editors. */
  invite?: boolean;
  /** [additive, #123] You may copy its content to the clipboard (off for viewers and commenters when the board says so). Absent: yes. */
  canCopy?: boolean;
  /**
   * [additive, #39] What the workspace requires of the board's link before it is turned on or
   * changed: a password, and/or an expiry at most `maxDays` days ahead. Absent: nothing.
   */
  linkPolicy?: { passwordRequired: boolean; maxDays: number | null };
}

// ---- Board call (KAI-134) ----
// No audio/video in Freero: a board has a call link people open in their meeting tool. Either a
// meeting URL its editors paste (https only), or a room on the operator's Jitsi whose name the
// server derives from the board id with its secret (nobody can guess another board's room).
// GET /api/boards/:id/call  -> BoardCallResponse   (anyone who can open the board, guests too)
// PUT /api/boards/:id/call  body SetBoardCallRequest -> BoardCallResponse   (owners and editors; audited)
export interface BoardCall {
  kind: 'link' | 'jitsi';
  /** https URL to open in a new tab. */
  url: string;
}
export interface BoardCallResponse { call: BoardCall | null; jitsiAvailable: boolean }
/** `url`: a meeting link; `jitsi: true`: the board's own Jitsi room; neither (or url null): no call. */
export interface SetBoardCallRequest { url?: string | null; jitsi?: boolean }
export const MAX_CALL_URL = 2000;

// ---- Live audience activities (KAI-132) ----
// Answers never enter the board: they go to the server, which validates them against the
// `activity` element (as the person sees the board), keeps one answer per person (a new one
// replaces it), and publishes only results into the board's ENGAGE_RESULTS_COLLECTION (@freero/shared
// ydoc.ts). Anyone who can open the board may answer — viewers too — and guests when the activity
// allows it. Rate limited (RATE_LIMIT_ENGAGE).
// GET    /api/boards/:id/activities/:aid                     -> ActivityState  (with `activity`: the
//        phone answer page /respond/:id/:aid (#40) needs nothing else — no board, no socket)
// PUT    /api/boards/:id/activities/:aid/answer   body { answer: ActivityAnswer } -> ActivityState
// DELETE /api/boards/:id/activities/:aid/answer   -> ActivityState   (take your answer back)
// POST   /api/boards/:id/activities/:aid/questions  body { text } -> ActivityState   (Q&A)
// PUT    /api/boards/:id/activities/:aid/questions/:qid/upvote  body { on: boolean } -> ActivityState
// PATCH  /api/boards/:id/activities/:aid/questions/:qid  body { answered?, hidden? } -> ActivityState  (editors)
// POST   /api/boards/:id/activities/:aid/reveal   body { revealed: boolean } -> ActivityState  (editors)
// DELETE /api/boards/:id/activities/:aid/answers  -> ActivityState   (editors: start over)
// PUT    /api/boards/:id/activities/:aid/key      body { key: Record<questionId, optionId[]> } -> ActivityState
//        (editors, #147: a quiz's right answers, kept on the server, never in the board)
// PUT    /api/boards/:id/activities/:aid/key/copy body { boardId, activityId } -> ActivityState
//        (editors: a copied quiz takes the key of the quiz it was copied from, when they may edit that board)
export interface ActivityAnswer {
  /** Poll: picked option ids (1..maxChoices). */
  choices?: string[];
  /** Word cloud: up to ENGAGE_MAX_WORDS words or short phrases. */
  words?: string[];
  /** Ranking: every option id, best first. */
  order?: string[];
  /** Rating: option id -> 1..scale (statements may be skipped). */
  ratings?: Record<string, number>;
  /** [#147] 2×2 matrix: item id -> where it was placed, 0..1 from the low to the high end of each axis. */
  positions?: Record<string, { x: number; y: number }>;
  /**
   * [#147] Quiz: question id -> the options picked. Send only the open question's; the server keeps
   * the earlier ones and stamps `ms` (time taken, server clock).
   */
  quiz?: Record<string, { choices: string[]; ms?: number }>;
}
export interface ActivityState {
  /** What everyone sees on the board right now (sealed until revealed). */
  results: ActivityResults | null;
  /** Your own answer (only ever sent to you). */
  mine: ActivityAnswer | null;
  /** Q&A: the questions you upvoted, and the ones you asked. */
  myUpvotes: string[];
  myQuestions: string[];
  /** Results are withheld from everyone until an editor reveals them. */
  revealed: boolean;
  /** You may answer now; else why not ("Answers are closed", "Sign in to answer"). */
  canAnswer: boolean;
  reason?: string;
  /**
   * [additive, #40] The activity as you see it on the board — its question as plain text — so a
   * page without the board (the phone answer page, /respond/<board>/<activity>) can show the form.
   */
  activity?: ActivityInfo;
  /** [additive, #40] You run activities on this board (owner / editor): moderation, reveal. */
  canRun?: boolean;
  /** [additive, #147] The server's clock when it answered (quiz countdowns). */
  now?: number;
  /** [additive, #147] Quiz: your score so far (only ever sent to you). */
  myScore?: number;
  /** [additive, #147] Quiz: the answer key — question id -> right option ids. Only for those who run it. */
  key?: Record<string, string[]>;
}

/** [#40] What answering an activity needs to know of it, without the board. */
export type ActivityInfo = Pick<
  ActivityElement,
  'id' | 'kind' | 'options' | 'maxChoices' | 'scale' | 'anonymous' | 'results' | 'guests' | 'closed' | 'color' | 'axes' | 'questions' | 'quiz'
> & {
  /** The question, plain text. */
  question: string;
};
export const ENGAGE_MAX_WORDS = 3;
export const ENGAGE_MAX_WORD_LENGTH = 40;
export const ENGAGE_MAX_CLOUD_WORDS = 60;
export const ENGAGE_MAX_QUESTION = 280;
export const ENGAGE_MAX_QUESTIONS_PER_PERSON = 10;
export const ENGAGE_MAX_OPTIONS = 12;
/** [#147] Questions in one quiz, and the most a question's time limit may be (seconds). */
export const ENGAGE_MAX_QUIZ_QUESTIONS = 30;
export const ENGAGE_MAX_QUIZ_SECONDS = 600;
/** [#147] An answer may arrive this late (ms) after a quiz question's time ran out (network). */
export const ENGAGE_QUIZ_GRACE_MS = 1500;
/** [#147] Points for a right answer: the full amount without a time limit; with one, half plus half again as fast as you were. */
export const ENGAGE_QUIZ_POINTS = 1000;

// ---- Presenting (#146) ----
// POST /api/boards/:id/presentation  body PresentationRequest -> { session: PresentationSession | null }
//   start: anyone who can open the board, unless someone else on the board presents (then only the
//   facilitator or the owner may take over); handoff: the presenter, the facilitator or the owner
//   hands presenting to someone on the board now; end: the presenter, the facilitator or the owner.
export type PresentationRequest =
  | { action: 'start'; frameId?: string | null }
  | { action: 'handoff'; to: string; frameId?: string | null }
  | { action: 'end' };

// ---- Icebreakers (#150) ----
// POST /api/boards/:id/icebreakers/:elementId/roll  -> { result: IcebreakerResult }
//   The server spins the wheel, rolls the dice or shuffles the speakers of the icebreaker as the
//   caller sees the board, and publishes it in ICEBREAKER_RESULTS_COLLECTION for everyone. Owners
//   and editors; while a facilitation session runs, only its facilitator (and the owner). Others
//   (commenters, guests, viewers) watch the result. Rate limited.
export const ICEBREAKER_MAX_ENTRIES = 60;
export const ICEBREAKER_SPIN_MS = 4200;
export const ICEBREAKER_ROLL_MS = 1600;

// ---- Share-link password and expiry (KAI-145) ----
// The board's owner may protect its link (PATCH /api/boards/:id, owner only):
//   linkPassword: string (4–128 characters) sets or changes it, null removes it;
//   linkExpiresAt: epoch ms in the future, or null for no expiry.
// The link then grants its role only to people who gave the CURRENT password (a new password
// cancels every earlier unlock), and nothing after its expiry; memberships, team access and
// ownership are never affected. Connected people whose access came only from the link are
// disconnected when it is protected, changed or expires.
// GET  /api/boards/:id  -> 403 { code: LINK_PASSWORD_REQUIRED } when the link would let this person
//                          in after its password
// POST /api/boards/:id/link-unlock  body { password } -> { ok: true }   (signed in; slow hash,
//                          rate limited per IP and per board + person; 403 wrong password)
// Guests: GuestBoardInfo.passwordRequired; POST /api/guest/boards/:id/join takes { name, password }.
export const LINK_PASSWORD_REQUIRED = 'link_password_required';
export const LINK_PASSWORD_MIN = 4;
export const LINK_PASSWORD_MAX = 128;

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
// PATCH  /api/workspaces/:id/members/:userId body { role, adminScopes?: AdminScope[] | null } -> { member }
//        (owner: any; a members admin: member/guest. `adminScopes` only by an owner, only for an admin)
// DELETE /api/workspaces/:id/members/:userId -> { ok: true }  (owner/admin, or yourself to leave). Cuts
//        live access at once; boards they owned there pass to whoever removed them.
// POST   /api/workspaces/:id/invites/:inviteId/resend -> { invite }   DELETE … -> { ok: true }
// GET    /api/workspace-invites/:token         -> { invite: WorkspaceInvitePreview } | 404
// POST   /api/workspace-invites/:token/accept  -> { workspaceId }
//
// Projects (folders):
// GET    /api/workspaces/:id/projects          -> { projects: ProjectSummary[] }  (the ones you can see)
// POST   /api/workspaces/:id/projects  body { name, access? } -> { project }   (members, not guests)
// PATCH  /api/projects/:id   body { name?, access?, teamAccess?: TeamAccess | null } -> { project }   (its creator or workspace owner/admin)
// DELETE /api/projects/:id   -> { ok: true }   (same; 409 while it still holds boards)
// GET    /api/projects/:id/members -> { members: { userId, name, color, avatarUrl }[] }
// PUT    /api/projects/:id/members/:userId -> { ok: true }   DELETE … -> { ok: true }  (manage: as PATCH)
/**
 * 'organisation' (#108) is the directory row of an organisation above team workspaces: it is never
 * listed as a workspace and holds no boards (see OrganisationSummary).
 */
export type WorkspaceKind = 'personal' | 'team' | 'organisation';
/** What a team workspace's members get on its boards (owners/admins always edit). */
export type TeamAccess = 'editor' | 'commenter' | 'viewer';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';
/**
 * [additive, #151] What an admin administers: `members` (people, invites, roles, deactivation,
 * groups), `content` (sharing policies, every board: inventory, trash, archive, retention, templates,
 * projects — and editing every board, as admins always did) and `security` (sign-in and session
 * settings, single sign-on, provisioning, IP allowlist, integrations, exports and the audit log).
 * Owners have all three; an admin with no scopes set (every admin from before #151) has all three.
 * An admin without `content` counts as a member wherever board content is concerned.
 */
export type AdminScope = 'members' | 'content' | 'security';
export const ADMIN_SCOPES: readonly AdminScope[] = ['members', 'content', 'security'];
/** Error code: an admin without the scope a route needs (403). */
export const ADMIN_SCOPE_REQUIRED = 'admin_scope_required';
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
  /**
   * What members (not guests) get on its boards through the team; a project may set its own
   * level (`ProjectSummary.teamAccess`). Owners/admins always edit.
   */
  teamAccess: TeamAccess;
  /**
   * Who a board's link lets in: 'anyone' — also visitors without an account, as a named guest
   * (at most "can comment", one board, a few hours) — or only signed-in people.
   */
  publicLinks: 'anyone' | 'signedIn';
  /**
   * [additive] Whether pasted links to allow-listed providers (videos, design files, docs) may be
   * activated as live frames on its boards; 'off' keeps every link a preview card.
   */
  liveEmbeds: 'on' | 'off';
  /**
   * [additive] Whether its boards may be embedded live on other sites (#2: a board's owner turns
   * embedding on in the share dialog); 'off' keeps every board out of other sites' frames.
   */
  boardEmbeds: 'on' | 'off';
  /**
   * [additive, #39] 'required': a board's link can only be turned on (or changed) with a password.
   * Links that were already on keep working; the admin console lists the boards that don't comply.
   */
  linkPassword: 'optional' | 'required';
  /**
   * [additive, #39] Days (1–LINK_MAX_DAYS_LIMIT) a board's link may work at most: turning a link on
   * or changing it needs an expiry no later than that many days ahead. null: no limit.
   */
  linkMaxDays: number | null;
  /**
   * [additive, #155] Who may share templates with the workspace — on an organisation, who may
   * publish company templates (and a floor for its workspaces): any member, or owners and content admins.
   */
  templatePublishing: 'members' | 'admins';
}
/** The longest a workspace may let board links live without changing them (#39 `linkMaxDays`). */
export const LINK_MAX_DAYS_LIMIT = 365;
export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /** Your role in it. */
  role: WorkspaceRole;
  memberCount: number;
  policies: WorkspacePolicies;
  createdAt: number;
  /** Set when the workspace's boards are closed to you: you were deactivated, or it requires two-step verification you haven't turned on. */
  blocked: WorkspaceBlock | null;
  /**
   * [additive, #108] The organisation the team workspace belongs to, and the floors it sets:
   * `policies` above are already the effective values (never looser than these).
   */
  organisation?: WorkspaceOrganisation | null;
  /** [additive, #151] What you administer here (empty unless owner/admin; owners: all three). */
  adminScopes?: AdminScope[];
}

// ---- Organisations (#108; docs/design/organisations.md) ----
// One organisation above many team workspaces: its single sign-on, verified domains, provisioning,
// audit log (with SIEM streams) and baseline policies are set once and apply to every attached
// workspace. Policies and security settings are FLOORS: a workspace may be stricter, never looser.
// Org owners/admins manage it; their org role gives them no board content.
//
// GET    /api/organisations                         -> { organisations: OrganisationSummary[] }
// POST   /api/organisations  body { name }          -> { organisation }
// DELETE /api/organisations/:id  body { confirm }   -> { ok: true }   (owner; nothing attached)
// GET    /api/organisations/:id/workspaces          -> { workspaces: OrganisationWorkspace[] }  (org owners/admins)
// POST   /api/organisations/:id/workspaces  body { workspaceId } -> { workspace: OrganisationWorkspace }
//        (an OWNER of the team workspace who is an owner/admin of the organisation)
// DELETE /api/organisations/:id/workspaces/:workspaceId -> { ok: true }   (org owners/admins)
// GET    /api/organisations/:id/workspaces/:workspaceId/members -> { members: OrganisationWorkspaceMember[] }
// POST   /api/organisations/:id/members  body { email, role: 'admin' | 'member' } -> { member }
//        (an existing account in one of its workspaces; admins only by an owner)
// Under its own id an organisation also answers PATCH /api/workspaces/:id (name; `policies` =
// its floors), /workspaces/:id/admin/settings (security floors), /admin/members (+ deactivate:
// organisation-wide), /members/:userId (role, removal), /transfer, /sso…, /scim…, /admin/siem…
// and /audit… (its merged log).
/** The policy keys an organisation sets floors for (teamAccess is a team's own). */
export type OrganisationPolicyKey = Exclude<keyof WorkspacePolicies, 'teamAccess'>;
/** The settings an organisation sets floors for: sign-in and sessions, and (#154) the inactive-board rule. */
export type OrganisationSecurityKey = 'requireTwoFactor' | 'sessionMaxHours' | 'sessionIdleMinutes' | 'inactiveBoardAction' | 'inactiveBoardDays' | 'ipAllowlist';
/**
 * Each policy an organisation sets a floor for, its values from the loosest to the strictest (the
 * server enforces floors with it; the admin console disables what a floor rules out). A new policy
 * that limits sharing adds itself here, or attached workspaces could loosen it.
 */
export const POLICY_STRICTNESS: { [K in OrderedPolicyKey]: ReadonlyArray<WorkspacePolicies[K]> } = {
  externalSharing: ['anyone', 'admins', 'none'],
  linkSharing: ['editor', 'commenter', 'viewer', 'none'],
  guestInvites: ['members', 'admins'],
  downloads: ['anyone', 'members', 'admins'],
  publicLinks: ['anyone', 'signedIn'],
  liveEmbeds: ['on', 'off'],
  boardEmbeds: ['on', 'off'],
  linkPassword: ['optional', 'required'],
  templatePublishing: ['members', 'admins'],
};
/** The floored policies whose values are an ordered choice (all but the numeric `linkMaxDays`). */
export type OrderedPolicyKey = Exclude<OrganisationPolicyKey, 'linkMaxDays'>;
/**
 * Is `value` looser than the organisation's `floor` for policy `k`? `linkMaxDays` is a limit: no
 * limit (null) or more days is looser.
 */
export function looserPolicy<K extends OrganisationPolicyKey>(k: K, value: WorkspacePolicies[K], floor: WorkspacePolicies[K]): boolean {
  if (k === 'linkMaxDays') return floor !== null && (value === null || (value as number) > (floor as number));
  const order = POLICY_STRICTNESS[k as OrderedPolicyKey] as ReadonlyArray<unknown>;
  return order.indexOf(value) < order.indexOf(floor);
}
export interface WorkspaceOrganisation {
  id: string;
  name: string;
  policies: Pick<WorkspacePolicies, OrganisationPolicyKey>;
  settings: Pick<WorkspaceSettings, OrganisationSecurityKey>;
  attachedAt: number;
  /** Your role in the organisation (null: not in its directory). Owners/admins open its console. */
  yourRole: WorkspaceRole | null;
}
/** An organisation as its people see it; shaped like a workspace so the admin console's tabs serve it. */
export interface OrganisationSummary extends Omit<WorkspaceSummary, 'kind' | 'organisation'> {
  kind: 'organisation';
  /** Team workspaces attached to it. */
  workspaceCount: number;
}
export interface OrganisationWorkspace {
  id: string;
  name: string;
  memberCount: number;
  owners: Array<{ userId: string; name: string; email: string }>;
  attachedAt: number;
  /** Its effective policies (its own, raised to the organisation's floors). */
  policies: WorkspacePolicies;
  /** Your own role in it (null: none — an org role gives no board content). */
  yourRole: WorkspaceRole | null;
}
export interface OrganisationWorkspaceMember extends WorkspaceMember {
  deactivated: boolean;
}
/** Error code: a workspace tried to loosen a policy its organisation sets a floor for. */
export const ORGANISATION_POLICY = 'organisation_policy';
/** At most this many organisations per owner. */
export const MAX_ORGANISATIONS_PER_USER = 3;

export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  color: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  joinedAt: number;
  /** [additive, #151] An admin's scopes (null: all three; absent for everyone else). */
  adminScopes?: AdminScope[] | null;
}
// ---- User groups (#63) ----
// A group belongs to one team workspace and holds members of it. Members admins (and owners) make
// and fill groups; anyone who may share a board or manage a project picks a group like a person.
// Access follows the group: joining or leaving it changes what someone opens at once, live sockets
// included. Directory (SCIM) groups are listed beside them, read-only (Provisioning manages those).
// GET    /api/workspaces/:id/groups -> { groups: WorkspaceGroup[], directory: DirectoryGroup[] }  (members, not guests)
// POST   /api/workspaces/:id/groups  body { name } -> { group }                 (members admins)
// PATCH  /api/groups/:id  body { name } -> { group }; DELETE /api/groups/:id -> { ok: true }   (members admins)
// GET    /api/groups/:id/members -> { members: WorkspaceMember[] }              (members, not guests)
// PUT    /api/groups/:id/members/:userId -> { group }; DELETE … -> { group }    (members admins; a member of the workspace)
// GET    /api/boards/:id/groups -> { groups: BoardGroupGrant[] }                (anyone with access)
// PUT    /api/boards/:id/groups/:groupId  body { role } -> { groups }           (who may invite people to it;
//        a group of the board's own workspace; one with guests in it only by who the workspace's
//        guest-invite policy lets invite guests)
// DELETE /api/boards/:id/groups/:groupId -> { groups }                         (owners and co-owners)
// GET    /api/projects/:id/groups -> { groups: WorkspaceGroup[] }; PUT / DELETE /api/projects/:id/groups/:groupId (who manages the project)
export interface WorkspaceGroup {
  id: string;
  workspaceId: string;
  name: string;
  memberCount: number;
  /** Members who are the workspace's guests (sharing with such a group is inviting guests). */
  guestCount: number;
  createdAt: number;
}
export interface DirectoryGroup {
  id: string;
  name: string;
  memberCount: number;
}
export interface BoardGroupGrant {
  groupId: string;
  name: string;
  role: 'editor' | 'commenter' | 'viewer';
  memberCount: number;
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
  /** The project's own team access level for its boards; null: the workspace's (`policies.teamAccess`). */
  teamAccess: TeamAccess | null;
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
  /** [additive, #122] A co-owner: `role` reads 'editor', and they also manage the board's sharing. */
  coOwner?: boolean;
}

// ---- Auth ----
// POST /api/auth/signup   body SignupRequest -> AuthResponse  (sets cookie; emails a verification link)
// POST /api/auth/login    body LoginRequest  -> AuthResponse  (sets cookie)
// POST /api/auth/logout   -> { ok: true, redirect? }          (clears cookie; redirect: the IdP's single logout, #13)
// GET  /api/auth/session  -> SessionResponse (always 200; user null when signed out)
// GET  /api/auth/me       -> AuthResponse | 401
// PATCH /api/auth/me      body { name?, color?, avatarUrl?, timeZone?, theme? } -> AuthResponse
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

/**
 * GET /api/site/legal (modules/site, public): the service's terms, when they are in effect — the
 * marketing site's legal pages are served and the operator (SITE_LEGAL_OPERATOR) is set. Null
 * while they are drafts: sign-up then asks nobody to agree to anything.
 */
export interface SiteLegal {
  legal: { operator: string; termsUrl: string; privacyUrl: string; acceptableUseUrl: string } | null;
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
  | 'wrong_account' // reauth: a different provider account than the one connected
  | 'suspended' // login: Freero's moderators suspended that account
  | 'sso_required' // the address's organization signs its people in only through its own SSO
  | 'signup_closed' // an invite-only server (SIGNUPS=invite-only) and nothing here expects this address
  // Workspace single sign-on (/api/sso/…):
  | 'sso_unavailable' // the workspace has no enabled SSO connection, or its provider can't be reached
  | 'sso_failed' // the identity provider's answer was refused (signature, audience, expiry, replay, …) or expired
  | 'sso_domain' // the identity provider vouched for an address outside the workspace's verified domains
  | 'sso_removed' // the workspace's directory deprovisioned this person (SCIM)
  | 'sso_unsolicited'; // the identity provider started the sign-in (its app tile) and the workspace doesn't allow that

/**
 * 403 `code` when a way of signing in (password, reset link, a personal provider, signup) is
 * refused because the address's workspace enforces single sign-on. Discover where to go with
 * GET /api/sso/discover?email=.
 */
export const SSO_REQUIRED = 'sso_required';

/** The signed-in user's own account (other people only ever see `User`). */
/** How the app looks for this person: follow the device, or always light / dark. */
export type ColorThemePreference = 'system' | 'light' | 'dark';
export const COLOR_THEME_PREFERENCES: readonly ColorThemePreference[] = ['system', 'light', 'dark'];

export interface Account extends User {
  emailVerified: boolean;
  /** [additive] Their app theme, kept with the account so it follows them to every device (absent: 'system'). */
  theme?: ColorThemePreference;
  /**
   * IANA time zone ("Europe/Berlin"): due-date reminders, the "changes on your boards" email and
   * dates in emails follow it. Null until the app detects it from the browser (or you pick one).
   */
  timeZone: string | null;
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
/** `code` of a refused sign-in (403): Freero's moderators suspended the account. */
export const ACCOUNT_SUSPENDED = 'account_suspended';

// ---- Single sign-on per workspace (team workspaces; owners/admins manage it) ----
// GET    /api/workspaces/:id/sso                      -> SsoSettings
// POST   /api/workspaces/:id/sso/domains   body { domain }  -> SsoSettings   (adds a claim + the TXT record to publish)
// POST   /api/workspaces/:id/sso/domains/:domainId/verify -> SsoSettings | 409 (TXT not found yet / domain verified elsewhere)
// DELETE /api/workspaces/:id/sso/domains/:domainId -> SsoSettings
// PUT    /api/workspaces/:id/sso/connection body SsoConnectionInput -> SsoSettings
// POST   /api/workspaces/:id/sso/enforce   body { enforced, breakGlassUserId } -> SsoSettings
//        (409 until a sign-in went through the connection; the break-glass person must be an owner)
// DELETE /api/workspaces/:id/sso/connection -> SsoSettings
// Public (browser navigations unless noted):
// GET  /api/sso/discover?email=          -> SsoDiscovery (fetch; by domain only, never by account)
// GET  /api/sso/:workspaceId/start?next=  -> 302 to the identity provider (SAML AuthnRequest or OIDC)
// GET  /api/sso/:workspaceId/saml/metadata -> the service provider's SAML metadata (XML)
// POST /api/sso/:workspaceId/saml/acs     <- the identity provider posts SAMLResponse + RelayState;
//                                          303 to …/saml/finish, which signs in (bound to this browser)
// GET  /api/sso/:workspaceId/oidc/callback -> 302 to `next`, /login/two-factor?next=…, or /login?error=sso_failed
// IdP-initiated SAML (an unsolicited response, no InResponseTo: the IdP's app tile) is accepted at the
// same ACS only while the connection's `idpInitiated` is on (off by default; refused with
// /login?error=sso_unsolicited otherwise); its RelayState is honoured only as a same-origin path.
// With it off, a tile can link to /start instead (SP-initiated).
// [additive, #13] SAML service-provider keys, encrypted assertions, signed requests, single logout:
// POST   /api/workspaces/:id/sso/sp-keys                 -> SsoSettings (a new key pair; the first is current, a second waits as "next")
// POST   /api/workspaces/:id/sso/sp-keys/:keyId/promote  -> SsoSettings (sign with it from now on; both still decrypt)
// DELETE /api/workspaces/:id/sso/sp-keys/:keyId          -> SsoSettings (not the current one while it is in use)
// GET|POST /api/sso/:workspaceId/saml/slo                <- the IdP's LogoutRequest (ends the SAML sessions of
//                                                           that NameID here; answers a LogoutResponse) or its
//                                                           LogoutResponse to ours (lands on /login)
// POST /api/auth/logout -> { ok: true, redirect?: string }: after the session ended here, the
//                          browser goes on to `redirect` (the IdP's single logout) when it is set.
export interface SsoDomain {
  id: string;
  domain: string;
  verified: boolean;
  /** The DNS TXT record to publish: name and value. */
  txtName: string;
  txtValue: string;
  lastCheckedAt: number | null;
}
export type SsoProtocol = 'saml' | 'oidc';
export interface SsoConnectionInfo {
  protocol: SsoProtocol;
  enabled: boolean;
  enforced: boolean;
  breakGlassUserId: string | null;
  /** Role of people who join through their first SSO sign-in. */
  defaultRole: Exclude<WorkspaceRole, 'owner'>;
  saml: {
    entityId: string;
    ssoUrl: string;
    certificates: Array<{ subject: string; validTo: string; fingerprint: string }>;
    /** [additive, #13] The IdP's SingleLogoutService (HTTP-Redirect); null: no single logout. */
    sloUrl?: string | null;
    /** [additive, #13] Assertions must arrive encrypted to one of the service provider's keys. */
    requireEncryptedAssertions?: boolean;
    /** [additive, #13] AuthnRequests and logout messages are signed with the current key. */
    signRequests?: boolean;
  } | null;
  oidc: { issuer: string; clientId: string; hasClientSecret: boolean } | null;
  /** When a sign-in last went through it (enforcing needs one). */
  testedAt: number | null;
  /** SAML: sign-ins started at the identity provider (its app tile) are accepted. Off by default. */
  idpInitiated: boolean;
}
export interface SsoConnectionInput {
  protocol: SsoProtocol;
  enabled: boolean;
  defaultRole?: Exclude<WorkspaceRole, 'owner'>;
  /** SAML: accept sign-ins started at the identity provider. Omitted: unchanged. */
  idpInitiated?: boolean;
  /** [additive, #13] SAML: require encrypted assertions / sign requests (need a key). Omitted: unchanged. */
  requireEncryptedAssertions?: boolean;
  signRequests?: boolean;
  /** [additive, #13] SAML: the IdP's single logout URL ('' clears it). Omitted: unchanged, or from the metadata. */
  samlSloUrl?: string;
  /** SAML: the IdP's metadata XML, or its parts. */
  samlMetadataXml?: string;
  samlEntityId?: string;
  samlSsoUrl?: string;
  samlCertificate?: string;
  /** OIDC: a blank secret keeps the stored one. */
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
}
export interface SsoSettings {
  domains: SsoDomain[];
  connection: SsoConnectionInfo | null;
  /** What to configure at the identity provider. `sloUrl` [additive, #13]: its single logout endpoint. */
  serviceProvider: { entityId: string; acsUrl: string; metadataUrl: string; oidcRedirectUri: string; startUrl: string; sloUrl?: string };
  /** [additive, #13] The SAML service provider's key pairs (certificates are public; private keys never leave the server). */
  spKeys?: SsoSpKey[];
}
/** A SAML service-provider key pair: published in the metadata (signing + encryption) while it exists. */
export interface SsoSpKey {
  id: string;
  /** Signs requests; the others only decrypt (rotation). */
  current: boolean;
  createdAt: number;
  subject: string;
  validTo: string;
  fingerprint: string;
  /** PEM, to give the identity provider. */
  certificate: string;
}
export interface SsoDiscovery {
  sso: { workspaceName: string; startUrl: string; enforced: boolean } | null;
}

// ---- Domain control (#64; team workspaces with a VERIFIED domain; owners/admins; no SSO needed) ----
// GET    /api/workspaces/:id/sso/domain-control                     -> DomainControlSettings
// PUT    /api/workspaces/:id/sso/domain-control  body { captureSignups?, blockWorkspaces? } -> DomainControlSettings
// POST   /api/workspaces/:id/sso/domain-control/captures body { userIds, graceDays } -> DomainControlSettings
//        (each person is emailed; after the grace period they are a member, if their address is
//        still verified and at the domain; their own boards stay theirs)
// DELETE /api/workspaces/:id/sso/domain-control/captures/:userId     -> DomainControlSettings
// With `blockWorkspaces`, POST /api/workspaces by someone at the domain is 403
// { code: WORKSPACE_CREATION_BLOCKED } naming the workspace's admins.
export interface DomainAccount {
  userId: string;
  name: string;
  email: string;
  /** member: already in the workspace; pending: joins at `joinsAt`; outside: neither. */
  status: 'member' | 'pending' | 'outside';
  joinsAt: number | null;
}
export interface DomainControlSettings {
  /** The workspace's verified domains (domain control applies to these only). */
  domains: string[];
  /** Accounts that verify an address at the domains (sign-up, email change) join the workspace at once. */
  captureSignups: boolean;
  /** People at the domains can't create team workspaces of their own. */
  blockWorkspaces: boolean;
  /** Accounts at the domains that proved their address (unverified ones are never listed or taken in). */
  accounts: DomainAccount[];
}
export const DOMAIN_CAPTURE_GRACE_DAYS = [7, 14, 30] as const;
/** 403 `code` of POST /api/workspaces when the person's verified domain is managed by another workspace. */
export const WORKSPACE_CREATION_BLOCKED = 'workspace_creation_blocked';

// ---- Provisioning (SCIM 2.0, team workspaces; owners/admins manage it) ----
// Base URL: <PUBLIC_URL>/scim/v2 (Users, Groups, ServiceProviderConfig, ResourceTypes, Schemas),
// authenticated with `Authorization: Bearer <token>`; the token names the workspace.
// GET    /api/workspaces/:id/scim               -> ScimSettings
// POST   /api/workspaces/:id/scim/tokens  body { label } -> { token: string (shown once), settings: ScimSettings }
// POST   /api/workspaces/:id/scim/tokens/:tokenId/rotate -> { token, settings }  (a new token replaces it at once)
// DELETE /api/workspaces/:id/scim/tokens/:tokenId -> ScimSettings   (or overlap: create a new one, then revoke the old)
// PUT    /api/workspaces/:id/scim/groups/:groupId body { mapping: ScimGroupMapping | null } -> ScimSettings
export interface ScimTokenInfo {
  id: string;
  label: string;
  /** The first characters, to tell tokens apart. */
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}
/** What a directory group grants in Freero: a workspace role, or membership of a project. */
export type ScimGroupMapping =
  | { kind: 'role'; role: Exclude<WorkspaceRole, 'owner'> }
  | { kind: 'project'; projectId: string }
  /** [additive, #108] An organisation's group: membership of one of its team workspaces, with that role there. */
  | { kind: 'workspace'; workspaceId: string; role: Exclude<WorkspaceRole, 'owner'> };
export interface ScimGroupInfo {
  id: string;
  displayName: string;
  memberCount: number;
  mapping: ScimGroupMapping | null;
}
export interface ScimSettings {
  baseUrl: string;
  tokens: ScimTokenInfo[];
  groups: ScimGroupInfo[];
  /** People the directory manages here, and how many it deactivated. */
  provisioned: { active: number; deactivated: number };
}

// ---- Data exports (GDPR) ----
// POST /api/me/exports                       -> { export: DataExportInfo }  (your data; built in the
//                                               background, then a link is emailed; rate limited)
// GET  /api/me/exports                       -> { exports: DataExportInfo[] }
// POST /api/workspaces/:id/exports           -> { export } (owners/admins of a team workspace)
// GET  /api/workspaces/:id/exports           -> { exports }
// GET  /api/exports/:id/download             -> the ZIP (only the person who asked for it, signed in)
export interface DataExportInfo {
  id: string;
  kind: 'user' | 'workspace';
  status: 'pending' | 'running' | 'ready' | 'failed' | 'expired';
  createdAt: number;
  readyAt: number | null;
  expiresAt: number | null;
  bytes: number | null;
}

// ---- Boards ----
// GET    /api/boards?workspace=<id>&project=<id>&filter=all|mine|shared|starred|recent|trash|archived&q=text
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
// PATCH  /api/boards/:id           body UpdateBoardRequest -> { board: BoardSummary }  (owner/editor; linkAccess,
//                                    link protection, embedding and `sharing`: owners and co-owners)
// POST   /api/boards/:id/move      body MoveBoardRequest -> MoveBoardResponse  (#124; its owner, a full
//                                    member of the target workspace — or the target is their personal
//                                    one; the source's "downloads" policy must let them take it out.
//                                    Same id, content, comments, files and versions; the target's
//                                    policies apply at once: what they forbid is turned off, both
//                                    workspaces audit it, connected people are re-checked)
// DELETE /api/boards/:id           -> { ok: true }  (owner only) moves it to the trash: gone from every
//                                    list and for every member (404, sockets closed 4403) until restored;
//                                    deleted for good TRASH_RETENTION_DAYS later
// POST   /api/boards/:id/restore   -> { board: BoardSummary }  (owner only; 404 unless in your trash;
//                                    403 over the board quota)
// DELETE /api/boards/:id/permanent -> { ok: true }  (owner only; only boards in the trash)
// POST   /api/boards/:id/archive | /unarchive -> { board: BoardSummary }  [additive, #153] (its owner,
//                                    or a content admin of its workspace): an archived board is
//                                    read-only for everyone, listed only with filter=archived, never
//                                    moved to the trash by a retention rule; live sockets are re-checked
// POST   /api/boards/:id/duplicate body DuplicateBoardRequest? -> { board: BoardSummary }  (copies the Yjs
//                                    state; [additive, #124] into `workspaceId` / `projectId` when given —
//                                    where you may create boards — else the source's when you may, else personal)
// PUT    /api/boards/:id/star      -> { ok: true }
// DELETE /api/boards/:id/star      -> { ok: true }
// PUT    /api/boards/:id/thumbnail body { dataUrl: string } -> { ok: true } (editor+)
export interface CreateBoardRequest { title?: string; description?: string; workspaceId?: string; projectId?: string | null }
/** [additive, #124] Where a duplicate goes. */
export interface DuplicateBoardRequest { workspaceId?: string; projectId?: string | null }
/** [additive, #124] Where a board moves (another workspace you're in, a project there or none). */
export interface MoveBoardRequest { workspaceId: string; projectId?: string | null }
/**
 * What the target workspace's policies turned off when a board moved there (#124):
 * `link_lowered` / `link_off`: its link was above the workspace's maximum, or the workspace
 * requires a password or a shorter expiry it didn't have; `embedding_off`: the workspace doesn't let
 * its boards be embedded on other sites; `tracker_links_paused`: issues linked through the old
 * workspace's tracker connections stop syncing (`count`).
 */
export type MoveAdjustment =
  | { kind: 'link_lowered'; to: LinkAccess }
  | { kind: 'link_off' }
  | { kind: 'embedding_off' }
  | { kind: 'tracker_links_paused'; count: number };
export interface MoveBoardResponse {
  board: BoardSummary;
  adjusted: MoveAdjustment[];
}

/**
 * [additive, KAI-137] What restoring a `.freero` backup did (`POST /api/boards/restore-backup`, the file as
 * the body, `?workspace=&project=`): the new board, and what of the file could not be brought back.
 */
export interface RestoreBackupResponse {
  board: BoardSummary;
  report: {
    /** The board the file was made from (its title then, and the Freero it came from). */
    source: { title: string; origin: string | null; exportedAt: string; formatVersion: number };
    /** Files re-uploaded into the restorer's storage. */
    files: number;
    /** Files the board referenced that the backup did not carry (too large, gone when it was made). */
    missingFiles: number;
    /** Hidden frames' contents (owners/editors' backups) were restored too. */
    hiddenContent: boolean;
  };
}
/** [additive, KAI-137] The `.freero` file's media type (served as an attachment; the PWA opens it). */
export const BACKUP_MEDIA_TYPE = 'application/vnd.freero.board+zip';
export const BACKUP_EXTENSION = '.freero';
// Docs (KAI-162; modules/docs). A doc is a container like a board (same sharing, members, link,
// trash, request access: the /api/boards/:id routes serve it too) whose content is a document.
// POST   /api/docs                 body CreateDocRequest -> { doc: BoardSummary }  (kind 'doc')
//                                    `fromBoard`: in that board's workspace and project when the
//                                    person may create there (a doc made on a board), else personal
// GET    /api/docs/:id/markdown    -> text/markdown, the doc as the reader sees it (downloads policy;
//                                    recorded as doc.exported)
// WS     /ws/docs/:id              the doc's Yjs document (y-websocket protocol, like /ws/boards)
export interface CreateDocRequest {
  title?: string;
  /** Initial content (Markdown); at most DOC_MAX_IMPORT_CHARS. */
  markdown?: string;
  workspaceId?: string;
  projectId?: string | null;
  fromBoard?: string;
}
export interface CreateDocResponse {
  doc: BoardSummary;
}
/** Longest Markdown a doc is created from or imports (characters). */
export const DOC_MAX_IMPORT_CHARS = 1_000_000;
/** `projectId`: move it into that project of its workspace (null: the workspace root); `permissions.canMove`. */
export interface UpdateBoardRequest {
  title?: string;
  description?: string;
  linkAccess?: LinkAccess;
  projectId?: string | null;
  /** [additive] Owners and co-owners (KAI-145, #122): set / change the link's password, or null to remove it. */
  linkPassword?: string | null;
  /** [additive] Owners and co-owners (KAI-145, #122): when the link stops working (epoch ms, future), or null. */
  linkExpiresAt?: number | null;
  /** [additive] Owners and co-owners (#2, #122): let other sites embed the board (`BoardSummary.embeddable`). */
  embeddable?: boolean;
  /** [additive, #123] Owners and co-owners: change the board's sharing settings (`BoardSummary.sharing`); audited. */
  sharing?: Partial<BoardSharingSettings>;
}
// A link change in one PATCH (linkAccess, linkPassword, linkExpiresAt together) is checked as a
// whole against the workspace's link policy (#39): turning a link on with its password and expiry
// in the same request works where the policy requires them.

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
/** 'decision': a decision snapshot (decisions.ts, KAI-161) — never pruned, named after the decision. */
export type BoardVersionKind = 'auto' | 'named' | 'before-restore' | 'decision';
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

// ---- Team sticker sets (#138; server modules/stickers) ----
// A workspace's own stickers, in named sets its members place from the emoji & stamps picker.
// The images are uploads (same checks as any image, a smaller size cap); a placed sticker is an
// emoji item whose `emoji` is `img:/uploads/<name>` (it keeps showing after its set is removed).
// GET    /api/boards/:id/stickers         -> StickersResponse  (the sets of the board's workspace;
//                                          none when you aren't in that workspace)
// POST   /api/boards/:id/sticker-sets     body { name } -> { set: StickerSet }  (members of the
//                                          board's workspace, not guests; 400 over MAX_STICKER_SETS)
// POST   /api/sticker-sets/:id/stickers?name=<name>  body: the image bytes (Content-Type
//                                          image/png, image/svg+xml, image/webp or image/gif)
//                                          -> { sticker: Sticker }  (members; 413 over
//                                          MAX_STICKER_BYTES or the upload quota, 415 other types,
//                                          400 when the bytes aren't that image)
// DELETE /api/sticker-sets/:id             -> { ok: true }  (its creator, or a workspace owner / admin)
// DELETE /api/sticker-sets/:id/stickers/:stickerId -> { ok: true }  (the same, or who added it)
export interface Sticker {
  id: string;
  name: string;
  /** "/uploads/<name>" */
  url: string;
}
export interface StickerSet {
  id: string;
  name: string;
  /** Who made the set, by their current name (null: an account deleted since). */
  createdBy: string | null;
  /** You may add stickers to it. */
  canAdd: boolean;
  /** You may remove it (and any sticker in it): its creator, or a workspace owner / admin. */
  canManage: boolean;
  stickers: Sticker[];
}
export interface StickersResponse {
  sets: StickerSet[];
  /** You may make a new set in the board's workspace. */
  canCreate: boolean;
}
export const MAX_STICKER_SETS = 30;
export const MAX_STICKERS_PER_SET = 120;
export const MAX_STICKER_BYTES = 512 * 1024;
export const MAX_STICKER_NAME = 60;

// ---- Saved templates (a board or a selection saved for reuse) ----
// You see your own templates plus those shared with a team workspace you are a member (not a
// guest) of.
// GET    /api/templates      -> { templates: SavedTemplateSummary[] }  (visible to you, newest first)
// GET    /api/templates/:id  -> { template: SavedTemplate }           (404 unless visible to you)
// POST   /api/templates      body SaveTemplateRequest -> { template: SavedTemplateSummary }
//                            (400 invalid / too large, 403 over MAX_TEMPLATES_PER_USER, or when
//                            `boardId`'s workspace doesn't let you download its content)
// PATCH  /api/templates/:id  body { workspaceId: string | null } -> { template }  (its owner; share
//                            with a team workspace you're a member of, or make it personal again.
//                            Owners/admins of the workspace it is shared with may unshare it: null)
// A template stops being shared with a workspace when its owner leaves it or becomes a guest there.
// DELETE /api/templates/:id  -> { ok: true }  (its owner only; not while an admin locked it)
// PATCH  /api/templates/:id  body { organisationId: string | null } -> { template }  [additive, #155]
//        (its owner publishes it to an organisation of one of their workspaces — as the
//        organisation's `templatePublishing` allows — or takes it back, unless locked; the
//        organisation's content admins may also withdraw it)
// POST   /api/templates/:id/lock   body { locked }  -> { template }  (owners / content admins of where it is shared or published)
// POST   /api/templates/:id/retire body { retired } -> { template }  (same)
// GET    /api/workspaces/:id/admin/templates -> { templates: SavedTemplateSummary[] }  (content admins of a
//        workspace or organisation: what is shared with or published to it, retired ones included)
export interface SavedTemplateSummary {
  id: string;
  name: string;
  description: string;
  /** /uploads URL of the preview image, or null. */
  thumbnail: string | null;
  ownerId: string;
  /** The team workspace it is shared with, or null (personal). */
  workspaceId: string | null;
  /** Who saved (and shared) it, by their current name. */
  ownerName: string;
  /** You may stop sharing it: its owner, or an owner/admin of the workspace it is shared with. */
  canUnshare: boolean;
  elementCount: number;
  createdAt: number;
  updatedAt: number;
  /** [additive, #155] The organisation it is published to (a company template), with its name. */
  organisationId?: string | null;
  organisationName?: string | null;
  /** [additive, #155] Locked by admins: everyone may use it, only admins change or remove it. */
  locked?: boolean;
  /** [additive, #155] Retired by admins: out of every picker (admins and its owner still see it). */
  retiredAt?: number | null;
  /** [additive, #155] You may lock and retire it: an owner / content admin of where it is shared or published. */
  canManage?: boolean;
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
//        (owner, co-owner, or editor while the board's "Editors can share" is on — else 403
//        `board_sharing_restricted` — with a verified email). An existing account becomes a member
//        ({ member }); any other address gets a pending invite emailed to it ({ invite }). An editor
//        re-inviting with a different role gets 409: only owners and co-owners change roles.
// PATCH  /api/boards/:id/members/:userId body { role: BoardMemberRole } -> { member }   (owner or co-owner;
//        'coowner' makes them a co-owner, any other role ends it; audited)
// DELETE /api/boards/:id/members/:userId -> { ok: true } (owner or co-owner, or self to leave)
// Co-owners (#122) can never delete the board, transfer it or change the owner's access.
export interface InviteRequest { email: string; role: Exclude<Role, 'owner'> }
export type InviteResponse = { member: BoardMember; invite?: never } | { invite: PendingInvite; member?: never };

// Pending invites (people without an account yet). The emailed link is /invite/<token>.
// GET    /api/boards/:id/invites                    -> { invites: PendingInvite[] }  (owner/editor)
// POST   /api/boards/:id/invites/:inviteId/resend   -> { invite: PendingInvite }     (new link + expiry; old link dies)
// DELETE /api/boards/:id/invites/:inviteId          -> { ok: true }  (owner or co-owner, or the editor who sent it)
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

// ---- Access requests ----
// Someone signed in who can't open a board asks for access. Deciders: the board's owner and, for a
// team board, its workspace's owners/admins (a private project's board: also the project's
// creator). They hear about it (notification `access.request`: the board owner, plus the admins —
// or, for a private project's board, the project's creator) and approve as viewer / commenter /
// editor, or decline; the requester hears back (`access.response`), and the request page lets them
// in at once. One pending request per person per board; asking again right after a "no" waits.
// GET    /api/boards/:id/access-request                -> AccessRequestState   (404: no such board)
// POST   /api/boards/:id/access-request  body { role, message? } -> AccessRequestState (verified
//        email; rate limited; 403 when the workspace keeps its boards to its own people)
// DELETE /api/boards/:id/access-request                -> AccessRequestState   (withdraw it)
// GET    /api/boards/:id/access-requests               -> { requests: BoardAccessRequest[] } (deciders)
// POST   /api/boards/:id/access-requests/:userId body { decision: 'approve' | 'deny', role? } -> { ok: true }
//        (deciders; 409 when it was decided meanwhile; approving someone outside a team workspace
//        follows its "external sharing" policy)
export interface AccessRequestState {
  status: 'none' | 'pending' | 'denied' | 'granted';
  /** status 'granted': your role now. */
  role?: Role;
  /** You may ask now (false right after a "no", or when the workspace allows only its own people). */
  canRequest: boolean;
  /** Why you can't, in words. */
  reason?: string;
}
export interface BoardAccessRequest {
  userId: string;
  name: string;
  email: string;
  color: string;
  avatarUrl: string | null;
  role: Exclude<Role, 'owner'>;
  message: string;
  createdAt: number;
}

// ---- Guests: visitors without an account on a shared link ----
// When a board's "anyone with the link" is on and its workspace allows visitors without an account
// (policies.publicLinks 'anyone', and external sharing not 'none'), someone without an account may
// join THAT board under a name, as "Guest · <name>": at most commenter (an "editor" link gives
// guests "can comment"), for GUEST_SESSION_HOURS, through an HttpOnly cookie `freero_guest` that
// opens nothing but that board (its doc socket, its people lookup). Guests never see members'
// emails or the member list, can't @mention, and get no notifications. Their comments are stored
// under their guest id with the name "Guest · <name>" (the server refuses any other name for them).
// Changing the link or the policy re-checks connected guests at once; expired guests are dropped.
// A commenter guest takes part in votes, planning poker and private mode like any commenter while
// the board lets them (participation.ts: their own ballot, pick and drafts only, server-enforced).
// GET  /api/guest/boards/:id        -> GuestBoardInfo           (no session needed; 404: no such board)
// POST /api/guest/boards/:id/join   body { name } -> GuestJoinResponse (rate limited per IP; 403 when
//                                      the board doesn't let guests in)
// GET  /api/guest/me                -> { guest: GuestInfo | null }
// GET  /api/guest/boards/:id/board  -> { board: BoardSummary }  (the guest's own board only)
// POST /api/guest/leave             -> { ok: true }  (ends the guest session)
export const GUEST_ID_PREFIX = 'guest_';
export const GUEST_SESSION_HOURS = 12;
export const MAX_GUEST_NAME = 40;
/** Guest ids never collide with account ids (those have no underscore). */
export const isGuestId = (id: string): boolean => id.startsWith(GUEST_ID_PREFIX);
/** How a guest is shown everywhere (presence, comments, activity). */
export const guestDisplayName = (name: string): string => `Guest · ${name}`;
/**
 * The name a comment message is shown under (KAI-187, KAI-201), wherever it is shown (comments,
 * find): its author's CURRENT name (`current`, from the board's people lookup) when known — so
 * neither a rename nor a name a crafted client stored can make it read as someone else. The stored
 * name is only a fallback: before the lookup answers, and for accounts that no longer exist (the
 * purge rewrote it to "Deleted user"). A guest's always reads as a guest.
 */
export function commentAuthorName(m: { authorId: string; authorName: string }, current: string | undefined): string {
  if (current) return current;
  if (isGuestId(m.authorId)) return m.authorName.startsWith(guestDisplayName('')) ? m.authorName : guestDisplayName(m.authorName);
  return m.authorName;
}
export interface GuestBoardInfo {
  /** Visitors without an account may join (and as what); the title only then. */
  allowed: boolean;
  role?: 'viewer' | 'commenter';
  title?: string;
  /** [additive] The link asks for a password (KAI-145): send it with the join. */
  passwordRequired?: boolean;
}
export interface GuestInfo {
  id: string;
  /** As typed; shown as guestDisplayName(name). */
  name: string;
  color: string;
  boardId: string;
  expiresAt: number;
}
export interface GuestJoinResponse { guest: GuestInfo }

// ---- Live board views in AI assistants (MCP Apps, KAI-171) ----
// The assistant's view frames /embed/board/:id#ticket=<single-use ticket>; the page redeems it:
// POST /api/embed/redeem { ticket } -> EmbedRedeemResponse (404: expired, used or unknown).
// The socket is /ws/embed/boards/:id with the token as its second WebSocket subprotocol
// (`[EMBED_WS_PROTOCOL, token]`): never the session cookie.
export const EMBED_WS_PROTOCOL = 'freero.embed';
export interface EmbedRedeemResponse {
  /** Opens this board's socket until `expiresAt` (then the view asks the assistant again). */
  token: string;
  expiresAt: number;
  /** The person the view acts for. */
  user: { id: string; name: string; color: string; avatarUrl: string | null };
  /** As that person sees it; `role` capped by what the assistant's connection may do. */
  board: BoardSummary;
  boardUrl: string;
  /** The app or token the view came from ("Claude"). */
  app: string;
}

// ---- Public live embeds on other sites (#2; docs/integrations/embedding.md) ----
// Any site may frame /embed/b/:id[?readonly=1][&frame=<itemId>] while the board's owner allows
// embedding (`BoardSummary.embeddable`) and its workspace's `boardEmbeds` policy is on; the page
// is the ONLY one framable from anywhere (every other page stays frame-ancestors 'none'). What it
// shows follows the board's sharing exactly, never more:
// - a visitor without an account sees the board live, read-only, when its link lets visitors
//   without an account in (as guests could; no password) — and no presence of theirs is shown;
// - anyone else signs in through a first-party popup (/embed/connect/:id), which hands the frame a
//   token for THIS board that acts with the person's own role (capped at viewer with readonly=1)
//   and ends with their session. Editing starts only after a click inside the frame.
// GET  /api/embed/b/:id                         -> PublicEmbedInfo  (no account needed)
// POST /api/embed/b/:id/token  { readonly? }    -> PublicEmbedToken (session; first-party popup only)
// POST /api/embed/b/:id/me     { token }        -> PublicEmbedMember (401: sign in again)
// GET  /api/oembed?url=<board or embed URL>[&maxwidth][&maxheight] -> OEmbedResponse (public boards only)
// Socket: /ws/embed/b/:id, subprotocols [PUBLIC_EMBED_WS_PROTOCOL] (visitor) or
// [PUBLIC_EMBED_WS_PROTOCOL, token] (signed in), plus PUBLIC_EMBED_VIEW_ONLY to stay read-only.
export const PUBLIC_EMBED_WS_PROTOCOL = 'freero.public-embed';
/** A further subprotocol: this socket only reads, whatever the person may do (editing not started yet). */
export const PUBLIC_EMBED_VIEW_ONLY = 'freero.view-only';
/** `code` of a 403 from POST …/token: the person can't open the board (the popup offers to ask for access). */
export const EMBED_NO_ACCESS = 'embed_no_access';
/** Close code: too many visitors are watching this board's embeds right now (#60). */
export const WS_CLOSE_EMBED_FULL = 4430;
export type PublicEmbedInfo =
  /** Embedding is off for it (or there is no such board): the same answer either way. */
  | { status: 'off' }
  /**
   * `visitor`: what someone without an account may do here ('viewer'), or null (sign in).
   * `title` only when a visitor may see the board.
   */
  | { status: 'on'; boardId: string; title: string | null; visitor: 'viewer' | null; boardUrl: string };
export interface PublicEmbedToken {
  token: string;
  expiresAt: number;
}
export interface PublicEmbedMember {
  user: { id: string; name: string; color: string; avatarUrl: string | null };
  /** As that person sees it, with `role` capped by the token (readonly). */
  board: BoardSummary;
  boardUrl: string;
  expiresAt: number;
}
/** What the connect popup tells the embed frame that opened it (window.opener, same origin only). */
export type EmbedConnectMessage =
  | { freeroEmbedConnect: 'token'; boardId: string; token: string; expiresAt: number }
  | { freeroEmbedConnect: 'no-access'; boardId: string };

// ---- Microsoft Teams and Microsoft 365 Copilot (#112, #113, #114; docs/integrations/teams.md) ----
// The Teams app's pages run the public embed inside Teams: /teams/config (the tab's configuration:
// pick a board), /teams/b/:id (tab, meeting side panel and stage), both framed by Teams only. Teams
// opens Freero's own pages in its sign-in window (authentication.authenticate): /embed/connect/:id
// with ?teams=1 (sign in for one board) and /teams/choose (sign in and pick one of your boards);
// they hand their result back through the Teams JavaScript library (authentication.notifySuccess),
// which talks only to Teams' own origins, as one of these JSON strings.
// GET /api/integrations/microsoft -> MicrosoftIntegrationsInfo (what this instance offers)
export type TeamsSignInResult =
  | { kind: 'token'; boardId: string; token: string; expiresAt: number }
  | { kind: 'no-access'; boardId: string };
export interface TeamsChooseResult {
  boardId: string;
  /** The board's title, for the tab's name (the person who picked it can see it). */
  title: string;
  /** A token for the board's embeds, so the tab opens signed in for the person who added it. */
  token: string | null;
  expiresAt: number | null;
}
export interface MicrosoftIntegrationsInfo {
  /** The Teams app (TEAMS_APP_ID): its package, and whether links get previews (TEAMS_BOT_ID). */
  teams: { packageUrl: string; linkPreviews: boolean } | null;
  /** The Copilot agent (COPILOT_APP_ID + COPILOT_OAUTH_REFERENCE_ID): its package. */
  copilot: { packageUrl: string } | null;
}

export interface OEmbedResponse {
  version: '1.0';
  type: 'rich';
  provider_name: string;
  provider_url: string;
  title: string;
  html: string;
  width: number;
  height: number;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  cache_age?: number;
}

// ---- Activity ----
// What people did, one entry per person per burst of work ("Ann added 12 sticky notes in frame
// “Ideas”"), derived on the server from changes it applied from that person's own socket and from
// sharing events — never from what a client says. Never names element content. Entries about hidden
// frames' contents are shown to owners/editors only; private drafts never appear.
// GET /api/boards/:id/activity?before=<ms>&limit=<n>      -> ActivityResponse  (anyone with access; also guests)
// GET /api/workspaces/:id/activity?before=<ms>&limit=<n>  -> ActivityResponse  (the boards of that workspace
//     you can open — in your personal workspace also boards shared with you — with boardTitle set)
export interface ActivityEntry {
  id: string;
  boardId: string;
  /** Workspace feed only. */
  boardTitle?: string;
  /** Null for a guest or a deleted account (`actorName` still names them). */
  actor: BoardPerson | null;
  /** "Claude for Maria" when an app or token did it for them (`via`). */
  actorName: string;
  /** The app or token that acted for `actor` (the public API, MCP; KAI-168), else absent. */
  via?: string;
  /** 'board': the board as a whole (created, renamed, moved, trashed / restored, a version restored). */
  kind: 'edit' | 'comment' | 'share' | 'board';
  /** Worded after the actor's name: "added 12 sticky notes in frame “Ideas”". */
  text: string;
  startedAt: number;
  /** When the burst ended (entries are ordered by it). */
  at: number;
  /**
   * kind 'edit': the items it added or changed, to find them on the board (some may be gone since;
   * at most MAX_ACTIVITY_ITEMS per entry, `moreItems` when there were more), and how many it removed.
   * Absent on entries recorded before items were kept.
   */
  items?: string[];
  moreItems?: boolean;
  removedItems?: number;
}
export interface ActivityResponse { entries: ActivityEntry[]; hasMore: boolean }
/** Most items an activity entry keeps (per list: added, changed, removed). */
export const MAX_ACTIVITY_ITEMS = 200;

// ---- Changes since your last visit ----
// The server keeps when each person last had a board open (their last socket on it closed). When
// others changed it since, the board offers "See recent changes": what they added, changed and
// removed, read from the activity feed (attributed changes only: your own edits are never news,
// an app acting for you is), as you may see it now.
// GET /api/boards/:id/catch-up          -> CatchUpSummary  (accounts; cheap: activity rows only)
// GET /api/boards/:id/catch-up/changes  -> CatchUpChanges  (the items, with their text; removed ones
//     as they read at the last version kept before your visit)
export interface CatchUpSummary {
  /** When you last had the board open (null: never, or before Freero kept it). */
  since: number | null;
  /** Net over everyone else's changes since then. */
  counts: { added: number; changed: number; removed: number; comments: number };
  /** Who made them (most active first; an app acting for someone is named "<app> for <person>"). */
  people: Array<{ id: string | null; name: string; color: string; avatarUrl: string | null }>;
}
export interface CatchUpItem {
  id: string;
  /** Element type ('sticky', 'card', …). */
  kind: string;
  /** Its text now (a removed item: then; '' when unknown). */
  text: string;
  /** A changed item: its text before, when it differs. */
  before?: string;
  frame?: string;
  /** [additive, #126] The frame it is in now (items still on the board), for going there. */
  frameId?: string;
  /** Who changed it (names, last one first). */
  by: string[];
  at: number;
}
export interface CatchUpChanges extends CatchUpSummary {
  added: CatchUpItem[];
  changed: CatchUpItem[];
  removed: CatchUpItem[];
  /** More items changed than are listed (each list holds at most MAX_CATCH_UP_ITEMS). */
  truncated: boolean;
}
export const MAX_CATCH_UP_ITEMS = 300;

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
// PUT  /api/notifications/prefs  body { email?: { [type]: boolean }, emailAll?: boolean,
//      boardChanges?: BoardChangesFrequency } -> NotificationPrefs
// POST /api/notifications/unsubscribe?token=<t>[&list=board-changes]  (no session needed: the signed
//      link from a digest email, also its RFC 8058 one-click target) -> { ok: true, email, list } | 400
//      (list 'board-changes': the "changes on your boards" email only; else every notification email)
// WebSocket /ws/notifications (session cookie): the server sends a JSON NotificationsLiveMessage
//      whenever the user's notifications change, whichever instance created them.
//
// Types are open-ended: a new source (e.g. workspace invites) adds its type here and its entry in
// the server's modules/notifications/types.ts; the inbox shows `title` / `body` as sent.
export type NotificationType =
  | 'board.invite'
  | 'comment.mention'
  | 'comment.reply'
  | 'workspace.invite'
  | 'access.request'
  | 'access.response'
  | 'moderation.action'
  | 'card.assigned'
  | 'card.due_changed'
  | 'card.due_soon'
  | 'walkthrough.mention'
  | 'walkthrough.comment'
  | 'walkthrough.reaction'
  | 'agent.blocked'
  | 'problem.fixed';

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
  /**
   * type 'access.request': the request as it stands now (`actor` asked). `canDecide`: you may
   * still approve / decline it here (POST /api/boards/:boardId/access-requests/:actor.id).
   */
  accessRequest?: {
    role: Exclude<Role, 'owner'>;
    status: 'pending' | 'approved' | 'denied' | 'withdrawn';
    decidedRole: Exclude<Role, 'owner'> | null;
    canDecide: boolean;
  };
}
export interface NotificationsResponse { notifications: AppNotification[]; unread: number; hasMore: boolean }
export interface NotificationTypePref { type: NotificationType; label: string; description: string; email: boolean }
export interface NotificationPrefs {
  /** Master switch for notification emails (the one-click unsubscribe turns it off). */
  emailAll: boolean;
  types: NotificationTypePref[];
  /**
   * "Changes on your boards": an email summarising what others changed on boards you own or
   * starred, off unless you choose a frequency (daily: each morning; weekly: Monday morning, in
   * your time zone). Its own unsubscribe link turns only it off; `emailAll` off stops it too.
   */
  boardChanges: BoardChangesFrequency;
}
export type BoardChangesFrequency = 'off' | 'daily' | 'weekly';
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
 * Live embeds (KAI-127): the providers a link card may frame, after a click. The web app parses a
 * pasted link into the provider's official embed URL (never framing the stored URL as given), on
 * one of `frameOrigins`; the server's Content-Security-Policy `frame-src` allows exactly the
 * origins listed here plus the operator's `EMBED_EXTRA_ORIGINS`. Each frame gets the provider's
 * `sandbox` and `allow`. Freero never embeds other whiteboards.
 */
export interface EmbedProvider {
  id: 'youtube' | 'vimeo' | 'loom' | 'figma' | 'google' | 'codepen' | 'codesandbox';
  name: string;
  /** 'video' plays; 'document' is a live view to scroll and click in. */
  kind: 'video' | 'document';
  frameOrigins: readonly string[];
  /**
   * [additive, #170] Hosts whose links the web app's parser reads for this provider
   * (features/embed providers.ts); the public API takes embed items only on these (or an operator's
   * allow-listed origin).
   */
  linkHosts: readonly string[];
  sandbox: string;
  allow: string;
}

const VIDEO_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups';
const VIDEO_ALLOW = 'autoplay; encrypted-media; fullscreen; picture-in-picture';

export const EMBED_PROVIDERS: readonly EmbedProvider[] = [
  { id: 'youtube', name: 'YouTube', kind: 'video', frameOrigins: ['https://www.youtube-nocookie.com'], linkHosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], sandbox: VIDEO_SANDBOX, allow: VIDEO_ALLOW },
  { id: 'vimeo', name: 'Vimeo', kind: 'video', frameOrigins: ['https://player.vimeo.com'], linkHosts: ['vimeo.com', 'player.vimeo.com'], sandbox: VIDEO_SANDBOX, allow: VIDEO_ALLOW },
  { id: 'loom', name: 'Loom', kind: 'video', frameOrigins: ['https://www.loom.com'], linkHosts: ['loom.com'], sandbox: VIDEO_SANDBOX, allow: VIDEO_ALLOW },
  {
    id: 'figma',
    name: 'Figma',
    kind: 'document',
    frameOrigins: ['https://www.figma.com'],
    linkHosts: ['figma.com'],
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
    allow: 'fullscreen; clipboard-write',
  },
  {
    // Docs, Sheets, Slides and Forms: their own preview / published / embed views.
    id: 'google',
    name: 'Google',
    kind: 'document',
    frameOrigins: ['https://docs.google.com'],
    linkHosts: ['docs.google.com'],
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms',
    allow: 'fullscreen; clipboard-write',
  },
  {
    id: 'codepen',
    name: 'CodePen',
    kind: 'document',
    frameOrigins: ['https://codepen.io'],
    linkHosts: ['codepen.io'],
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms allow-modals',
    allow: 'clipboard-write',
  },
  {
    id: 'codesandbox',
    name: 'CodeSandbox',
    kind: 'document',
    frameOrigins: ['https://codesandbox.io'],
    linkHosts: ['codesandbox.io'],
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms allow-modals',
    allow: 'clipboard-write',
  },
];

/** Sandbox for pages on an operator's own allow-listed origin (`EMBED_EXTRA_ORIGINS`). */
export const OPERATOR_EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-forms';

/**
 * The provider a link is on (its host, without www. / m.), or 'operator' for an https link on one
 * of the operator's allow-listed origins; null for anything else. Hosts only: whether the link
 * plays live is the web app's parse; elsewhere it is a preview card.
 */
export function embedProviderForUrl(url: string, extraOrigins: readonly string[] = []): EmbedProvider | 'operator' | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  return EMBED_PROVIDERS.find((p) => p.linkHosts.includes(host)) ?? (extraOrigins.includes(u.origin) ? 'operator' : null);
}

/** Every origin a built-in provider is framed from (the CSP `frame-src`, before the operator's). */
export const EMBED_FRAME_ORIGINS: readonly string[] = [...new Set(EMBED_PROVIDERS.flatMap((p) => p.frameOrigins))];

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
// The role is the EFFECTIVE one: while a facilitator limits the board (FacilitationSession), the
// server re-sends it to everyone else with `limits` (a locked board makes them commenters), and
// again without when the limits end.
export const WS_MESSAGE_ROLE = 100;
export interface RoleMessage {
  type: 'role';
  role: Role;
  limits?: SessionLimits;
  /**
   * [additive, #89] Present when this connection READS the board's layers with another role than it
   * writes with: a live view in an AI assistant writes at most what its connection may (`role`)
   * but reads as the person — an owner / editor gets the editors layer (pending suggestions).
   */
  readRole?: Role;
  /**
   * [additive, parity rank 1] This commenter connection (a commenter, a guest, or someone a
   * facilitator's lock made a commenter) may take part while the board lets them
   * (participation.ts): write its own ballot, planning-poker pick and private-mode drafts. Sent
   * again whenever that changes. Clients that don't know it simply don't offer taking part.
   */
  participant?: boolean;
}
/** What a facilitator limits for this connection (enforced by the server, mirrored by the client). */
export interface SessionLimits {
  /** Who set them, for the explanation shown to the person limited. */
  byName: string;
  /** Board locked: the role was lowered to commenter for the session. */
  locked: boolean;
  /** Element types this connection may add (null: any). */
  addTypes: string[] | null;
}

// ---- Board layers (content the server withholds) ----
// Besides the shared doc, a board has server-held LAYER docs that only some connections may
// sync (see "Board layers" in ARCHITECTURE.md):
//   'private'  one per user: only that user's sockets read it; written while they may edit, or
//              as a participant (their ballot, pick and private-mode drafts only).
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
//   `anonymous: true` (reveal of 'elements', #44): the revealed drafts arrive with no author
//            (ANONYMOUS_AUTHOR, no app, reveal-time timestamps) and without the comment threads
//            on them (whose records name their writer: the author). Drafts written during an
//            anonymous session are revealed so whatever the op says.
// Only the private layers of people who may still edit the board — or take part as participants
// (RoleMessage.participant) — are revealed; the server holds
// the sender's later messages until the op is applied, so it stays in order with them.
export const WS_MESSAGE_LAYER_OP = 102;
export interface LayerOp {
  type: 'reveal' | 'discard';
  collection: string;
  prefix?: string;
  mine?: boolean;
  anonymous?: boolean;
}

// ---- Board outline (KAI-166): GET /api/boards/:id/outline ----
// The semantic read model of a board as the caller sees it (their role's layers applied).
// Query: format=json|markdown (default json), budget=<tokens>, limit=<items per page>,
// cursor=<meta.nextCursor>, scope=<item id>, authors=1, comments=0. ETag = outline `version`;
// If-None-Match answers 304 while nothing the caller can see changed. Markdown is served as
// text/markdown. Format reference: docs/board-outline.md. A machine-readable copy of the board, so
// the workspace's "downloads" policy applies: 403 { code: 'downloads_restricted' } (KAI-197).
export interface BoardOutlineResponse {
  outline: BoardOutline;
}

// ---- Insert structure (KAI-167): POST /api/boards/:id/insert-structure (owners, editors) ----
// The caller says what (StructureInput); the server lays it out and places it on free space.
export interface InsertStructureRequest {
  structure: StructureInput;
  /** Place it next to this element (in free space beside it). */
  near?: string;
  /** Or as close as free space allows to this board point (e.g. the viewport center). */
  at?: { x: number; y: number };
  /**
   * 'board' (default): written to the board now, one change (attributed to the caller, published
   * and saved). 'preview': laid out and placed but not written; the app can insert `snapshot`
   * itself with Editor.insertElements (one undo step) and apply `moves`. 'suggestions' (KAI-169):
   * proposed, not written: one group of suggestions people who can edit accept or reject
   * (`suggestion` carries the group's description).
   */
  target?: 'board' | 'preview' | 'suggestions';
  /** target 'suggestions': what the proposal does, shown to reviewers (at most 500 characters). */
  description?: string;
  /** [additive] Into something on the board, or into a new frame or kanban, instead of free space. */
  placement?: StructurePlacement;
}

/**
 * [additive] Where new (or moved) items go, by meaning — never coordinates (KAI-167). Give one:
 *   into      an existing frame, kanban or cluster: its id as the outline shows it (a frame's or a
 *             kanban's id, `cluster:<id>` or the id of any item in the cluster, or a kanban column's
 *             `<kanbanId>:<columnId>`). Items go below what is there (a frame or a kanban grows to
 *             hold them; a cluster takes them in).
 *   column    with `into` a kanban: the column, by its title or id. Without it each card goes to the
 *             column of its value for the field the kanban is grouped by (its `fields`), else of its
 *             status, else the first. A card dropped in a column with a status takes it.
 *   row       [additive] with `into` a kanban with swimlanes: the row, by its title or id (also
 *             `into: "<kanbanId>:<columnId>:<rowId>"`). Without it each card goes to the row of its
 *             value for the swimlane field, else the first (the "No <field>" row). A card takes its
 *             row's value.
 *   newFrame  a new frame with this title around everything added (on free space).
 *   newKanban a new kanban with this title and To do / Doing / Done columns, each card in the column
 *             of its status (sticky notes in To do).
 * Only sticky notes and cards go into a kanban column.
 */
export interface StructurePlacement {
  into?: string;
  column?: string;
  row?: string;
  newFrame?: string;
  newKanban?: string;
}
export interface InsertStructureResponse {
  target: 'board' | 'preview' | 'suggestions';
  /** target 'suggestions': the group the proposal became. */
  groupId?: string;
  /** Ids of the new elements (written, or in `snapshot`). */
  created: string[];
  /** Existing elements moved into the result (clusters of stickies already on the board). */
  moved: string[];
  /** [additive] Which element is which input item, in input order (`LaidOut.parts`). */
  parts?: Array<{ titleId?: string; ids: string[] }>;
  /** [additive] With `placement.newFrame` / `newKanban`: the container made. */
  containerId?: string;
  /** Where the result landed. */
  bounds: Rect;
  /** 'preview' only: an ElementsSnapshot (elements + content by element id) and the moves. */
  snapshot?: { elements: BoardElement[]; content: Record<string, TableCopyContent | ChartCopyContent> };
  moves?: Array<{ id: string; x: number; y: number }>;
}
// ---- AI (KAI-101 foundation, KAI-102 board actions; docs/ai.md) ----
// Off unless configured: with no instance provider (AI_PROVIDER) and workspace keys not allowed
// (AI_WORKSPACE_KEYS), every route below answers 404. A team workspace's admins turn AI on for it
// (Freero's provider, if the operator offers it to teams, or the workspace's own key); boards in
// personal workspaces use Freero's provider only when the operator allows it (AI_INSTANCE_FOR).
// Board text goes to the model as delimited, untrusted data; the model returns structure only
// (validated), which modules/structure lays out and places: never coordinates, never markup.
//
// GET  /api/boards/:id/ai                      -> { ai: BoardAiStatus | null }   (anyone who can open the board; null when AI is off on this instance)
// POST /api/boards/:id/ai/actions  body AiActionRequest -> AiActionResponse  (owners/editors the
//      workspace lets use AI; rate limited per user and per workspace; 429 code 'ai_budget' when the
//      month's token budget is used up; 403 code 'downloads_restricted' when the workspace's
//      downloads policy keeps this user from taking board content out, for actions that read it)
// GET   /api/workspaces/:id/admin/ai           -> WorkspaceAiAdmin        (owners/admins of a team)
// PATCH /api/workspaces/:id/admin/ai  body WorkspaceAiPatch -> WorkspaceAiAdmin
// POST  /api/workspaces/:id/admin/ai/test      -> { ok: true, model: string }  (one tiny call with the saved settings)
export type AiProviderKind = 'anthropic' | 'openai';
export const AI_PROVIDER_LABELS: Record<AiProviderKind, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI-compatible (OpenAI, Azure OpenAI, Ollama, vLLM, LM Studio …)',
};
/** Who in a team workspace may use AI on its boards (besides needing edit access to the board). */
export type AiAccess = 'everyone' | 'members' | 'admins';
/**
 * `report` [additive, #148]: a written report of a live activity's results (`ids`: the activity),
 * read from results everyone can already see (a sealed activity only once it is revealed).
 */
export type AiTask = 'ideas' | 'cluster' | 'summarize' | 'diagram' | 'report' | 'catchup' | 'expand';
/**
 * [additive, #134] `expand`: 3 to 7 new children for one mind-map topic (`ids`: that topic) — ideas,
 * questions or sub-topics — read from the topic, the path to it and what is under it already.
 * Nothing is placed: `AiActionResponse.children` is the text, which the app previews and adds
 * under the topic itself (one undo step).
 */
export type AiExpandKind = 'ideas' | 'questions' | 'subtopics';
export const AI_EXPAND = { min: 3, max: 7 } as const;
/**
 * [additive, #126] `catchup`: what OTHER people changed since the reader's last visit ('visit') or
 * in the last 7, 14 or 30 days — read from the change set only ("changes since your last visit",
 * as the reader may see the board now), shown to the reader alone (`AiActionResponse.catchUp`);
 * the note in the preview is inserted only if they choose to.
 */
export type AiCatchUpSince = 'visit' | 7 | 14 | 30;
export const AI_CATCH_UP_SINCE: readonly AiCatchUpSince[] = ['visit', 7, 14, 30];
/** What a catch-up says, each point citing the items (and frames) it is about. */
export interface AiCatchUp {
  /** From when (ms). */
  since: number;
  counts: CatchUpSummary['counts'];
  points: Array<{ text: string; ids: string[] }>;
  /** The cited items and frames, by id: `removed` ones can't be opened any more. */
  items: Record<string, { kind: string; text: string; frameId?: string; removed?: boolean }>;
}
/** [additive, #38] class, er, state (Mermaid), orgchart and kanban. */
export type AiDiagramKind = 'flowchart' | 'sequence' | 'mindmap' | 'class' | 'er' | 'state' | 'orgchart' | 'kanban';
/** [additive, #148] How `cluster` sorts: named themes (default), or sentiment groups (AI_SENTIMENTS). */
export type AiClusterBy = 'theme' | 'sentiment';
/** The groups a sentiment clustering uses, in this order (empty ones are left out). */
export const AI_SENTIMENTS = ['Positive', 'Neutral', 'Mixed', 'Negative'] as const;
/** Limits on one action (requests over them are refused; model output over them is clamped). */
export const AI_LIMITS = {
  /** Characters of the person's own instruction. */
  prompt: 2000,
  /** Selected items one action may read. */
  ids: 500,
  /** Stickies one "ideas" result may create. */
  ideas: 30,
  /** Clusters one "cluster" result may make. */
  clusters: 12,
} as const;

export interface BoardAiStatus {
  /** This user may run AI actions on this board right now. */
  available: boolean;
  /** Why not, in words fit for the UI (when `available` is false). */
  reason?: string;
  /** Where board content goes ("Anthropic (Claude) · claude-sonnet-5-5"), for the data notice. */
  provider?: string;
  /** Who configured it: Freero's operator ('instance') or the workspace's admins ('workspace'). */
  source?: 'instance' | 'workspace';
}

export interface AiActionRequest {
  task: AiTask;
  /** The person's instruction (required for ideas and diagram; optional focus for the others). */
  prompt?: string;
  /** Selected items the action reads (cluster: the stickies to sort; summarize / diagram: the source). */
  ids?: string[];
  /** diagram: what to draw (default flowchart). */
  diagram?: AiDiagramKind;
  /** [additive, #148] cluster: by theme (default) or by sentiment. */
  by?: AiClusterBy;
  /** [additive, #126] catchup: since the last visit (default) or the last 7, 14 or 30 days. */
  since?: AiCatchUpSince;
  /** [additive, #134] expand: what to add under the topic (default ideas). */
  expand?: AiExpandKind;
  /**
   * [additive, #148] summarize: put the result into this frame (free space inside it, else below
   * what is there: the app grows the frame when it inserts the preview) instead of beside it.
   */
  into?: string;
  /**
   * 'preview' (default): laid out and placed, not written. 'board': written now as one change.
   * 'suggestions' (KAI-169): proposed for people who can edit to accept ("AI for <Person>"). A
   * result that moves OTHER people's items (sorting their notes) is always proposed, whatever was
   * asked: the response's `target` says what happened.
   */
  target?: 'board' | 'preview' | 'suggestions';
  near?: string;
  at?: { x: number; y: number };
}
export interface AiActionResponse extends InsertStructureResponse {
  task: AiTask;
  /** What the model made, in words (the dialog shows it next to the picture). */
  summary: string;
  usage: { inputTokens: number; outputTokens: number };
  /** [additive, #126] catchup: the summary with its citations (the snapshot is the note to insert). */
  catchUp?: AiCatchUp;
  /** [additive, #134] expand: the new children's text, in order (nothing was placed: `created` is empty). */
  children?: string[];
}

export interface WorkspaceAiSettings {
  enabled: boolean;
  /** 'instance': Freero's provider (only if the operator offers it to teams); 'workspace': the workspace's own. */
  source: 'instance' | 'workspace';
  provider: AiProviderKind;
  /** Own endpoint (null: the provider's public API). */
  baseUrl: string | null;
  /** Own model id (null: the provider's default — required for OpenAI-compatible endpoints). */
  model: string | null;
  /** A key is stored (sealed at rest; it is never sent back). */
  hasKey: boolean;
  /** Tokens (input + output) the workspace may use per calendar month (UTC); null: no budget. */
  monthlyTokenBudget: number | null;
  access: AiAccess;
}
/** PATCH body: any settings plus `apiKey` (a new key; null removes the stored one). */
export type WorkspaceAiPatch = Partial<Omit<WorkspaceAiSettings, 'hasKey'>> & { apiKey?: string | null };
export interface AiUsageRow {
  userId: string;
  name: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}
export interface WorkspaceAiAdmin {
  settings: WorkspaceAiSettings;
  /** What the operator offers: Freero's provider for teams (with its label), own keys. */
  instance: { available: boolean; provider: string | null };
  workspaceKeysAllowed: boolean;
  /** This month (UTC, 'YYYY-MM'): totals and per person. */
  usage: { month: string; requests: number; inputTokens: number; outputTokens: number; byUser: AiUsageRow[] };
}

// ---- Reports and moderation (KAI-142) ----
// Anyone who can open a board — signed in or (with KAI-43) a visitor on its public link — can
// report the board, one item on it, an uploaded file shown on it, or a comment. Operators
// (OPERATOR_EMAILS, verified addresses only) review reports in a queue and act through the
// modules that own the data; every action is recorded and its subject told why, with an appeal link.
//
// POST /api/reports  body ReportRequest | ListingReportRequest -> 202 { ok: true }   (session optional; rate-limited per IP
//      and per user; 404 "Board not found" alike for unknown boards and boards you can't open)
// GET  /api/appeals/:token -> { appeal: AppealInfo }          (no session: the signed link from the notice)
// POST /api/appeals  body { token, message } -> 202 { ok: true } (one open appeal per action)
// Operators only (404 for everyone else):
// GET  /api/moderation/access -> { operator: boolean }        (any signed-in user)
// GET  /api/moderation/queue?status=open|closed -> { items: ModerationItem[] }
// GET  /api/moderation/boards/:id -> { board: ModeratedBoard, items: ModerationItem[], actions: ModerationActionRecord[] }
// GET  /api/moderation/boards/:id/preview -> the board's shared document (Yjs update, octet-stream)
// GET  /api/moderation/uploads/:name -> { upload: ModeratedUpload }
// GET  /api/moderation/users?email= -> { user: ModeratedUser }
// POST /api/moderation/actions body ModerationActionRequest -> { action: ModerationActionRecord }
// POST /api/moderation/items/:id/resolve body { outcome, note? } -> { item: ModerationItem }
// GET  /api/moderation/listings?status=pending|approved|rejected|removed -> { listings: ListingForReview[] } (#87, integrations.ts)
// GET  /.well-known/security.txt (RFC 9116, from SECURITY_CONTACT / ABUSE_CONTACT_EMAIL)
export type ReportReason = 'spam' | 'phishing' | 'malware' | 'harassment' | 'violence' | 'sexual' | 'illegal' | 'copyright' | 'other';
export const REPORT_REASONS: ReadonlyArray<{ id: ReportReason; label: string }> = [
  { id: 'spam', label: 'Spam or misleading ads' },
  { id: 'phishing', label: 'Phishing or a scam' },
  { id: 'malware', label: 'Malicious files or links' },
  { id: 'harassment', label: 'Harassment or hate' },
  { id: 'violence', label: 'Violence or threats' },
  { id: 'sexual', label: 'Sexual content' },
  { id: 'illegal', label: 'Other illegal content' },
  { id: 'copyright', label: 'Copyright or trademark' },
  { id: 'other', label: 'Something else' },
];
/**
 * What a report is about. `id`: element id ('element'), upload name ('upload', "<id>.<ext>"),
 * "<threadId>:<messageId>" ('comment'); none for the whole board.
 */
export type ReportTargetKind = 'board' | 'element' | 'upload' | 'comment';
export interface ReportTarget { kind: ReportTargetKind; id?: string }
export const MAX_REPORT_NOTE = 2000;
export interface ReportRequest {
  boardId: string;
  target: ReportTarget;
  reason: ReportReason;
  note?: string;
  /** Visitors without an account: where to send the outcome (optional). */
  contactEmail?: string;
}
/**
 * A report about a community listing of the Apps & agents page (#87): no board; signed in only (the
 * listings are). The same queue, reasons and outcome mail as a board report.
 */
export interface ListingReportRequest {
  target: { kind: 'listing'; id: string };
  reason: ReportReason;
  note?: string;
}

/** Operator actions. Each `restore` undoes the matching action; `upload.purge` deletes a removed file's kept copy for good. */
export type ModerationActionKind =
  | 'board.disable_link'
  | 'board.restore_link'
  | 'board.take_down'
  | 'board.restore'
  /** Deletes a taken-down board for good: ends its legal hold (KAI-178). */
  | 'board.delete'
  | 'upload.remove'
  | 'upload.restore'
  | 'upload.purge'
  | 'user.suspend'
  | 'user.restore'
  /** Community listings (#87): a pending submission is approved (live, "Community") or rejected; a live one removed (appealable) or restored; featured lists it first. */
  | 'listing.approve'
  | 'listing.reject'
  | 'listing.remove'
  | 'listing.restore'
  | 'listing.feature'
  | 'listing.unfeature';
export interface ModerationActionRequest {
  action: ModerationActionKind;
  /** Board id, upload name or user id, by the action's kind. */
  targetId: string;
  reason: ReportReason;
  /** Shown to the person affected (the statement of reasons in their notice). */
  statement: string;
  /** Operators only. */
  note?: string;
  /** The queue item this answers (marked actioned). */
  itemId?: string;
  /** For upload actions: the board the file was reported on (its owner is told too). */
  boardId?: string;
  /**
   * For 'user.suspend' (KAI-180): also take down, or turn off the link of, every board the account
   * owns. Each board is recorded as its own action; lifting the suspension undoes them all.
   */
  boards?: SuspensionBoards;
}
export type SuspensionBoards = 'take_down' | 'disable_link';
export interface ModerationActionRecord {
  id: string;
  action: ModerationActionKind;
  targetId: string;
  boardId: string | null;
  subjectUserId: string | null;
  /** Who it was about, as they were then (kept after their account is deleted, KAI-178). */
  subject: { name: string; email: string } | null;
  /** Null: Freero did it itself (a kept copy's retention ended), or the operator's account is gone. */
  operator: { id: string; name: string } | null;
  /** The action this one was part of (a board a suspension took down with it, KAI-180). */
  parentId: string | null;
  reason: ReportReason;
  statement: string;
  note: string;
  createdAt: number;
}
export type ModerationItemStatus = 'open' | 'actioned' | 'dismissed';
export interface ModerationItem {
  id: string;
  /** A report about content, or an appeal against an action. */
  kind: 'report' | 'appeal';
  status: ModerationItemStatus;
  boardId: string | null;
  boardTitle: string;
  /** What it is about (appeals against a suspension: the account, `user`; a community listing: `listing`). */
  target: { kind: ReportTargetKind | 'user' | 'listing'; id?: string };
  reason: ReportReason | null;
  /** The reporter's note, or the appeal's message. */
  message: string;
  reporter: { id: string; name: string; email: string } | null;
  contactEmail: string | null;
  /** Appeals: the action appealed against. */
  action: ModerationActionRecord | null;
  createdAt: number;
  resolvedAt: number | null;
  resolutionNote: string;
  /** Live state of the board right now (null when it no longer exists). */
  board: ModeratedBoard | null;
  /** A community listing it is about, as it is now (null when withdrawn or not about one). */
  listing: ModeratedListing | null;
}
export interface ModeratedListing {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  featured: boolean;
  website: string;
  submitter: ModeratedUser | null;
}
export interface ModeratedBoard {
  id: string;
  title: string;
  owner: ModeratedUser | null;
  linkAccess: LinkAccess;
  linkBlocked: boolean;
  removedAt: number | null;
  deletedAt: number | null;
  thumbnail: string | null;
}
export interface ModeratedUpload {
  name: string;
  url: string;
  owner: ModeratedUser | null;
  contentType: string | null;
  bytes: number | null;
  removedAt: number | null;
  /** A copy is kept while removed, so it can be restored (false after `upload.purge`). */
  restorable: boolean;
}
export interface ModeratedUser { id: string; name: string; email: string; suspended: boolean }
/** What an appeal link shows (no session needed). */
export interface AppealInfo {
  action: ModerationActionKind;
  reason: ReportReason;
  statement: string;
  boardTitle: string | null;
  createdAt: number;
  /** An appeal against it is already waiting for review. */
  pending: boolean;
  /** It was reversed meanwhile. */
  reversed: boolean;
}
/** `code` of a board Freero's moderators took down (HTTP 451 on REST). */
export const BOARD_REMOVED = 'board_removed';
/** Close code of board sockets when the board is taken down (on every instance). */
export const WS_CLOSE_BOARD_REMOVED = 4451;

export const SESSION_COOKIE = 'freero_session';
export const SERVER_PORT = 4000;

// ---- Audit log (KAI-48) ----
// An append-only record of security-relevant events. Each event lands in one or more CHAINS: the
// workspace it happened in ('w:<workspaceId>') and, for an account's own events (sign-ins,
// two-step verification, sessions…), the account ('u:<userId>') plus every team workspace the
// person is a member (not guest) of. Inside a chain events are numbered (`seq`) and hash-linked
// (`hash` = sha256 over the event and the previous event's hash), so an edited, removed or
// reordered row shows up when the chain is verified. Retention removes only the oldest events.
// Owners and admins of a team workspace read its log (see "Admin console"). An event of a workspace
// attached to an organisation also goes to the organisation's chain ('w:<organisationId>', its
// merged log, #108); `AuditEvent.workspaceId` is always the workspace it happened in.
export const AUDIT_ACTIONS = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'auth.session_revoked': 'Ended a session',
  'auth.sessions_revoked': 'Signed out other devices',
  'auth.session_expired': 'Session ended by policy',
  'auth.password_changed': 'Changed password',
  'auth.password_reset': 'Reset password',
  'auth.email_changed': 'Changed email address',
  'auth.email_change_reverted': 'Reverted an email change',
  'auth.two_factor_enabled': 'Turned on two-step verification',
  'auth.two_factor_disabled': 'Turned off two-step verification',
  'auth.recovery_codes_regenerated': 'Made new recovery codes',
  'auth.two_factor.undone': 'Two-step verification undone from the email link',
  'auth.two_factor.recovery_started': 'Started two-step recovery',
  'auth.two_factor.recovery_cancelled': 'Cancelled two-step recovery',
  'auth.two_factor.recovered': 'Two-step verification removed by recovery',
  'auth.two_factor.reset_by_operator': 'Two-step verification reset by a Freero operator',
  'auth.provider_connected': 'Connected a sign-in provider',
  'auth.provider_disconnected': 'Disconnected a sign-in provider',
  'account.deletion_scheduled': 'Scheduled account deletion',
  'account.deletion_cancelled': 'Cancelled account deletion',
  'account.deleted': 'Account deleted',
  'workspace.created': 'Created the workspace',
  'workspace.renamed': 'Renamed the workspace',
  'workspace.policies_changed': 'Changed sharing policies',
  'workspace.settings_changed': 'Changed security or retention settings',
  'workspace.transferred': 'Transferred workspace ownership',
  'workspace.owner_inherited': 'Became owner (previous owner deleted)',
  'workspace.deleted': 'Deleted the workspace',
  'organisation.created': 'Created the organisation',
  'organisation.deleted': 'Deleted the organisation',
  'organisation.workspace_attached': 'Attached a workspace to the organisation',
  'organisation.workspace_detached': 'Detached a workspace from the organisation',
  'organisation.member_added': 'Added someone to the organisation',
  'member.invited': 'Invited someone',
  'member.invite_revoked': 'Revoked an invite',
  'member.joined': 'Joined the workspace',
  'member.role_changed': 'Changed a member’s role',
  'member.admin_scopes_changed': 'Changed what an admin administers',
  'group.created': 'Created a group',
  'group.renamed': 'Renamed a group',
  'group.deleted': 'Deleted a group',
  'group.member_added': 'Added someone to a group',
  'group.member_removed': 'Removed someone from a group',
  'board.group_shared': 'Shared a board with a group',
  'board.group_unshared': 'Stopped sharing a board with a group',
  'project.group_added': 'Shared a project with a group',
  'project.group_removed': 'Stopped sharing a project with a group',
  'member.removed': 'Removed a member',
  'member.left': 'Left the workspace',
  'member.deactivated': 'Deactivated a member',
  'member.reactivated': 'Reactivated a member',
  'project.created': 'Created a project',
  'project.updated': 'Changed a project',
  'project.deleted': 'Deleted a project',
  'project.member_added': 'Added someone to a project',
  'project.member_removed': 'Removed someone from a project',
  'board.created': 'Created a board',
  'doc.created': 'Created a doc',
  'doc.exported': 'Exported a doc',
  'board.trashed': 'Moved a board to the trash',
  'board.restored': 'Restored a board from the trash',
  'board.archived': 'Archived a board',
  'board.unarchived': 'Unarchived a board',
  'board.retention_notice': 'Warned a board’s owner that a retention rule applies soon',
  'board.deleted': 'Deleted a board forever',
  'board.purged': 'Board purged after trash retention',
  'board.transferred': 'Transferred board ownership',
  'board.moved': 'Moved a board to another project',
  'board.moved_workspace': 'Moved a board to another workspace',
  'board.link_sharing_changed': 'Changed link sharing',
  'board.embedding_changed': 'Turned embedding on other sites on or off',
  'board.sharing_settings_changed': 'Changed who may share, copy or export a board',
  'board.duplicated': 'Duplicated a board',
  'board.exported': 'Exported a board',
  'board.backup_restored': 'Restored a board from a backup file',
  'board.download_refused': 'Was refused an export, copy or read of a board (downloads policy or the board’s setting)',
  'board.file_downloaded': 'Downloaded a file from a board',
  'board.member_invited': 'Shared a board',
  'board.member_role_changed': 'Changed someone’s board access',
  'board.member_removed': 'Removed someone from a board',
  'board.access_requested': 'Asked for access to a board',
  'board.access_approved': 'Let someone into a board (access request)',
  'board.access_declined': 'Declined a request for access to a board',
  'board.guest_joined': 'A visitor without an account joined a board by its link',
  'board.link_protection_changed': 'Changed a board link’s password or expiry',
  'board.link_password_refused': 'Gave a wrong password for a board’s link',
  'board.call_link_changed': 'Changed a board’s call link',
  'version.restored': 'Restored a board version',
  'decision.created': 'Froze a board or frame as a decision',
  'decision.deleted': 'Deleted a decision snapshot',
  'walkthrough.created': 'Recorded a walkthrough of a board',
  'walkthrough.deleted': 'Deleted a walkthrough',
  'walkthrough.transcribed': 'Had a walkthrough transcribed by AI',
  'board.suggestion_accepted': 'Accepted suggested changes on a board',
  'board.suggestion_rejected': 'Rejected suggested changes on a board',
  'board.suggestion_reopened': 'Undid accepting or rejecting suggested changes',
  'template.saved': 'Saved a board as a template',
  'stickers.set_removed': 'Removed a team sticker set',
  'template.published': 'Published a company template',
  'template.unpublished': 'Withdrew a company template',
  'template.locked': 'Locked a template',
  'template.unlocked': 'Unlocked a template',
  'template.retired': 'Retired a template',
  'template.unretired': 'Brought back a retired template',
  'audit.exported': 'Exported the audit log',
  // The public API (KAI-104) and agent safety (KAI-170): credentials, apps and every API call.
  'api.token_created': 'Created an API token',
  'api.token_paused': 'Paused an API token',
  'api.token_resumed': 'Resumed an API token',
  'api.token_revoked': 'Revoked an API token',
  'api.app_registered': 'Registered an OAuth app',
  'api.app_deleted': 'Deleted an OAuth app',
  'api.app_authorized': 'Authorised an app to act for them',
  'api.app_revoked': 'Revoked an app’s access',
  'api.access_changed': 'Turned API access for the workspace on or off',
  'api.credential_blocked': 'Blocked an API token or app in the workspace',
  'api.credential_unblocked': 'Unblocked an API token or app in the workspace',
  'api.credential_ip_exempted': 'Let an API token or app reach the workspace from any network',
  'api.credential_ip_unexempted': 'Put an API token or app back under the IP allowlist',
  'api.call': 'API call',
  // Freero's operators acting on reports (modules/moderation).
  'moderation.board.disable_link': 'Freero turned off a board’s link (moderation)',
  'moderation.board.restore_link': 'Freero turned a board’s link back on (moderation)',
  'moderation.board.take_down': 'Freero took a board down (moderation)',
  'moderation.board.restore': 'Freero restored a board (moderation)',
  'moderation.board.delete': 'Freero deleted a taken-down board for good (moderation)',
  'moderation.upload.remove': 'Freero removed a file (moderation)',
  'moderation.upload.restore': 'Freero restored a file (moderation)',
  'moderation.upload.purge': 'Freero purged a removed file (moderation)',
  'moderation.upload.download': 'A Freero operator downloaded a file to review it (moderation)',
  'problems.screenshot_viewed': 'A Freero operator looked at the screenshot of a problem you reported',
  'problems.updated': 'A Freero operator updated a problem you reported',
  'moderation.user.suspend': 'Freero suspended an account (moderation)',
  'moderation.user.restore': 'Freero lifted an account suspension (moderation)',
  'moderation.listing.approve': 'Freero approved a community listing (moderation)',
  'moderation.listing.reject': 'Freero declined a community listing (moderation)',
  'moderation.listing.remove': 'Freero removed a community listing (moderation)',
  'moderation.listing.restore': 'Freero restored a community listing (moderation)',
  'moderation.listing.feature': 'Freero featured a community listing (moderation)',
  'moderation.listing.unfeature': 'Freero stopped featuring a community listing (moderation)',
  // Single sign-on (modules/sso).
  'sso.domain_added': 'Added a domain for single sign-on',
  'sso.domain_verified': 'Verified a domain (DNS)',
  'sso.domain_removed': 'Removed a domain',
  'sso.connection_saved': 'Changed the identity provider',
  'sso.connection_removed': 'Removed the identity provider',
  'sso.enforced': 'Enforced single sign-on',
  'sso.unenforced': 'Stopped enforcing single sign-on',
  'sso.login': 'Signed in with single sign-on',
  'sso.login_refused': 'Single sign-on refused',
  'sso.member_provisioned': 'Joined through single sign-on (just in time)',
  // SAML service-provider keys and single logout (#13).
  'sso.sp_key_created': 'Created a SAML service-provider key',
  'sso.sp_key_rotated': 'Made a SAML service-provider key current',
  'sso.sp_key_removed': 'Removed a SAML service-provider key',
  'sso.logout': 'Signed out through single logout',
  'sso.logout_refused': 'Single logout refused',
  // Domain control (#64): accounts at a verified domain.
  'sso.domain_control_changed': 'Changed domain control',
  'sso.domain_capture_started': 'Told someone at a verified domain they will join the workspace',
  'sso.domain_capture_cancelled': 'Stopped someone at a verified domain from joining',
  'sso.domain_account_captured': 'Joined the workspace: account at a verified domain',
  'sso.workspace_creation_refused': 'Was refused a new team workspace (domain managed by this workspace)',
  // Provisioning (modules/scim).
  'scim.token_created': 'Created a provisioning token',
  'scim.token_rotated': 'Rotated a provisioning token',
  'scim.token_revoked': 'Revoked a provisioning token',
  'scim.user_provisioned': 'Directory provisioned someone',
  'scim.user_deprovisioned': 'Directory deactivated someone',
  'scim.user_reactivated': 'Directory reactivated someone',
  'scim.user_deleted': 'Directory deleted someone',
  'scim.group_mapped': 'Changed what a directory group grants',
  // Data exports (modules/privacy).
  'account.export_requested': 'Asked for a copy of their data',
  'account.export_downloaded': 'Downloaded a copy of their data',
  'workspace.export_requested': 'Asked for an export of the workspace',
  'workspace.export_downloaded': 'Downloaded an export of the workspace',
  // Legal holds and eDiscovery cases (modules/ediscovery, #157).
  'legal_hold.created': 'Placed a legal hold',
  'legal_hold.scope_changed': 'Changed what a legal hold covers',
  'legal_hold.released': 'Released a legal hold',
  'legal_hold.export_requested': 'Asked for an export of a legal case',
  'legal_hold.export_downloaded': 'Downloaded an export of a legal case',
  // Classification labels (#158).
  'label.created': 'Created a classification label',
  'label.updated': 'Changed a classification label',
  'label.deleted': 'Deleted a classification label',
  'board.label_changed': 'Changed a board’s classification label',
  // AI (modules/ai). Never the prompt or the board content: task, model, tokens and outcome only.
  'ai.request': 'Used AI on a board',
  'ai.settings_changed': 'Changed AI settings',
  // Webhooks (modules/webhooks). Never the secret.
  'webhook.created': 'Added a webhook',
  'webhook.updated': 'Changed a webhook',
  'webhook.secret_rotated': 'Rotated a webhook’s signing secret',
  'webhook.deleted': 'Removed a webhook',
  'webhook.disabled': 'A webhook was turned off after failing repeatedly',
  // Audit streaming to a SIEM (modules/siem, #17). Never the secret.
  'siem.sink_created': 'Started streaming the audit log to a SIEM',
  'siem.sink_updated': 'Changed an audit log stream',
  'siem.sink_deleted': 'Stopped streaming the audit log to a SIEM',
  // Issue-tracker sync (modules/trackers). Never credentials, never board text: issue keys, fields and outcomes.
  'tracker.connection_created': 'Connected an issue tracker',
  'tracker.connection_updated': 'Changed a tracker connection',
  'tracker.connection_removed': 'Removed a tracker connection',
  'tracker.webhook_secret_rotated': 'Made a new tracker webhook secret',
  'tracker.issue_created': 'Sent board items to a tracker as an issue',
  'tracker.issues_imported': 'Imported tracker issues onto a board',
  'tracker.synced': 'Synced a tracker issue',
  'tracker.sync_failed': 'A tracker sync failed',
  'tracker.unlinked': 'Unlinked a tracker issue',
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;
export type AuditValue = string | number | boolean | null | string[];
export type AuditMetadata = Record<string, AuditValue>;
export interface AuditEvent {
  /** Global, increasing id (a string: it is a 64-bit counter). */
  id: string;
  at: number;
  action: AuditAction;
  workspaceId: string | null;
  /** Who did it (null: Freero itself, e.g. a retention job, or someone not signed in). */
  actor: { id: string; name: string; email: string | null } | null;
  target: { type: string; id: string; label: string | null } | null;
  ip: string | null;
  userAgent: string | null;
  metadata: AuditMetadata;
  /** Position in its chain and the chain hashes (for checking an export independently). */
  chain: string;
  seq: number;
  prevHash: string;
  hash: string;
}
/** Result of re-checking a chain's hashes (GET …/audit/integrity). */
export interface AuditIntegrity {
  ok: boolean;
  /** Events checked (the whole chain as retention left it). */
  events: number;
  firstAt: number | null;
  lastAt: number | null;
  /** Hash of the newest event: write it down to prove later that nothing before it changed. */
  headHash: string | null;
  /** What is wrong, when not ok. */
  problem: string | null;
  /**
   * Signed checkpoints of the chain's head (#17): every hour the server signs the newest seq + hash
   * with its own secret; each one still in retention must match the stored event at that seq, so a
   * chain rewritten wholesale (head row included) shows. Streams to a SIEM carry the heads too.
   */
  anchors: { checked: number; lastAt: number | null };
}

// ---- Audit streaming to a SIEM (#17; team workspaces; owners/admins) ----
// GET    /api/workspaces/:id/admin/siem                     -> { sinks: SiemSinkInfo[] }
// POST   /api/workspaces/:id/admin/siem    body SiemSinkInput -> { sink, signingSecret? }  (https: the
//        signing secret, shown once)
// PATCH  /api/workspaces/:id/admin/siem/:sinkId body Partial<SiemSinkInput> -> { sink }  (a blank secret keeps the stored one)
// POST   /api/workspaces/:id/admin/siem/:sinkId/test        -> { sink }  (sends a test record now)
// DELETE /api/workspaces/:id/admin/siem/:sinkId             -> { ok }
// Each sink receives every event of the workspace's audit log in order (cursor: its chain `seq`),
// at least once, retried with backoff until it arrives; plus `freero.audit.head` checkpoints.
// Secrets (HEC token, client secret, bearer token, signing secret) are sealed and never sent back.
export type SiemKind = 'splunk' | 'sentinel' | 'https' | 'syslog';
export const SIEM_KINDS: readonly SiemKind[] = ['splunk', 'sentinel', 'https', 'syslog'];
export const SIEM_MAX_SINKS = 5;
export interface SiemSettings {
  /** splunk: the HTTP Event Collector's base URL (https://splunk.example.com:8088); https: the receiving URL. */
  url?: string;
  /** splunk */
  index?: string;
  sourcetype?: string;
  /** sentinel (Azure Monitor Logs Ingestion API) */
  endpoint?: string;
  dcrId?: string;
  stream?: string;
  tenantId?: string;
  clientId?: string;
  /** syslog over TLS (RFC 5425) */
  host?: string;
  port?: number;
  /** PEM of a private CA the syslog server's certificate is issued by (optional; public). */
  caCert?: string;
}
export interface SiemSinkInput {
  kind: SiemKind;
  name?: string;
  settings: SiemSettings;
  /** splunk: HEC token; sentinel: client secret; https: optional bearer token. Never returned. */
  secret?: string;
  enabled?: boolean;
}
export interface SiemSinkInfo {
  id: string;
  kind: SiemKind;
  name: string;
  /** Non-secret settings, as saved. */
  settings: SiemSettings;
  /** Where it goes, shortened (no secrets). */
  target: string;
  hasSecret: boolean;
  enabled: boolean;
  /** ok: delivering; failing: the last attempt failed (retrying); paused: turned off. */
  status: 'ok' | 'failing' | 'paused';
  /** The newest event `seq` delivered, and how far the log is. */
  deliveredSeq: number;
  headSeq: number;
  lastDeliveredAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextAttemptAt: number | null;
  createdAt: number;
}

// ---- Admin console (KAI-47) and workspace policies (KAI-51) ----
// Owners and admins of a TEAM workspace; every route re-checks the workspace role on the server,
// and (#151) the admin scope it needs: members (deactivate), content (link compliance, the
// trash/retention settings), security (the security settings, the audit log); usage, the member
// list and reading the settings need none. 403 `admin_scope_required` otherwise.
// GET   /api/workspaces/:id/admin/usage                 -> { usage: WorkspaceUsage }
// GET   /api/workspaces/:id/admin/usage/history?days=90 -> { days: UsageDay[] }  (#65; any admin; one
//       point per day the daily rollup ran, oldest first)
// GET   /api/workspaces/:id/admin/usage/history.csv?days=90 -> the same as CSV
// GET   /api/workspaces/:id/admin/members?q=           -> { members: AdminMember[] }
// POST  /api/workspaces/:id/admin/members/:userId/deactivate  -> { member: AdminMember }
// POST  /api/workspaces/:id/admin/members/:userId/reactivate  -> { member: AdminMember }
//       A deactivated member keeps their role and boards but opens nothing in the workspace (not
//       even boards they own) until reactivated; live connections are cut at once.
// GET   /api/workspaces/:id/admin/boards?filter=link,public,guests,outside,inactive,archived&inactiveDays=&q=
//       &sort=activity|title|owner|size|created|members&dir=asc|desc&offset=&limit=
//                                                        -> AdminBoardsResponse  (content; #152; every
//       board of the workspace, archived ones included; filters combine with AND)
// POST  /api/workspaces/:id/admin/boards/:boardId/link-off          -> { ok: true }  (content; audited)
// POST  /api/workspaces/:id/admin/boards/:boardId/remove-outsiders  -> { removed: number } (content;
//       ends the board memberships of people outside the workspace; each audited)
// POST  /api/workspaces/:id/admin/boards/:boardId/transfer  body { userId } -> { ok: true } (content; audited)
// GET   /api/workspaces/:id/admin/trash                  -> { boards: AdminTrashedBoard[] }  (content; #153)
// POST  /api/workspaces/:id/admin/trash/:boardId/restore -> { ok: true }  (content; audited, the owner's quota)
// GET   /api/workspaces/:id/admin/settings              -> { settings: WorkspaceSettings }
// PATCH /api/workspaces/:id/admin/settings  body Partial<WorkspaceSettings> & { confirmExcludesMe?: true } -> { settings }
//       (GET also answers `yourIp`: the address the server sees, for the IP allowlist, #156)
// GET   /api/workspaces/:id/audit?action=&actor=&target=&from=&to=&before=&limit=
//                                                       -> { events: AuditEvent[], next: string | null }
//       `action`: an action or a prefix ending in '.' ('auth.'); `before`: the `next` of the
//       previous page; from/to: epoch ms.
// GET   /api/workspaces/:id/audit/export?format=csv|json&(same filters) -> the file (recorded as
//       'audit.exported')
// GET   /api/workspaces/:id/audit/integrity             -> { integrity: AuditIntegrity }
// GET   /api/workspaces/:id/admin/link-compliance       -> { boards: LinkComplianceIssue[] }  (#39:
//       boards whose link is on but doesn't meet the link policy — links from before it keep working)
// POST  /api/boards/:id/exported  body { format }       -> { ok: true }  (the web app reports a
//       client-side export so it is audited; refused like the export itself when not allowed)
/** A board whose link is on but doesn't meet its workspace's link policy (#39). */
export interface LinkComplianceIssue {
  boardId: string;
  title: string;
  ownerName: string;
  linkAccess: LinkAccess;
  expiresAt: number | null;
  problems: Array<'no_password' | 'no_expiry' | 'expiry_too_late'>;
}
export interface WorkspaceSettings {
  /** Everyone opening the workspace's boards needs two-step verification on (members can't turn it off). */
  requireTwoFactor: boolean;
  /** A member's session ends this many hours after sign-in (null: Freero's default of 30 days). */
  sessionMaxHours: number | null;
  /** A member's session ends after this many minutes without activity (null: never). */
  sessionIdleMinutes: number | null;
  /** Days a deleted board stays in the trash before it is deleted for good. */
  trashRetentionDays: number;
  /** Unnamed versions older than this many days are deleted (null: kept, thinned out over time). */
  versionRetentionDays: number | null;
  /** Days audit events are kept. */
  auditRetentionDays: number;
  /**
   * [#154] What happens to a board nobody opened or changed for `inactiveBoardDays`: nothing,
   * archived (#153), or moved to the trash. Owners are emailed RETENTION_NOTICE_DAYS before, and
   * any activity (an edit, someone opening it, unarchiving) resets the clock. Archived boards are
   * never moved to the trash by it, nor are boards under a legal hold. An organisation's rule is a
   * floor for its workspaces: the stricter action (trash over archive) and the shorter period win.
   */
  inactiveBoardAction: InactiveBoardAction;
  /** [#154] Days without activity before the rule applies (null: no rule). */
  inactiveBoardDays: number | null;
  /**
   * [#156] The networks (IPv4 / IPv6 CIDR ranges, or single addresses) the workspace's boards open
   * from — REST, sockets and the API, as the client address reads behind the trusted proxy. Empty:
   * anywhere. An organisation's list applies to its workspaces as well (an address must be in both).
   * The admin console stays reachable from anywhere, so an owner can always fix a wrong list; SSO,
   * SCIM and sign-in are not limited by it. API tokens and apps can be exempted per workspace.
   */
  ipAllowlist: string[];
}
/** Error code (409): the IP allowlist being saved leaves out the address you are using; send `confirmExcludesMe: true` to save it anyway. */
export const IP_ALLOWLIST_EXCLUDES_YOU = 'ip_allowlist_excludes_you';
/** Error code (403): this network isn't on the workspace's IP allowlist (#156). */
export const IP_NOT_ALLOWED = 'ip_not_allowed';
export type InactiveBoardAction = 'none' | 'archive' | 'trash';
/** Loosest to strictest (#154; an organisation's floor). */
export const INACTIVE_BOARD_ACTIONS: readonly InactiveBoardAction[] = ['none', 'archive', 'trash'];
/** Owners hear this many days before a retention rule archives or trashes their board (#154). */
export const RETENTION_NOTICE_DAYS = 14;
export const WORKSPACE_SETTING_LIMITS = {
  sessionMaxHours: { min: 1, max: 24 * 90 },
  sessionIdleMinutes: { min: 15, max: 60 * 24 * 30 },
  trashRetentionDays: { min: 1, max: 365 },
  versionRetentionDays: { min: 7, max: 3650 },
  auditRetentionDays: { min: 30, max: 3650 },
  inactiveBoardDays: { min: 30, max: 3650 },
} as const;
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
/** Why the workspace's boards are closed to you right now (see WorkspaceSummary.blocked). */
export type WorkspaceBlock = 'deactivated' | 'two_factor_required' | 'ip_not_allowed';
export interface AdminMember extends WorkspaceMember {
  deactivated: boolean;
  twoFactor: boolean;
  /** Last time any of their sessions was active (null: no session right now). */
  lastActiveAt: number | null;
  /** Boards they own in this workspace (trash excluded). */
  boards: number;
}
/**
 * A board of the workspace as its content admins see it in the inventory (#152): metadata only —
 * opening the board still needs access to it.
 */
export interface AdminBoardRow {
  boardId: string;
  kind: ObjectKind;
  title: string;
  ownerId: string;
  ownerName: string;
  projectId: string | null;
  projectName: string | null;
  /** What its link gives anyone who has it (expired or blocked: 'none'). */
  linkAccess: LinkAccess;
  /** The link also lets in visitors without an account (the workspace allows it and it has no password). */
  publicLink: boolean;
  linkPassword: boolean;
  /** Direct memberships: everyone invited, of them the workspace's guests, and people outside the workspace. */
  members: number;
  guests: number;
  outsiders: number;
  /** Stored content (document, history, layers). */
  bytes: number;
  createdAt: number;
  /** The latest edit, rename or open. */
  lastActivityAt: number;
  archivedAt: number | null;
}
export type AdminBoardFilter = 'link' | 'public' | 'guests' | 'outside' | 'inactive' | 'archived';
export type AdminBoardSort = 'activity' | 'title' | 'owner' | 'size' | 'created' | 'members';
export interface AdminBoardsResponse {
  boards: AdminBoardRow[];
  /** How many match the filters (pages: `offset` + `limit`). */
  total: number;
}

/** A board in a workspace's trash as its content admins see it (#153): metadata only, never content. */
export interface AdminTrashedBoard {
  boardId: string;
  kind: ObjectKind;
  title: string;
  ownerId: string;
  ownerName: string;
  /** Who moved it to the trash (null: before #153, or a retention rule). */
  deletedBy: { id: string; name: string } | null;
  deletedAt: number;
  purgeAt: number;
}
/**
 * One day of a workspace's usage (#65), as the daily rollup recorded it: counts only, never who —
 * API / MCP calls by app come from the audit log, which already records them.
 */
export interface UsageDay {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  activeUsers7d: number;
  activeUsers30d: number;
  boardsCreated: number;
  docsCreated: number;
  members: number;
  guests: number;
  /** App or token name -> calls that day. */
  apiCalls: Record<string, number>;
}
export const USAGE_HISTORY_MAX_DAYS = 400;

export interface WorkspaceUsage {
  /** Live boards (archived ones not included). */
  boards: number;
  trashedBoards: number;
  /** [additive, #153] Archived boards (kept, read-only). */
  archivedBoards?: number;
  projects: number;
  members: Record<WorkspaceRole, number>;
  deactivated: number;
  pendingInvites: number;
  /** Distinct people who opened one of its boards in the last 7 / 30 days. */
  activeUsers7d: number;
  activeUsers30d: number;
  /** Stored board content (documents, history, layers) and the files its boards reference. */
  contentBytes: number;
  fileBytes: number;
}

/**
 * A person's own settings for one view of one board item (a kanban's board view): their personal
 * override of what the item saves for everyone. `settings` is opaque to the server.
 * GET /api/boards/:id/personal-views; PUT the same path with `{ itemId, viewId, settings | null }`.
 */
export interface PersonalViewEntry {
  itemId: string;
  viewId: string;
  settings: Record<string, unknown>;
}
export interface PersonalViewsResponse {
  views: PersonalViewEntry[];
}
