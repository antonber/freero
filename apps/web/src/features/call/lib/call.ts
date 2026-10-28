// The board's call (KAI-134). Freero carries no audio or video: "Join call" opens the board's
// meeting link (or its own Jitsi room) in a new tab. Who is in the call is presence only
// (ext.call, written by this feature): set on Join, cleared on Leave or when the tab closes.
import type { BoardCall, PresenceState } from '@freero/shared';

export const CALL_DIALOG = 'call.dialog';
/** Collection `call`, key REV_KEY: bumped after the link changes, so open boards fetch the new one. */
export const CALL_COLLECTION = 'call';
export const REV_KEY = 'rev';

export interface CallPresence {
  since: number;
}

export const inCall = (p: Pick<PresenceState, 'ext'>): boolean => {
  const c = p.ext?.call as CallPresence | undefined | null;
  return !!c && typeof c.since === 'number';
};

/** People in the call, once each (several tabs of one person count once). */
export function callers<P extends Pick<PresenceState, 'ext' | 'user'>>(peers: P[]): P[] {
  const byUser = new Map<string, P>();
  for (const p of peers) if (inCall(p) && p.user && !byUser.has(p.user.id)) byUser.set(p.user.id, p);
  return [...byUser.values()];
}

/** "Jitsi" / "meet.google.com" — what the button's tooltip says it opens. */
export function callHost(call: BoardCall): string {
  if (call.kind === 'jitsi') return 'the board’s Jitsi room';
  try {
    return new URL(call.url).hostname.replace(/^www\./, '');
  } catch {
    return 'the meeting';
  }
}

/** Opens only https links (the server checks too; this is the reader's own guard). */
export function openCall(call: BoardCall): boolean {
  let u: URL;
  try {
    u = new URL(call.url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  window.open(u.toString(), '_blank', 'noopener,noreferrer');
  return true;
}
