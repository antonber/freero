// What was shared into the installed app (KAI-218), on its way from the /share page to the board
// the person picked. The board takes it once through Host.takeShared (features/share places it),
// so neither a later navigation nor a reload places it twice.
import type { SharedContent } from '@engine';

let pending: { boardId: string; content: SharedContent } | null = null;

export function holdShare(boardId: string, content: SharedContent): void {
  pending = { boardId, content };
}

/** The content waiting for `boardId`, once. */
export function takeShare(boardId: string): SharedContent | null {
  if (!pending || pending.boardId !== boardId) return null;
  const c = pending.content;
  pending = null;
  return c;
}

const NAME_RE = /^[A-Za-z0-9_-]{6,64}\.(png|jpg|gif|webp|svg)$/;

/** The shared content the server's share target put in the /share URL (only what it may hold). */
export function sharedFromQuery(q: URLSearchParams): SharedContent & { failed: number } {
  const clip = (v: string | null) => (v && v.trim() ? v.trim().slice(0, 2000) : null);
  const url = clip(q.get('url'));
  const text = clip(q.get('text'));
  // Android puts a shared page's address in `text` more often than in `url`.
  const link = url && /^https?:\/\//i.test(url) ? url : text && /^https?:\/\/\S+$/i.test(text) ? text : null;
  return {
    images: q.getAll('i').filter((n) => NAME_RE.test(n)).slice(0, 10).map((n) => `/uploads/${n}`),
    link,
    text: link === text ? null : text,
    title: clip(q.get('title')),
    failed: Math.max(0, Math.min(99, Number(q.get('failed')) || 0)),
  };
}
