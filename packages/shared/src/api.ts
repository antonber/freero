// REST + WebSocket contract between apps/web and apps/server.
// All REST endpoints live under /api, send/receive JSON, and authenticate via
// an HttpOnly cookie named `freero_session`. Errors: { error: string } with a
// 4xx/5xx status. 401 = not logged in, 403 = no access, 404 = not found.

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
}

export interface BoardMember {
  userId: string;
  name: string;
  /** Only sent to people who can manage sharing (owner, editors) and for your own row. */
  email?: string;
  color: string;
  avatarUrl: string | null;
  role: Role;
}

// ---- Auth ----
// POST /api/auth/signup   body SignupRequest -> AuthResponse  (sets cookie)
// POST /api/auth/login    body LoginRequest  -> AuthResponse  (sets cookie)
// POST /api/auth/logout   -> { ok: true }                     (clears cookie)
// GET  /api/auth/session  -> SessionResponse (always 200; user null when signed out)
// GET  /api/auth/me       -> AuthResponse | 401
// PATCH /api/auth/me      body { name?, color?, avatarUrl? } -> AuthResponse
export interface SignupRequest { name: string; email: string; password: string }
export interface LoginRequest { email: string; password: string }
export interface AuthResponse { user: User }
export interface SessionResponse { user: User | null }

// ---- Boards ----
// GET    /api/boards?filter=all|mine|shared|starred|recent&q=text -> { boards: BoardSummary[] }
// POST   /api/boards               body CreateBoardRequest -> { board: BoardSummary }
// GET    /api/boards/:id           -> { board: BoardSummary }   (also records lastOpenedAt;
//                                     if the user has no membership but linkAccess != 'none',
//                                     returns the board with role = linkAccess)
// PATCH  /api/boards/:id           body UpdateBoardRequest -> { board: BoardSummary }  (owner/editor; linkAccess owner only)
// DELETE /api/boards/:id           -> { ok: true }  (owner only)
// POST   /api/boards/:id/duplicate -> { board: BoardSummary }  (copies the Yjs state)
// PUT    /api/boards/:id/star      -> { ok: true }
// DELETE /api/boards/:id/star      -> { ok: true }
// PUT    /api/boards/:id/thumbnail body { dataUrl: string } -> { ok: true } (editor+)
export interface CreateBoardRequest { title?: string; description?: string }
export interface UpdateBoardRequest { title?: string; description?: string; linkAccess?: LinkAccess }

// ---- Members / sharing ----
// GET    /api/boards/:id/members              -> { members: BoardMember[] }
// POST   /api/boards/:id/members  body InviteRequest -> { member: BoardMember }
//        (owner/editor; user must already have a Freero account, else 404 { error }; an editor
//        re-inviting an existing member with a different role gets 409: only the owner changes roles)
// PATCH  /api/boards/:id/members/:userId body { role } -> { member }   (owner only)
// DELETE /api/boards/:id/members/:userId -> { ok: true } (owner, or self to leave)
export interface InviteRequest { email: string; role: Exclude<Role, 'owner'> }

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
// their document updates are dropped; commenters may only modify 'comments'.
// Custom message (server -> client) sent right after connect so the client knows
// its effective role. Encoding (lib0): writeVarUint(WS_MESSAGE_ROLE) then
// writeVarString(JSON.stringify({ type: 'role', role })). Clients register it via
// y-websocket's `provider.messageHandlers[WS_MESSAGE_ROLE]`.
export const WS_MESSAGE_ROLE = 100;

export const SESSION_COOKIE = 'freero_session';
export const SERVER_PORT = 4000;
