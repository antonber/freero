// Pure presence logic: who is on the board, how to mirror someone's viewport, and which
// ephemeral signals (reaction bursts, "bring everyone here") are new.
import type { PresenceState } from '@freero/shared';
import type { Camera, HostUser } from '@engine';

export type Peer = PresenceState & { clientId: number };
export type Viewport = NonNullable<PresenceState['viewport']>;

export const REACTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '👏'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** What this feature publishes in PresenceState.ext.presence. */
export interface PresenceExt {
  /** Latest reaction burst; a new id = a new burst. */
  reaction?: { id: string; emoji: Reaction; at: { x: number; y: number } | null };
  /** Latest "bring everyone to me" request; a new id = a new request. */
  summon?: { id: string; viewport: Viewport | null };
  /** User id this client is currently following, if any. */
  following?: string | null;
}

/** Reads another client's presence ext defensively (peers are untrusted input). */
export function readExt(peer: Pick<PresenceState, 'ext'>): PresenceExt {
  const raw = peer.ext?.presence;
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: PresenceExt = {};
  const reaction = r.reaction as PresenceExt['reaction'] | undefined;
  if (reaction && typeof reaction.id === 'string' && (REACTIONS as readonly string[]).includes(reaction.emoji))
    out.reaction = { id: reaction.id, emoji: reaction.emoji, at: validPoint(reaction.at) };
  const summon = r.summon as PresenceExt['summon'] | undefined;
  if (summon && typeof summon.id === 'string') out.summon = { id: summon.id, viewport: validViewport(summon.viewport) };
  if (typeof r.following === 'string') out.following = r.following;
  return out;
}

function validPoint(v: unknown): { x: number; y: number } | null {
  if (!v || typeof v !== 'object') return null;
  const { x, y } = v as { x: unknown; y: unknown };
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function validViewport(v: unknown): Viewport | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Viewport;
  const ok = [o.x, o.y, o.zoom, o.width, o.height].every((n) => typeof n === 'number' && Number.isFinite(n));
  return ok && o.zoom > 0 && o.width > 0 && o.height > 0 ? o : null;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export interface Person {
  userId: string;
  name: string;
  color: string;
  avatarUrl: string | null;
  isMe: boolean;
  /** Every connected client (tab) of this user, excluding this one. */
  clients: Peer[];
}

/**
 * Everyone on the board, one entry per user (several tabs collapse into one), you first,
 * then others by name. Your own other tabs merge into your entry.
 */
export function peopleOnBoard(me: HostUser, peers: Peer[]): Person[] {
  const byUser = new Map<string, Person>();
  const mine: Person = { userId: me.id, name: me.name, color: me.color, avatarUrl: me.avatarUrl, isMe: true, clients: [] };
  byUser.set(me.id, mine);
  for (const p of peers) {
    const id = p.user?.id;
    if (!id) continue;
    let person = byUser.get(id);
    if (!person) {
      person = { userId: id, name: p.user.name || 'Guest', color: p.user.color, avatarUrl: p.user.avatarUrl ?? null, isMe: false, clients: [] };
      byUser.set(id, person);
    }
    person.clients.push(p);
  }
  const others = [...byUser.values()].filter((p) => !p.isMe);
  others.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  return [mine, ...others];
}

/**
 * The client to jump to / follow for a person with several tabs: one that is actually
 * looking at the board (has a viewport), preferring one whose pointer is on the canvas.
 */
export function primaryClient(person: Person): Peer | null {
  let best: Peer | null = null;
  const score = (p: Peer) => (p.viewport ? 2 : 0) + (p.cursor ? 1 : 0);
  for (const c of person.clients) if (!best || score(c) > score(best) || (score(c) === score(best) && c.clientId > best.clientId)) best = c;
  return best;
}

// ---------------------------------------------------------------------------
// Viewports
// ---------------------------------------------------------------------------
/**
 * Camera for a viewport of size `mine` that shows everything someone else sees in theirs
 * (same center; zoomed out if your screen is smaller than theirs).
 */
export function cameraToShow(view: Viewport, mine: { width: number; height: number }): Camera {
  const cx = view.x + view.width / (2 * view.zoom);
  const cy = view.y + view.height / (2 * view.zoom);
  const zoom = view.zoom * Math.min(mine.width / view.width, mine.height / view.height);
  return { x: cx - mine.width / (2 * zoom), y: cy - mine.height / (2 * zoom), zoom };
}

/** One smoothing step from `a` toward `b`: centers interpolate linearly, zoom geometrically. */
export function stepCamera(a: Camera, b: Camera, t: number, size: { width: number; height: number }): Camera {
  const zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * t);
  const ca = { x: a.x + size.width / (2 * a.zoom), y: a.y + size.height / (2 * a.zoom) };
  const cb = { x: b.x + size.width / (2 * b.zoom), y: b.y + size.height / (2 * b.zoom) };
  const cx = ca.x + (cb.x - ca.x) * t;
  const cy = ca.y + (cb.y - ca.y) * t;
  return { x: cx - size.width / (2 * zoom), y: cy - size.height / (2 * zoom), zoom };
}

/** Same camera up to sub-pixel noise (screen pixels / zoom ratio). */
export function sameCamera(a: Camera, b: Camera, px = 0.5): boolean {
  return Math.abs(a.x - b.x) * a.zoom < px && Math.abs(a.y - b.y) * a.zoom < px && Math.abs(a.zoom / b.zoom - 1) < 1e-3;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------
/**
 * Returns the peers whose signal id changed since the last call, updating `seen`.
 * The first time a client is seen its current signal is only recorded, never replayed —
 * opening a board must not fire reactions or summons that happened before you arrived.
 * Clients that left are forgotten.
 */
export function newSignals<T extends { id: string }>(
  seen: Map<number, string | null>,
  peers: Peer[],
  pick: (ext: PresenceExt) => T | undefined,
): Array<{ peer: Peer; signal: T }> {
  const out: Array<{ peer: Peer; signal: T }> = [];
  const live = new Set<number>();
  for (const peer of peers) {
    live.add(peer.clientId);
    const signal = pick(readExt(peer));
    const id = signal?.id ?? null;
    if (!seen.has(peer.clientId)) {
      seen.set(peer.clientId, id);
      continue;
    }
    if (signal && id !== seen.get(peer.clientId)) out.push({ peer, signal });
    seen.set(peer.clientId, id);
  }
  for (const id of [...seen.keys()]) if (!live.has(id)) seen.delete(id);
  return out;
}

// ---------------------------------------------------------------------------
// Throttle
// ---------------------------------------------------------------------------
export interface Bucket { tokens: number; at: number }
export const BURST_CAPACITY = 3;
export const BURST_REFILL_MS = 1500;

/** Token bucket: a short flurry is fine, holding the button down is not. */
export function takeToken(b: Bucket, now: number, capacity = BURST_CAPACITY, refillMs = BURST_REFILL_MS): { ok: boolean; bucket: Bucket } {
  const tokens = Math.min(capacity, b.tokens + (now - b.at) / refillMs);
  if (tokens < 1) return { ok: false, bucket: { tokens, at: now } };
  return { ok: true, bucket: { tokens: tokens - 1, at: now } };
}
