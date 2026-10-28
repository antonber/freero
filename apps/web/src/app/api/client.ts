import type {
  AuthorizedApp,
  CreateTokenRequest,
  OAuthClientInfo,
  OAuthConsentInfo,
  PersonalToken,
  RegisterClientRequest,
  WorkspaceApiInfo,
  AdminMember,
  AuditEvent,
  AuditIntegrity,
  WorkspaceSettings,
  WorkspaceUsage,
  AcceptInviteResponse,
  ActivityResponse,
  GuestBoardInfo,
  GuestInfo,
  GuestJoinResponse,
  AccessRequestState,
  BoardAccessRequest,
  AppealInfo,
  ModeratedBoard,
  ModeratedUpload,
  ModeratedUser,
  ModerationActionRecord,
  ModerationActionRequest,
  ModerationItem,
  ReportRequest,
  AuthResponse,
  BoardMember,
  BoardPerson,
  BoardSummary,
  BoardVersion,
  CreateBoardRequest,
  DataExportInfo,
  ScimGroupMapping,
  ScimSettings,
  SsoConnectionInput,
  SsoDiscovery,
  SsoSettings,
  ImportImageRequest,
  InvitePreview,
  InviteRequest,
  InviteResponse,
  LoginRequest,
  LoginResponse,
  NotificationPrefs,
  NotificationsResponse,
  NotificationType,
  PendingInvite,
  Role,
  SavedTemplate,
  SavedTemplateSummary,
  SaveTemplateRequest,
  SecurityInfo,
  SessionInfo,
  SessionResponse,
  SignInProvider,
  SignupRequest,
  TwoFactorRecoveryStarted,
  TwoFactorSetup,
  UnfurlResponse,
  UpdateBoardRequest,
  User,
  ProjectAccess,
  ProjectSummary,
  WorkspaceInvite,
  WorkspaceInvitePreview,
  WorkspaceMember,
  WorkspacePolicies,
  TeamAccess,
  WorkspaceRole,
  WorkspaceSummary,
} from '@freero/shared';
import type { BacklinksResponse, ResolveObjectsResponse } from '@freero/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason, when the server sends one (e.g. ACCOUNT_PENDING_DELETION). */
    public code?: string,
  ) {
    super(message);
  }
}

async function failure(res: Response): Promise<ApiError> {
  let message = res.statusText;
  let code: string | undefined;
  try {
    const body = await res.json();
    message = body.error ?? message;
    code = typeof body.code === 'string' ? body.code : undefined;
  } catch {
    // non-JSON error body
  }
  return new ApiError(res.status, message, code);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
}

export type BoardFilter = 'all' | 'mine' | 'shared' | 'starred' | 'recent' | 'trash';

/** Audit log filters (see GET /api/workspaces/:id/audit). */
export interface AuditQuery {
  action?: string;
  actor?: string;
  from?: number;
  to?: number;
  before?: string;
  limit?: number;
}

