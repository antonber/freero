// A board's call (KAI-134). Freero carries no audio or video: a board has a link people open in
// their meeting tool — one its editors paste (https only), or a room on the operator's Jitsi
// (JITSI_BASE_URL) whose name is derived from the board id with the server's secret, so knowing
// one board's room (or id) tells nobody another board's room.
import { MAX_CALL_URL, type BoardCall } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest } from '../../platform/http';
import { mac, seal, unseal } from '../../platform/secrets';

// The pasted meeting link is sealed at rest (KAI-143): links of Zoom, Teams and others often carry
// the meeting's passcode, so a copy of the database (a dump, a backup) must not hand out every
// board's meeting. Rows written before were plain text: they still read, and the
// `boards:seal-call-links` job seals them (and re-seals what a previous SESSION_SECRET sealed).
const CALL_URL_PURPOSE = 'boards.call-url-v1';
const SEALED_RE = /^v1\./;

export const sealCallUrl = (url: string | null): string | null => (url === null ? null : seal(CALL_URL_PURPOSE, url));

/** The stored value as a link: unsealed (null when no configured secret opens it), or a legacy plain one. */
export function openCallUrl(stored: string | null): string | null {
  if (stored === null) return null;
  if (!SEALED_RE.test(stored)) return stored;
  return unseal(CALL_URL_PURPOSE, stored)?.value ?? null;
}

/** What a stored value should become: sealed (plain), sealed again (a previous secret), or null (fine as it is / unreadable). */
export function resealedCallUrl(stored: string): string | null {
  if (!SEALED_RE.test(stored)) return sealCallUrl(stored);
  const opened = unseal(CALL_URL_PURPOSE, stored);
  return opened?.stale ? sealCallUrl(opened.value) : null;
}

/**
 * Seals every stored call link that is still plain text (written before KAI-143) or sealed under a
 * previous SESSION_SECRET. Idempotent; `boards:seal-call-links` runs it. `storage` is the repo.
 */
export async function sealStoredCallLinks(storage: {
  storedCallUrls(after: string, limit: number): Promise<Array<{ id: string; stored: string }>>;
  replaceStoredCallUrl(id: string, was: string, now: string): Promise<boolean>;
}): Promise<number> {
  let sealed = 0;
  let after = '';
  for (;;) {
    const rows = await storage.storedCallUrls(after, 500);
    for (const r of rows) {
      const next = resealedCallUrl(r.stored);
      if (next && (await storage.replaceStoredCallUrl(r.id, r.stored, next))) sealed++;
    }
    if (rows.length < 500) return sealed;
    after = rows[rows.length - 1].id;
  }
}

export const jitsiAvailable = (): boolean => getConfig().jitsiBaseUrl !== null;

/** The board's Jitsi room name: not guessable from the board id without the server's secret. */
export const jitsiRoom = (boardId: string): string => `Freero${mac(`boards.call:${boardId}`).toString('hex').slice(0, 24)}`;

/** What "Join call" opens for this board, or null (no link set; a Jitsi room while Jitsi is off). */
export function callOf(board: { id: string; callUrl: string | null; callJitsi: boolean }): BoardCall | null {
  const base = getConfig().jitsiBaseUrl;
  if (board.callJitsi && base) return { kind: 'jitsi', url: `${base}/${jitsiRoom(board.id)}` };
  if (board.callUrl) return { kind: 'link', url: board.callUrl };
  return null;
}

/**
 * A meeting link as people paste it, checked: https only (never javascript:, data:, plain http),
 * a real host name, no credentials, at most MAX_CALL_URL characters. Returns it normalised.
 */
export function cleanCallUrl(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw badRequest('Paste the meeting link (https://…)');
  const raw = v.trim();
  if (raw.length > MAX_CALL_URL) throw badRequest('That link is too long');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest('That isn’t a link. Paste the meeting link (https://…)');
  }
  if (u.protocol !== 'https:') throw badRequest('Call links must start with https://');
  if (u.username || u.password) throw badRequest('Call links can’t carry a user name or password');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) throw badRequest('Call links need a web address like meet.example.com');
  return u.toString();
}
