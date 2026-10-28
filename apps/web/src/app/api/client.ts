import type {
  AcceptInviteResponse,
  AuthResponse,
  BoardMember,
  BoardSummary,
  CreateBoardRequest,
  InvitePreview,
  InviteRequest,
  InviteResponse,
  LoginRequest,
  PendingInvite,
  Role,
  SavedTemplate,
  SavedTemplateSummary,
  SaveTemplateRequest,
  SessionInfo,
  SessionResponse,
  SignupRequest,
  UnfurlResponse,
  UpdateBoardRequest,
  User,
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

export const api = {
  // auth
  me: () => request<AuthResponse>('GET', '/api/auth/me'),
  /** Startup check: `{ user: null }` when signed out (no failed request in the console). */
  session: () => request<SessionResponse>('GET', '/api/auth/session'),
  login: (body: LoginRequest) => request<AuthResponse>('POST', '/api/auth/login', body),
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
    request<AuthResponse>('POST', '/api/auth/password/reset', { token, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('POST', '/api/auth/password', { currentPassword, newPassword }),
  changeEmail: (email: string, password: string) => request<{ ok: true }>('POST', '/api/auth/email', { email, password }),
  confirmEmailChange: (token: string) => request<{ ok: true }>('POST', '/api/auth/email/confirm', { token }),

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
  listBoards: (filter: BoardFilter = 'all', q = '') =>
    request<{ boards: BoardSummary[] }>(
      'GET',
      `/api/boards?filter=${filter}&q=${encodeURIComponent(q)}`,
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

  // saved templates
  listTemplates: () => request<{ templates: SavedTemplateSummary[] }>('GET', '/api/templates'),
  getTemplate: (id: string) => request<{ template: SavedTemplate }>('GET', `/api/templates/${encodeURIComponent(id)}`),
  saveTemplate: (body: SaveTemplateRequest) => request<{ template: SavedTemplateSummary }>('POST', '/api/templates', body),
  deleteTemplate: (id: string) => request<{ ok: true }>('DELETE', `/api/templates/${encodeURIComponent(id)}`),

  // link previews
  unfurl: (url: string) => request<UnfurlResponse>('GET', `/api/unfurl?url=${encodeURIComponent(url)}`),

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

/** Base URL for WebSocket connections (same origin; Vite proxies /ws in dev). */
export function wsBase(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}
