// Pure presentation model: slide order, navigation and reading other users' presence (unit-tested).
import type { BoardElement, FrameElement, PresenceState } from '@freero/shared';
import type { LaserExt } from './laser';

/** What the presenter publishes in PresenceState.ext.present. */
export interface PresentExt {
  presenting?: { frameId: string | null; startedAt: number } | null;
  /** Laser pointer trail (lib/laser.ts), null when not pointing. */
  laser?: LaserExt | null;
}

export type Peer = PresenceState & { clientId: number };

/** Frames in presentation order: by `index`, then creation time, then id. */
export function slides(elements: readonly BoardElement[]): FrameElement[] {
  return elements
    .filter((el): el is FrameElement => el.type === 'frame')
    .sort((a, b) => a.index - b.index || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/**
 * Position of the current slide. Follows the frame by id (so reordering or inserting frames keeps
 * you on the same slide); if that frame was deleted, stays at the same position, clamped.
 */
export function currentPosition(list: readonly FrameElement[], frameId: string | null, lastPosition: number): number {
  if (!list.length) return -1;
  const at = frameId ? list.findIndex((f) => f.id === frameId) : -1;
  if (at >= 0) return at;
  return Math.max(0, Math.min(list.length - 1, lastPosition));
}

/** Keys that navigate a presentation. Returns the step, or 'exit', or null when not a nav key. */
export function navKey(key: string, shiftKey = false): -1 | 1 | 'first' | 'last' | 'exit' | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return 1;
    case ' ':
      return shiftKey ? -1 : 1;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return -1;
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Escape':
      return 'exit';
    default:
      return null;
  }
}

export function readExt(peer: Pick<Peer, 'ext'>): PresentExt {
  const v = peer.ext?.present;
  return v && typeof v === 'object' ? (v as PresentExt) : {};
}

/** Another user who is presenting right now (the one who started most recently wins). */
export function activePresenter(peers: readonly Peer[], selfUserId: string): Peer | null {
  let best: Peer | null = null;
  for (const p of peers) {
    if (p.user?.id === selfUserId) continue; // my own other tab is not "someone presenting"
    const pres = readExt(p).presenting;
    if (!pres) continue;
    if (!best || pres.startedAt > (readExt(best).presenting?.startedAt ?? 0)) best = p;
  }
  return best;
}
