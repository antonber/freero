// The token a board embedded on another site (#2) signed in with, kept per board until it expires
// in this frame's storage — which browsers partition by the site that frames it, so another site
// embedding the same board never sees it. Storage can be unavailable (private windows, blocked
// site data): the embed then asks to sign in again after a reload.
const key = (boardId: string) => `freero:embed-token:${boardId}`;

export function readEmbedToken(boardId: string, now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(key(boardId));
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (typeof token === 'string' && typeof expiresAt === 'number' && expiresAt > now) return token;
    localStorage.removeItem(key(boardId));
  } catch {
    /* unavailable or unreadable: sign in again */
  }
  return null;
}

export function saveEmbedToken(boardId: string, token: string, expiresAt: number): void {
  try {
    localStorage.setItem(key(boardId), JSON.stringify({ token, expiresAt }));
  } catch {
    /* kept for this page only */
  }
}

export function forgetEmbedToken(boardId: string): void {
  try {
    localStorage.removeItem(key(boardId));
  } catch {
    /* nothing kept */
  }
}
