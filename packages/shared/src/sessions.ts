/**
 * Sessions that end (state-machine audit FAC-1): the board timer, a retro, a planning-poker round,
 * a dot vote's results, private mode and facilitator controls. Each is ONE whole JSON value under one
 * key of its collection, and every writer writes the whole value back. Ending one used to be a delete
 * (or an overwrite) racing those writes, so a concurrent or offline Pause, "Add action item" or
 * "Anonymous" brought an ended session back for everyone.
 *
 * So a session carries an `id` (new for every start) and its end is a STATE, not a delete: the ender
 * writes a tombstone — `{ id, ended: true, … }` — under `ended:<id>` (sessionEndKey) and removes the
 * session (or leaves its tombstone) under the session key. Nothing else ever writes, changes or
 * deletes an `ended:` key, so it survives every merge, and a session value whose id has one reads as
 * that tombstone whoever's write won the session key. A missing value and a tombstone read alike:
 * no session. A new session gets a new id, so ending is never undone, only followed.
 *
 * The SERVER holds the same rules for every socket (apps/server realtime/sessionEnds.ts): an end
 * marker is written once and never changed or removed; a socket's write of a session whose id had
 * already ended is undone; and a session key left holding an ended session (a stale write that won
 * the merge) is set to its tombstone. So the session key converges too, for clients that read only it.
 *
 * Mixed versions: a client from before this ends by deleting the key, which reads as no session
 * here; its sessions have no id, so no marker can pin their end (they can come back as before). Its
 * writes spread the value they read, so they keep a newer client's id and the rules above apply to
 * them. Markers are never pruned: one small entry per ended session.
 */
export const SESSION_END_PREFIX = 'ended:';
export const sessionEndKey = (id: string) => `${SESSION_END_PREFIX}${id}`;
export const isSessionEndKey = (key: string) => key.startsWith(SESSION_END_PREFIX);

/** What an ended session reads as (features may keep more fields, e.g. private mode's anonymity). */
export interface SessionTombstone {
  id: string;
  ended: true;
}

/** Where each session that ends this way lives (collection, key). */
export const ENDING_SESSIONS: ReadonlyArray<{ collection: string; key: string }> = [
  { collection: 'timer', key: 'state' },
  { collection: 'retro', key: 'session' },
  { collection: 'estimation', key: 'round' },
  { collection: 'voting', key: 'session' },
  { collection: 'privateMode', key: 'session' },
  { collection: 'facilitation', key: 'session' },
];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The session id a value carries, or null (none, or written by a client from before ids). */
export const sessionIdOf = (v: unknown): string | null => (isObj(v) && typeof v.id === 'string' && v.id ? v.id : null);

export const isSessionTombstone = (v: unknown): boolean => isObj(v) && v.ended === true;

/** Is `v` a well-formed end marker for session `id`? */
export const isEndMarkerFor = (v: unknown, id: string): boolean => isSessionTombstone(v) && sessionIdOf(v) === id;

/**
 * What the session key reads as: its value, or — once that session ended — its tombstone.
 * `get` reads the collection.
 */
export function sessionValue(get: (key: string) => unknown, key: string): unknown {
  const v = get(key);
  const id = sessionIdOf(v);
  const end = id ? get(sessionEndKey(id)) : undefined;
  return end !== undefined ? end : v;
}

/** The running session under `key`, or undefined (missing, a tombstone, or its id has ended). */
export function liveSession(get: (key: string) => unknown, key: string): unknown {
  const v = sessionValue(get, key);
  return v === undefined || isSessionTombstone(v) ? undefined : v;
}

/** Has the session with this id ended (its marker is there)? */
export const sessionEnded = (get: (key: string) => unknown, id: string): boolean => get(sessionEndKey(id)) !== undefined;

/**
 * Ends session `tombstone.id`: writes its marker, and under the session key either the tombstone
 * (`keep`) or nothing. Delete where a server from before this refuses a tombstone under the key
 * (voting, facilitation): there the marker alone pins the end. Call inside the caller's transaction.
 */
export function writeSessionEnd(
  store: { set(key: string, value: never): void; delete(key: string): void },
  key: string,
  tombstone: SessionTombstone & Record<string, unknown>,
  opts: { keep?: boolean } = {},
): void {
  store.set(sessionEndKey(tombstone.id), tombstone as never);
  if (opts.keep) store.set(key, tombstone as never);
  else store.delete(key);
}
