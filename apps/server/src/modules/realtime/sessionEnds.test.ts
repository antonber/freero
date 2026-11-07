// Ended sessions stay ended on the server (sessionEnds.ts, state-machine audit FAC-1). Real Y.Docs
// driven the way rooms.ts applies a socket's update: the server's doc, and clients that synced
// from it and then wrote at the same moment (or offline).
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { FACILITATION_COLLECTION, FACILITATION_KEY, sessionEndKey, type FacilitationSession } from '@freero/shared';
import { guardSession } from './facilitation';
import { guardSessionEnds, prepareSessionEnds } from './sessionEnds';

const running = { id: 'run1', endsAt: 2_000, duration: 1_000, pausedRemaining: null, running: true, startedBy: 'ann' };
const stopped = { id: 'run1', ended: true };

/** Applies a socket's update to the server's doc with the guards rooms.ts runs. */
function serve(server: Y.Doc, update: Uint8Array, who = { userId: 'ann', access: 'editor' as const }): void {
  prepareSessionEnds(server);
  server.transact((tr) => {
    Y.applyUpdate(server, update);
    guardSession(tr, server, who);
    guardSessionEnds(tr, server);
  }, 'socket');
}

/** A client that synced from the server; a higher `clientID` wins a concurrent write of one key. */
function client(server: Y.Doc, clientID: number): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
  return doc;
}
const write = (doc: Y.Doc, server: Y.Doc, change: () => void): Uint8Array => {
  const before = Y.encodeStateVector(server);
  change();
  return Y.encodeStateAsUpdate(doc, before);
};

it('a Pause that won the merge against a Stop is set back to the stop, so clients that read only the timer key see no timer', () => {
  const server = new Y.Doc();
  server.getMap('timer').set('state', running);
  const ann = client(server, 1);
  const bob = client(server, 2); // his write wins the key against ann's
  const timer = (d: Y.Doc) => d.getMap<unknown>('timer');

  const stop = write(ann, server, () => ann.transact(() => (timer(ann).set(sessionEndKey('run1'), stopped), timer(ann).set('state', stopped))));
  const pause = write(bob, server, () => timer(bob).set('state', { ...running, running: false, endsAt: null, pausedRemaining: 900 }));
  serve(server, stop);
  serve(server, pause);

  expect(timer(server).get('state')).toEqual(stopped);
});

it('an end that waited offline does not replace the session someone started after it ended', () => {
  const server = new Y.Doc();
  const round = (id: string) => ({ id, itemIds: ['a'], index: 0, deck: { kind: 'fibonacci', values: ['1'] }, revealed: false, startedBy: 'ann' });
  const est = (d: Y.Doc) => d.getMap<unknown>('estimation');
  est(server).set('round', round('r1'));
  const offline = client(server, 9); // its stale write would win the key
  const endR1 = () => ({ id: 'r1', ended: true });
  const late = write(offline, server, () => offline.transact(() => (est(offline).set(sessionEndKey('r1'), endR1()), est(offline).set('round', endR1()))));

  const online = client(server, 1);
  serve(server, write(online, server, () => online.transact(() => (est(online).set(sessionEndKey('r1'), endR1()), est(online).set('round', endR1())))));
  serve(server, write(online, server, () => est(online).set('round', round('r2'))));
  serve(server, late);

  expect(est(server).get('round')).toMatchObject({ id: 'r2', revealed: false });
});

it('a client from before end markers clearing its collection cannot remove an end, so the ended round stays ended', () => {
  const server = new Y.Doc();
  const est = (d: Y.Doc) => d.getMap<unknown>('estimation');
  est(server).set(sessionEndKey('r1'), { id: 'r1', ended: true });
  const old = client(server, 1);

  serve(server, write(old, server, () => old.transact(() => { for (const k of [...est(old).keys()]) est(old).delete(k); })));

  expect(est(server).get(sessionEndKey('r1'))).toEqual({ id: 'r1', ended: true });
});

it("only the facilitator or the owner can end facilitator controls with the session's end marker", () => {
  const server = new Y.Doc();
  const s: FacilitationSession = { id: 'f1', by: 'lead', byName: 'Lead', startedAt: 1, locked: true, allowedTypes: null, follow: false, cursorsHidden: false };
  const fac = (d: Y.Doc) => d.getMap<unknown>(FACILITATION_COLLECTION);
  fac(server).set(FACILITATION_KEY, s);
  const end = (d: Y.Doc) => write(d, server, () => fac(d).set(sessionEndKey('f1'), { id: 'f1', ended: true }));

  serve(server, end(client(server, 1)), { userId: 'someone', access: 'editor' });
  expect(fac(server).has(sessionEndKey('f1'))).toBe(false);
  expect(fac(server).get(FACILITATION_KEY)).toMatchObject({ by: 'lead', locked: true });

  serve(server, end(client(server, 2)), { userId: 'lead', access: 'editor' });
  expect(fac(server).get(FACILITATION_KEY)).toEqual({ id: 'f1', ended: true });
});
