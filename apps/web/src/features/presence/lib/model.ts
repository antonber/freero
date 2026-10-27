// Pure presence logic: who is on the board and which ephemeral signals (reaction bursts,
// "bring everyone here") are new. Following someone's view is the engine's (Editor.follow).
import type { PresenceState } from '@freero/shared';
import type { HostUser } from '@engine';

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
