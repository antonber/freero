// Presence (Yjs awareness) arriving from a socket is checked before the room applies it.
// The y-protocols awareness format lets any client write ANY client id's state, so without this
// a crafted client could show up as another person (their id, name and color on its cursor,
// "following" or "presenting" as them) or wipe other people's presence.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export interface AwarenessIdentity {
  id: string;
  name: string;
  color: string;
  avatarUrl: string | null;
}

export interface AwarenessContext {
  /** The authenticated user behind the socket; stamped onto every state it publishes. */
  user: AwarenessIdentity;
  /** True when `clientId` is announced over ANOTHER socket of the room (not ours to write). */
  ownedElsewhere(clientId: number): boolean;
}

/**
 * Returns the update with every entry the socket may not write removed, and each remaining state's
 * `user` replaced by the authenticated identity (null = nothing left to apply). Throws on a
 * malformed update.
 */
export function sanitizeAwarenessUpdate(update: Uint8Array, ctx: AwarenessContext): Uint8Array | null {
  const decoder = decoding.createDecoder(update);
  const len = decoding.readVarUint(decoder);
  const kept: Array<{ clientId: number; clock: number; state: string }> = [];
  for (let i = 0; i < len; i++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const raw = decoding.readVarString(decoder);
    if (ctx.ownedElsewhere(clientId)) continue;
    const state: unknown = JSON.parse(raw);
    if (state === null) {
      kept.push({ clientId, clock, state: 'null' });
      continue;
    }
    if (typeof state !== 'object' || Array.isArray(state)) continue;
    const s = state as Record<string, unknown>;
    // Presence without a user (e.g. a client that has not set it yet) carries no identity to fake.
    if (s.user !== undefined) s.user = { ...ctx.user };
    kept.push({ clientId, clock, state: JSON.stringify(s) });
  }
  return encodeEntries(kept);
}

/**
 * Presence from ANOTHER instance (already sanitized there), minus the entries for client ids a
 * socket of this instance owns: a client that moved here before the old instance noticed it left
 * must not have its presence removed or overwritten by that instance. Null = nothing left.
 */
export function withoutClients(update: Uint8Array, ownedHere: (clientId: number) => boolean): Uint8Array | null {
  const decoder = decoding.createDecoder(update);
  const len = decoding.readVarUint(decoder);
  const kept: Array<{ clientId: number; clock: number; state: string }> = [];
  for (let i = 0; i < len; i++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const state = decoding.readVarString(decoder);
    if (!ownedHere(clientId)) kept.push({ clientId, clock, state });
  }
  return kept.length === len && len > 0 ? update : encodeEntries(kept);
}

function encodeEntries(kept: Array<{ clientId: number; clock: number; state: string }>): Uint8Array | null {
  if (!kept.length) return null;
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, kept.length);
  for (const k of kept) {
    encoding.writeVarUint(e, k.clientId);
    encoding.writeVarUint(e, k.clock);
    encoding.writeVarString(e, k.state);
  }
  return encoding.toUint8Array(e);
}
