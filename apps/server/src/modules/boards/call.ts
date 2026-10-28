// A board's call (KAI-134). Freero carries no audio or video: a board has a link people open in
// their meeting tool — one its editors paste (https only), or a room on the operator's Jitsi
// (JITSI_BASE_URL) whose name is derived from the board id with the server's secret, so knowing
// one board's room (or id) tells nobody another board's room.
import { MAX_CALL_URL, type BoardCall } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest } from '../../platform/http';
import { mac } from '../../platform/secrets';

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
