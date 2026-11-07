// Ended sessions stay ended (state-machine audit FAC-1; the model is in @freero/shared sessions.ts).
//
// The board timer, a retro, a planning-poker round, a dot vote, private mode and facilitator controls
// are each one whole value under one key (ENDING_SESSIONS). A session carries an id, and its end is
// kept as a tombstone under `ended:<id>`. Here, inside the transaction that applies a socket's
// update to the shared doc (like the other guards: nobody else ever receives what is undone, and the
// sender is sent the correction):
//
//   1. an `ended:<id>` key is written once, as a tombstone of session <id>, and never changed or
//      removed (a client from before markers clears its collection wholesale: put back);
//   2. a write of a session whose id had already ended before this update is undone (a stale or
//      offline Pause, step or switch — and a stale end arriving over a newer session);
//   3. a session key left holding a session whose id has ended (a stale write that won the merge
//      against the end, Y1/Y2) is set to that session's tombstone.
//
// So the session key converges for every client, also those that read only it, and the server's own
// readers of those keys (facilitation limits, ballots, picks, drafts) see an ended session as gone.
// Who may END a session is each owner's rule: facilitator controls only by the facilitator or the
// owner (facilitation.ts guards its marker); the others by any editor, as before.
import * as Y from 'yjs';
import { ENDING_SESSIONS, isEndMarkerFor, isSessionEndKey, SESSION_END_PREFIX, sessionEndKey, sessionIdOf } from '@freero/shared';
import { changedKeys } from './facilitation';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function restore(map: Y.Map<unknown>, key: string, before: unknown): void {
  if (before === undefined) map.delete(key);
  else map.set(key, before);
}

/** Creates the collections up front, so the guard sees an update's changes (changedKeys). */
export function prepareSessionEnds(doc: Y.Doc): void {
  for (const { collection } of ENDING_SESSIONS) doc.getMap<unknown>(collection);
}

/** Applies the rules above to this transaction's changes of `doc` (the shared doc). True when it changed something. */
export function guardSessionEnds(tr: Y.Transaction, doc: Y.Doc): boolean {
  let fixed = false;
  for (const { collection, key } of ENDING_SESSIONS) {
    if (!doc.share.has(collection)) continue;
    const map = doc.getMap<unknown>(collection);
    const changes = changedKeys(tr, map);
    if (!changes.size) continue;
    // 1. Markers: written once, well-formed, then fixed.
    const addedNow = new Set<string>();
    for (const [k, { before, after }] of changes) {
      if (!isSessionEndKey(k)) continue;
      const ok = before === undefined ? isEndMarkerFor(after, k.slice(SESSION_END_PREFIX.length)) : same(before, after);
      if (!ok) {
        restore(map, k, before);
        fixed = true;
      } else if (before === undefined) addedNow.add(k);
    }
    // 2. A write of a session that had ended before this update: undone.
    const s = changes.get(key);
    const writtenId = s ? sessionIdOf(s.after) : null;
    if (s && writtenId && map.has(sessionEndKey(writtenId)) && !addedNow.has(sessionEndKey(writtenId))) {
      restore(map, key, s.before);
      fixed = true;
    }
    // 3. The session key holds an ended session: its tombstone.
    const id = sessionIdOf(map.get(key));
    const end = id ? map.get(sessionEndKey(id)) : undefined;
    if (end !== undefined && !same(map.get(key), end)) {
      map.set(key, end);
      fixed = true;
    }
  }
  return fixed;
}
