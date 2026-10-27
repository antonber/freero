import type {
  AuthResponse,
  BoardMember,
  BoardSummary,
  CreateBoardRequest,
  InviteRequest,
  LoginRequest,
  Role,
  SignupRequest,
  UpdateBoardRequest,
  User,
} from '@freero/shared';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export type BoardFilter = 'all' | 'mine' | 'shared' | 'starred' | 'recent';

export const api = {
  // auth
  me: () => request<AuthResponse>('GET', '/api/auth/me'),
  login: (body: LoginRequest) => request<AuthResponse>('POST', '/api/auth/login', body),
  signup: (body: SignupRequest) => request<AuthResponse>('POST', '/api/auth/signup', body),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  updateMe: (body: Partial<Pick<User, 'name' | 'color' | 'avatarUrl'>>) =>
    request<AuthResponse>('PATCH', '/api/auth/me', body),

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
  deleteBoard: (id: string) => request<{ ok: true }>('DELETE', `/api/boards/${id}`),
  duplicateBoard: (id: string) =>
    request<{ board: BoardSummary }>('POST', `/api/boards/${id}/duplicate`),
  star: (id: string) => request<{ ok: true }>('PUT', `/api/boards/${id}/star`),
  unstar: (id: string) => request<{ ok: true }>('DELETE', `/api/boards/${id}/star`),
  putThumbnail: (id: string, dataUrl: string) =>
    request<{ ok: true }>('PUT', `/api/boards/${id}/thumbnail`, { dataUrl }),

  // members
  listMembers: (id: string) =>
    request<{ members: BoardMember[] }>('GET', `/api/boards/${id}/members`),
  invite: (id: string, body: InviteRequest) =>
    request<{ member: BoardMember }>('POST', `/api/boards/${id}/members`, body),
  setMemberRole: (id: string, userId: string, role: Exclude<Role, 'owner'>) =>
    request<{ member: BoardMember }>('PATCH', `/api/boards/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) =>
    request<{ ok: true }>('DELETE', `/api/boards/${id}/members/${userId}`),

  // uploads
  async uploadImage(file: Blob): Promise<{ url: string }> {
    const res = await fetch('/api/uploads', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) throw new ApiError(res.status, 'Upload failed');
    return res.json();
  },
};

/** Base URL for WebSocket connections (same origin; Vite proxies /ws in dev). */
export function wsBase(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}