function auditQuery(f: AuditQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export const api = {
  // auth
  me: () => request<AuthResponse>('GET', '/api/auth/me'),
  /** Startup check: `{ user: null }` when signed out (no failed request in the console). */
  session: () => request<SessionResponse>('GET', '/api/auth/session'),
  /** `{ twoFactorRequired }` when the account has two-factor on: finish with loginTwoFactor. */
  login: (body: LoginRequest) => request<LoginResponse>('POST', '/api/auth/login', body),
  loginTwoFactor: (code: string) => request<AuthResponse>('POST', '/api/auth/login/two-factor', { code }),
  signup: (body: SignupRequest) => request<AuthResponse>('POST', '/api/auth/signup', body),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  updateMe: (body: Partial<Pick<User, 'name' | 'color' | 'avatarUrl'>>) =>
    request<AuthResponse>('PATCH', '/api/auth/me', body),
  async uploadAvatar(file: Blob): Promise<AuthResponse> {
    const res = await fetch('/api/auth/me/avatar', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) throw await failure(res);
    return res.json();
  },
  removeAvatar: () => request<AuthResponse>('DELETE', '/api/auth/me/avatar'),

  // email + password
  resendVerification: () => request<{ ok: true }>('POST', '/api/auth/verify-email/send'),
  verifyEmail: (token: string) => request<{ ok: true }>('POST', '/api/auth/verify-email', { token }),
  forgotPassword: (email: string) => request<{ ok: true }>('POST', '/api/auth/password/forgot', { email }),
  resetPassword: (token: string, password: string) =>
    request<LoginResponse>('POST', '/api/auth/password/reset', { token, password }),
  /** Also sets the first password of an account without one (`currentPassword` is then ignored). */
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('POST', '/api/auth/password', { currentPassword, newPassword }),
  changeEmail: (email: string, password: string) => request<{ ok: true }>('POST', '/api/auth/email', { email, password }),
  confirmEmailChange: (token: string) => request<{ ok: true }>('POST', '/api/auth/email/confirm', { token }),
  /** "This wasn't me", from the link an email change sends to the previous address. */
  revertEmailChange: (token: string, password: string) =>
    request<LoginResponse>('POST', '/api/auth/email/revert', { token, password }),

  // sign-in methods + two-factor
  providers: () => request<{ providers: SignInProvider[] }>('GET', '/api/auth/providers'),
  security: () => request<SecurityInfo>('GET', '/api/auth/security'),
  disconnectIdentity: (id: string) => request<SecurityInfo>('DELETE', `/api/auth/identities/${encodeURIComponent(id)}`),
  setupTwoFactor: (password?: string) => request<TwoFactorSetup>('POST', '/api/auth/two-factor/setup', { password }),
  enableTwoFactor: (code: string) => request<{ recoveryCodes: string[] }>('POST', '/api/auth/two-factor/enable', { code }),
  disableTwoFactor: (code: string, password?: string) => request<{ ok: true }>('POST', '/api/auth/two-factor/disable', { code, password }),
  regenerateRecoveryCodes: (code: string, password?: string) =>
    request<{ recoveryCodes: string[] }>('POST', '/api/auth/two-factor/recovery-codes', { code, password }),
  /** "Lost access to your authenticator?" — from the pending sign-in (the second-step page). */
  startTwoFactorRecovery: () => request<TwoFactorRecoveryStarted>('POST', '/api/auth/login/two-factor/recovery'),
  finishTwoFactorRecovery: (token: string, password: string) =>
    request<LoginResponse>('POST', '/api/auth/two-factor/recovery/finish', { token, password }),
  cancelTwoFactorRecoveryByLink: (token: string) => request<{ ok: true }>('POST', '/api/auth/two-factor/recovery/cancel-link', { token }),
  cancelTwoFactorRecovery: () => request<SecurityInfo>('POST', '/api/auth/two-factor/recovery/cancel'),
  /** "This wasn't me", from the link in the two-step-on notice. */
  undoTwoFactor: (token: string, password: string) => request<LoginResponse>('POST', '/api/auth/two-factor/undo', { token, password }),

  // sessions
  listSessions: () => request<{ sessions: SessionInfo[] }>('GET', '/api/auth/sessions'),
  revokeSession: (id: string) => request<{ ok: true }>('DELETE', `/api/auth/sessions/${encodeURIComponent(id)}`),
  revokeOtherSessions: () => request<{ revoked: number }>('POST', '/api/auth/sessions/revoke-others'),

  // account deletion
  deleteAccount: (password: string) =>
    request<{ deletionScheduledFor: number }>('POST', '/api/auth/account/delete', { password }),
  restoreAccount: () => request<AuthResponse>('POST', '/api/auth/account/restore'),

  // invites (people without an account yet)
  listInvites: (boardId: string) => request<{ invites: PendingInvite[] }>('GET', `/api/boards/${boardId}/invites`),
  resendInvite: (boardId: string, inviteId: string) =>
    request<{ invite: PendingInvite }>('POST', `/api/boards/${boardId}/invites/${inviteId}/resend`),
  revokeInvite: (boardId: string, inviteId: string) =>
    request<{ ok: true }>('DELETE', `/api/boards/${boardId}/invites/${inviteId}`),
  previewInvite: (token: string) => request<{ invite: InvitePreview }>('GET', `/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string) => request<AcceptInviteResponse>('POST', `/api/invites/${encodeURIComponent(token)}/accept`),

  // boards
  /** Boards of the current workspace (`workspace`; default: your personal one), optionally of one project. */
  listBoards: (filter: BoardFilter = 'all', q = '', scope: { workspace?: string; project?: string } = {}) =>
    request<{ boards: BoardSummary[] }>(
      'GET',
      `/api/boards?filter=${filter}&q=${encodeURIComponent(q)}` +
        (scope.workspace ? `&workspace=${encodeURIComponent(scope.workspace)}` : '') +
        (scope.project ? `&project=${encodeURIComponent(scope.project)}` : ''),
    ),
  createBoard: (body: CreateBoardRequest = {}) =>
    request<{ board: BoardSummary }>('POST', '/api/boards', body),
  getBoard: (id: string) => request<{ board: BoardSummary }>('GET', `/api/boards/${id}`),
  updateBoard: (id: string, body: UpdateBoardRequest) =>
    request<{ board: BoardSummary }>('PATCH', `/api/boards/${id}`, body),
  /** Moves the board to its owner's trash (restorable for TRASH_RETENTION_DAYS). */
  deleteBoard: (id: string) => request<{ ok: true }>('DELETE', `/api/boards/${id}`),
  restoreBoard: (id: string) => request<{ board: BoardSummary }>('POST', `/api/boards/${id}/restore`),
  deleteBoardForever: (id: string) => request<{ ok: true }>('DELETE', `/api/boards/${id}/permanent`),
  duplicateBoard: (id: string) =>
    request<{ board: BoardSummary }>('POST', `/api/boards/${id}/duplicate`),
  /** Hands the board to `userId` (you keep editor access). */
  transferBoard: (id: string, userId: string) => request<{ board: BoardSummary }>('POST', `/api/boards/${id}/transfer`, { userId }),
  star: (id: string) => request<{ ok: true }>('PUT', `/api/boards/${id}/star`),
  unstar: (id: string) => request<{ ok: true }>('DELETE', `/api/boards/${id}/star`),
  putThumbnail: (id: string, dataUrl: string) =>
    request<{ ok: true }>('PUT', `/api/boards/${id}/thumbnail`, { dataUrl }),

  // members
  listMembers: (id: string) =>
    request<{ members: BoardMember[] }>('GET', `/api/boards/${id}/members`),
  invite: (id: string, body: InviteRequest) => request<InviteResponse>('POST', `/api/boards/${id}/members`, body),
  setMemberRole: (id: string, userId: string, role: Exclude<Role, 'owner'>) =>
    request<{ member: BoardMember }>('PATCH', `/api/boards/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) =>
    request<{ ok: true }>('DELETE', `/api/boards/${id}/members/${userId}`),
  boardPeople: (id: string, ids: string[]) =>
    request<{ people: BoardPerson[] }>('GET', `/api/boards/${id}/people?ids=${ids.map(encodeURIComponent).join(',')}`),

  // guests (visitors without an account on a shared link)
  guestBoardInfo: (id: string) => request<GuestBoardInfo>('GET', `/api/guest/boards/${encodeURIComponent(id)}`),
  joinAsGuest: (id: string, name: string) => request<GuestJoinResponse>('POST', `/api/guest/boards/${encodeURIComponent(id)}/join`, { name }),
  guestMe: () => request<{ guest: GuestInfo | null }>('GET', '/api/guest/me'),
  guestBoard: (id: string) => request<{ board: BoardSummary }>('GET', `/api/guest/boards/${encodeURIComponent(id)}/board`),
  leaveAsGuest: () => request<{ ok: true }>('POST', '/api/guest/leave'),

  // activity
  boardActivity: (id: string, before?: number) =>
    request<ActivityResponse>('GET', `/api/boards/${encodeURIComponent(id)}/activity${before ? `?before=${before}` : ''}`),
  workspaceActivity: (id: string, before?: number) =>
    request<ActivityResponse>('GET', `/api/workspaces/${encodeURIComponent(id)}/activity${before ? `?before=${before}` : ''}`),

  // access requests
  accessRequestState: (id: string) => request<AccessRequestState>('GET', `/api/boards/${encodeURIComponent(id)}/access-request`),
  requestAccess: (id: string, role: Exclude<Role, 'owner'>, message: string) =>
    request<AccessRequestState>('POST', `/api/boards/${encodeURIComponent(id)}/access-request`, { role, message }),
  withdrawAccessRequest: (id: string) => request<AccessRequestState>('DELETE', `/api/boards/${encodeURIComponent(id)}/access-request`),
  listAccessRequests: (id: string) => request<{ requests: BoardAccessRequest[] }>('GET', `/api/boards/${encodeURIComponent(id)}/access-requests`),
  decideAccessRequest: (id: string, userId: string, decision: 'approve' | 'deny', role?: Exclude<Role, 'owner'>) =>
    request<{ ok: true }>('POST', `/api/boards/${encodeURIComponent(id)}/access-requests/${encodeURIComponent(userId)}`, { decision, role }),

  // notifications
  listNotifications: (before?: number) =>
    request<NotificationsResponse>('GET', `/api/notifications${before ? `?before=${before}` : ''}`),
  markNotificationsRead: (ids?: string[]) => request<{ unread: number }>('POST', '/api/notifications/read', ids ? { ids } : {}),
  notificationPrefs: () => request<NotificationPrefs>('GET', '/api/notifications/prefs'),
  setNotificationPrefs: (body: { emailAll?: boolean; email?: Partial<Record<NotificationType, boolean>> }) =>
    request<NotificationPrefs>('PUT', '/api/notifications/prefs', body),
  unsubscribe: (token: string) =>
    request<{ ok: true; email: string }>('POST', `/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`),

  // saved templates
  listTemplates: () => request<{ templates: SavedTemplateSummary[] }>('GET', '/api/templates'),
  getTemplate: (id: string) => request<{ template: SavedTemplate }>('GET', `/api/templates/${encodeURIComponent(id)}`),
  saveTemplate: (body: SaveTemplateRequest) => request<{ template: SavedTemplateSummary }>('POST', '/api/templates', body),
  deleteTemplate: (id: string) => request<{ ok: true }>('DELETE', `/api/templates/${encodeURIComponent(id)}`),
  /** Shares one of your templates with a team workspace (null: personal again). */
  shareTemplate: (id: string, workspaceId: string | null) =>
    request<{ template: SavedTemplateSummary }>('PATCH', `/api/templates/${encodeURIComponent(id)}`, { workspaceId }),

  // workspaces
  listWorkspaces: () => request<{ workspaces: WorkspaceSummary[] }>('GET', '/api/workspaces'),
  createWorkspace: (name: string) => request<{ workspace: WorkspaceSummary }>('POST', '/api/workspaces', { name }),
  updateWorkspace: (id: string, body: { name?: string; policies?: Partial<WorkspacePolicies> }) =>
    request<{ workspace: WorkspaceSummary }>('PATCH', `/api/workspaces/${encodeURIComponent(id)}`, body),
  deleteWorkspace: (id: string, confirm: string) => request<{ ok: true }>('DELETE', `/api/workspaces/${encodeURIComponent(id)}`, { confirm }),
  transferWorkspace: (id: string, userId: string) =>
    request<{ workspace: WorkspaceSummary }>('POST', `/api/workspaces/${encodeURIComponent(id)}/transfer`, { userId }),
  listWorkspaceMembers: (id: string) =>
    request<{ members: WorkspaceMember[]; invites: WorkspaceInvite[] }>('GET', `/api/workspaces/${encodeURIComponent(id)}/members`),
  inviteToWorkspace: (id: string, email: string, role: Exclude<WorkspaceRole, 'owner'>) =>
    request<{ member?: WorkspaceMember; invite?: WorkspaceInvite }>('POST', `/api/workspaces/${encodeURIComponent(id)}/members`, { email, role }),
  setWorkspaceRole: (id: string, userId: string, role: WorkspaceRole) =>
    request<{ member: WorkspaceMember }>('PATCH', `/api/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { role }),
  removeWorkspaceMember: (id: string, userId: string) =>
    request<{ ok: true }>('DELETE', `/api/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`),
  resendWorkspaceInvite: (id: string, inviteId: string) =>
    request<{ invite: WorkspaceInvite }>('POST', `/api/workspaces/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}/resend`),
  revokeWorkspaceInvite: (id: string, inviteId: string) =>
    request<{ ok: true }>('DELETE', `/api/workspaces/${encodeURIComponent(id)}/invites/${encodeURIComponent(inviteId)}`),
  // single sign-on, provisioning, data exports (team workspaces: owners/admins)
  ssoSettings: (id: string) => request<SsoSettings>('GET', `/api/workspaces/${encodeURIComponent(id)}/sso`),
  addSsoDomain: (id: string, domain: string) => request<SsoSettings>('POST', `/api/workspaces/${encodeURIComponent(id)}/sso/domains`, { domain }),
  verifySsoDomain: (id: string, domainId: string) =>
    request<SsoSettings>('POST', `/api/workspaces/${encodeURIComponent(id)}/sso/domains/${encodeURIComponent(domainId)}/verify`),
  removeSsoDomain: (id: string, domainId: string) =>
    request<SsoSettings>('DELETE', `/api/workspaces/${encodeURIComponent(id)}/sso/domains/${encodeURIComponent(domainId)}`),
  saveSsoConnection: (id: string, body: SsoConnectionInput) => request<SsoSettings>('PUT', `/api/workspaces/${encodeURIComponent(id)}/sso/connection`, body),
  removeSsoConnection: (id: string) => request<SsoSettings>('DELETE', `/api/workspaces/${encodeURIComponent(id)}/sso/connection`),
  enforceSso: (id: string, enforced: boolean, breakGlassUserId: string | null) =>
    request<SsoSettings & { sessionsEnded: number }>('POST', `/api/workspaces/${encodeURIComponent(id)}/sso/enforce`, { enforced, breakGlassUserId }),
  discoverSso: (email: string, next: string) =>
    request<SsoDiscovery>('GET', `/api/sso/discover?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`),
  scimSettings: (id: string) => request<ScimSettings>('GET', `/api/workspaces/${encodeURIComponent(id)}/scim`),
  createScimToken: (id: string, label: string) =>
    request<{ token: string; settings: ScimSettings }>('POST', `/api/workspaces/${encodeURIComponent(id)}/scim/tokens`, { label }),
  rotateScimToken: (id: string, tokenId: string) =>
    request<{ token: string; settings: ScimSettings }>('POST', `/api/workspaces/${encodeURIComponent(id)}/scim/tokens/${encodeURIComponent(tokenId)}/rotate`),
  revokeScimToken: (id: string, tokenId: string) =>
    request<ScimSettings>('DELETE', `/api/workspaces/${encodeURIComponent(id)}/scim/tokens/${encodeURIComponent(tokenId)}`),
  mapScimGroup: (id: string, groupId: string, mapping: ScimGroupMapping | null) =>
    request<ScimSettings>('PUT', `/api/workspaces/${encodeURIComponent(id)}/scim/groups/${encodeURIComponent(groupId)}`, { mapping }),
  requestMyExport: () => request<{ export: DataExportInfo }>('POST', '/api/me/exports'),
  myExports: () => request<{ exports: DataExportInfo[] }>('GET', '/api/me/exports'),
  requestWorkspaceExport: (id: string) => request<{ export: DataExportInfo }>('POST', `/api/workspaces/${encodeURIComponent(id)}/exports`),
  workspaceExports: (id: string) => request<{ exports: DataExportInfo[] }>('GET', `/api/workspaces/${encodeURIComponent(id)}/exports`),
  previewWorkspaceInvite: (token: string) =>
    request<{ invite: WorkspaceInvitePreview }>('GET', `/api/workspace-invites/${encodeURIComponent(token)}`),
  acceptWorkspaceInvite: (token: string) =>
    request<{ workspaceId: string }>('POST', `/api/workspace-invites/${encodeURIComponent(token)}/accept`),

  // admin console (owners/admins of a team workspace; checked by the server)
  adminUsage: (id: string) => request<{ usage: WorkspaceUsage }>('GET', `/api/workspaces/${encodeURIComponent(id)}/admin/usage`),
  adminMembers: (id: string, q = '') =>
    request<{ members: AdminMember[] }>('GET', `/api/workspaces/${encodeURIComponent(id)}/admin/members${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  setMemberDeactivated: (id: string, userId: string, deactivated: boolean) =>
    request<{ member: AdminMember }>(
      'POST',
      `/api/workspaces/${encodeURIComponent(id)}/admin/members/${encodeURIComponent(userId)}/${deactivated ? 'deactivate' : 'reactivate'}`,
    ),
  workspaceSettings: (id: string) => request<{ settings: WorkspaceSettings }>('GET', `/api/workspaces/${encodeURIComponent(id)}/admin/settings`),
  updateWorkspaceSettings: (id: string, patch: Partial<WorkspaceSettings>) =>
    request<{ settings: WorkspaceSettings }>('PATCH', `/api/workspaces/${encodeURIComponent(id)}/admin/settings`, patch),
  auditEvents: (id: string, filter: AuditQuery) =>
    request<{ events: AuditEvent[]; next: string | null }>('GET', `/api/workspaces/${encodeURIComponent(id)}/audit?${auditQuery(filter)}`),
  /** A same-origin URL that downloads the filtered log (the browser handles the file). */
  auditExportUrl: (id: string, format: 'csv' | 'json', filter: AuditQuery) =>
    `/api/workspaces/${encodeURIComponent(id)}/audit/export?format=${format}&${auditQuery({ ...filter, before: undefined, limit: undefined })}`,
  auditIntegrity: (id: string) => request<{ integrity: AuditIntegrity }>('GET', `/api/workspaces/${encodeURIComponent(id)}/audit/integrity`),
  /** Tells the server a board was exported in the browser (audit log; refused when the workspace forbids exports). */
  reportBoardExport: (boardId: string, format: string) =>
    request<{ ok: true }>('POST', `/api/boards/${encodeURIComponent(boardId)}/exported`, { format }),

  // projects (folders)
  listProjects: (workspaceId: string) =>
    request<{ projects: ProjectSummary[] }>('GET', `/api/workspaces/${encodeURIComponent(workspaceId)}/projects`),
  createProject: (workspaceId: string, name: string, access: ProjectAccess, teamAccess: TeamAccess | null = null) =>
    request<{ project: ProjectSummary }>('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/projects`, { name, access, teamAccess }),
  updateProject: (id: string, body: { name?: string; access?: ProjectAccess; teamAccess?: TeamAccess | null }) =>
    request<{ project: ProjectSummary }>('PATCH', `/api/projects/${encodeURIComponent(id)}`, body),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', `/api/projects/${encodeURIComponent(id)}`),
  listProjectMembers: (id: string) =>
    request<{ members: Array<{ userId: string; name: string; color: string; avatarUrl: string | null }> }>(
      'GET',
      `/api/projects/${encodeURIComponent(id)}/members`,
    ),
  addProjectMember: (id: string, userId: string) =>
    request<{ ok: true }>('PUT', `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`),
  removeProjectMember: (id: string, userId: string) =>
    request<{ ok: true }>('DELETE', `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`),

  // version history (editors and owners)
  listVersions: (boardId: string) => request<{ versions: BoardVersion[] }>('GET', `/api/boards/${boardId}/versions`),
  async versionState(boardId: string, versionId: number): Promise<Uint8Array> {
    const res = await fetch(`/api/boards/${boardId}/versions/${versionId}/state`, { credentials: 'same-origin' });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = (await res.json()).error ?? message;
      } catch {
        // non-JSON error body
      }
      throw new ApiError(res.status, message);
    }
    return new Uint8Array(await res.arrayBuffer());
  },
  nameVersion: (boardId: string, name: string) =>
    request<{ version: BoardVersion }>('POST', `/api/boards/${boardId}/versions`, { name }),
  renameVersion: (boardId: string, versionId: number, name: string) =>
    request<{ version: BoardVersion }>('PATCH', `/api/boards/${boardId}/versions/${versionId}`, { name }),
  restoreVersion: (boardId: string, versionId: number) =>
    request<{ before: BoardVersion }>('POST', `/api/boards/${boardId}/versions/${versionId}/restore`),

  // reports and moderation (KAI-142)
  report: (body: ReportRequest) => request<{ ok: true }>('POST', '/api/reports', body),
  appeal: (token: string) => request<{ appeal: AppealInfo }>('GET', `/api/appeals/${encodeURIComponent(token)}`),
  submitAppeal: (token: string, message: string) => request<{ ok: true }>('POST', '/api/appeals', { token, message }),
  moderationAccess: () => request<{ operator: boolean }>('GET', '/api/moderation/access'),
  moderationQueue: (status: 'open' | 'closed') => request<{ items: ModerationItem[] }>('GET', `/api/moderation/queue?status=${status}`),
  moderationBoard: (id: string) =>
    request<{ board: ModeratedBoard; items: ModerationItem[]; actions: ModerationActionRecord[] }>(
      'GET',
      `/api/moderation/boards/${encodeURIComponent(id)}`,
    ),
  async moderationPreview(id: string): Promise<Uint8Array> {
    const res = await fetch(`/api/moderation/boards/${encodeURIComponent(id)}/preview`, { credentials: 'same-origin' });
    if (!res.ok) throw await failure(res);
    return new Uint8Array(await res.arrayBuffer());
  },
  moderationUpload: (name: string) => request<{ upload: ModeratedUpload }>('GET', `/api/moderation/uploads/${encodeURIComponent(name)}`),
  moderationUser: (email: string) => request<{ user: ModeratedUser }>('GET', `/api/moderation/users?email=${encodeURIComponent(email)}`),
  moderate: (body: ModerationActionRequest) => request<{ action: ModerationActionRecord }>('POST', '/api/moderation/actions', body),
  resolveModerationItem: (id: string, outcome: 'actioned' | 'dismissed', note: string) =>
    request<{ item: ModerationItem }>('POST', `/api/moderation/items/${encodeURIComponent(id)}/resolve`, { outcome, note }),

  // object addresses (KAI-149): permission-checked summaries, and what links here
  resolveObjects: (uris: string[]) => request<ResolveObjectsResponse>('POST', '/api/objects/resolve', { uris }),
  backlinks: (uri: string) => request<BacklinksResponse>('GET', `/api/objects/backlinks?uri=${encodeURIComponent(uri)}`),

  // link previews
  unfurl:(url: string) => request<UnfurlResponse>('GET', `/api/unfurl?url=${encodeURIComponent(url)}`),

  // images placed by URL (fetched by the server: works for hosts without CORS)
  importImage: (url: string) => request<{ url: string }>('POST', '/api/unfurl/image', { url } satisfies ImportImageRequest),
  async fetchImage(url: string): Promise<Blob> {
    const res = await fetch(`/api/unfurl/image?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'Image could not be fetched');
    return res.blob();
  },

  // uploads (images, PDF documents, video and audio; the server checks type, size and quota)
  uploadImage: (file: Blob) => upload('/api/uploads', file, file.type || 'application/octet-stream'),
  // any other file: an opaque attachment, only ever downloaded from its board
  uploadAttachment: (file: Blob) => upload('/api/uploads?as=attachment', file, 'application/octet-stream'),
  /** The file of a file card / video / audio item on a board (downloads policy, audited). */
  async downloadBoardFile(boardId: string, elementId: string): Promise<Blob> {
    const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/files/${encodeURIComponent(elementId)}`, { credentials: 'same-origin' });
    if (!res.ok) throw await failure(res);
    return res.blob();
  },

  // ---- public API credentials (KAI-104): tokens, authorised apps, registered apps, consent ----
  listApiTokens: () => request<{ tokens: PersonalToken[] }>('GET', '/api/auth/tokens'),
  createApiToken: (body: CreateTokenRequest) => request<{ token: PersonalToken; secret: string }>('POST', '/api/auth/tokens', body),
  pauseApiToken: (id: string, paused: boolean) => request<{ token: PersonalToken }>('PATCH', `/api/auth/tokens/${encodeURIComponent(id)}`, { paused }),
  revokeApiToken: (id: string) => request<{ ok: true }>('DELETE', `/api/auth/tokens/${encodeURIComponent(id)}`),
  listAuthorizedApps: () => request<{ apps: AuthorizedApp[] }>('GET', '/api/auth/apps'),
  revokeAuthorizedApp: (clientId: string) => request<{ ok: true }>('DELETE', `/api/auth/apps/${encodeURIComponent(clientId)}`),
  revokeAllApiAccess: () => request<{ tokens: number; apps: number }>('POST', '/api/auth/api-access/revoke-all'),
  listOAuthClients: () => request<{ clients: OAuthClientInfo[] }>('GET', '/api/oauth/clients'),
  registerOAuthClient: (body: RegisterClientRequest) => request<{ client: OAuthClientInfo; clientSecret?: string }>('POST', '/api/oauth/clients', body),
  deleteOAuthClient: (id: string) => request<{ ok: true }>('DELETE', `/api/oauth/clients/${encodeURIComponent(id)}`),
  /** The authorization request as the app sent it (the consent page's query string). */
  oauthConsent: (query: string) => request<{ consent: OAuthConsentInfo } | { redirect: string }>('GET', `/api/oauth/authorize?${query}`),
  oauthDecide: (params: Record<string, string>, decision: 'allow' | 'deny') =>
    request<{ redirect: string }>('POST', '/api/oauth/authorize', { ...params, decision }),
  workspaceApi: (id: string) => request<WorkspaceApiInfo>('GET', `/api/workspaces/${encodeURIComponent(id)}/admin/api`),
  setWorkspaceApi: (id: string, enabled: boolean) => request<WorkspaceApiInfo>('PATCH', `/api/workspaces/${encodeURIComponent(id)}/admin/api`, { enabled }),
  setWorkspaceCredentialBlocked: (id: string, credentialId: string, blocked: boolean) =>
    request<WorkspaceApiInfo>(
      blocked ? 'POST' : 'DELETE',
      `/api/workspaces/${encodeURIComponent(id)}/admin/api/credentials/${encodeURIComponent(credentialId)}/block`,
    ),
};

async function upload(path: string, file: Blob, type: string): Promise<{ url: string }> {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': type }, body: file });
  if (!res.ok) {
    // The server's message says why (too large, quota reached, wrong type).
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error || 'Upload failed');
  }
  return res.json();
}

/**
 * Where to send the browser to sign in with a provider (a full navigation, not a fetch): `login`,
 * `link` (connect it to the signed-in account) or `reauth` (confirm it's you, passwordless accounts).
 */
export function providerUrl(provider: string, intent: 'login' | 'link' | 'reauth', next?: string): string {
  const q = new URLSearchParams({ intent });
  if (next) q.set('next', next);
  return `/api/auth/oidc/${encodeURIComponent(provider)}/start?${q}`;
}

/** Base URL for WebSocket connections (same origin; Vite proxies /ws in dev). */
export function wsBase(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}
