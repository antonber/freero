import type {
  AdminMember,
  AuditEvent,
  AuditIntegrity,
  WorkspaceSettings,
  WorkspaceUsage,
  AcceptInviteResponse,
  AuthResponse,
  BoardMember,
  BoardPerson,
  BoardSummary,
  BoardVersion,
  CreateBoardRequest,
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
  WorkspaceRole,
  WorkspaceSummary,
} from '@freero/shared';

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
  createProject: (workspaceId: string, name: string, access: ProjectAccess) =>
    request<{ project: ProjectSummary }>('POST', `/api/workspaces/${encodeURIComponent(workspaceId)}/projects`, { name, access }),
  updateProject: (id: string, body: { name?: string; access?: ProjectAccess }) =>
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

  // link previews
  unfurl:(url: string) => request<UnfurlResponse>('GET', `/api/unfurl?url=${encodeURIComponent(url)}`),

  // images placed by URL (fetched by the server: works for hosts without CORS)
  importImage: (url: string) => request<{ url: string }>('POST', '/api/unfurl/image', { url } satisfies ImportImageRequest),
  async fetchImage(url: string): Promise<Blob> {
    const res = await fetch(`/api/unfurl/image?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'Image could not be fetched');
    return res.blob();
  },

  // uploads (images and PDF documents; the server checks type, size and quota)
  async uploadImage(file: Blob): Promise<{ url: string }> {
    const res = await fetch('/api/uploads', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) {
      // The server's message says why (too large, quota reached, wrong type).
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(res.status, body?.error || 'Upload failed');
    }
    return res.json();
  },
};

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
