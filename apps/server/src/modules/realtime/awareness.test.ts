import { describe, expect, it } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { sanitizeAwarenessUpdate, type AwarenessIdentity } from './awareness';

const mallory: AwarenessIdentity = { id: 'mallory', name: 'Mallory', color: '#C92A2A', avatarUrl: null };

/** What a (possibly crafted) client would send: its awareness state for the given client ids. */
function updateFrom(states: Array<[number, unknown]>, clock = 5): Uint8Array {
  const a = new awarenessProtocol.Awareness(new Y.Doc());
  for (const [id, state] of states) {
    a.states.set(id, state as Record<string, unknown>);
    a.meta.set(id, { clock, lastUpdated: 0 });
  }
  return awarenessProtocol.encodeAwarenessUpdate(a, states.map(([id]) => id));
}

/** The room's presence after applying `update` on top of `before` (updates from other sockets). */
function applied(update: Uint8Array | null, before?: Uint8Array): Map<number, Record<string, unknown>> {
  const room = new awarenessProtocol.Awareness(new Y.Doc());
  room.setLocalState(null);
  if (before) awarenessProtocol.applyAwarenessUpdate(room, before, null);
  if (update) awarenessProtocol.applyAwarenessUpdate(room, update, null);
  return room.getStates() as Map<number, Record<string, unknown>>;
}

describe('presence from a socket', () => {
  it('cannot make a client appear as another user (id, name and color are the socket owner’s)', () => {
    const forged = updateFrom([[11, { user: { id: 'olivia', name: 'Olivia Owner', color: '#000000' }, cursor: { x: 1, y: 2 } }]]);
    const states = applied(sanitizeAwarenessUpdate(forged, { user: mallory, ownedElsewhere: () => false }));
    expect(states.get(11)?.user).toEqual(mallory);
    expect(states.get(11)?.cursor).toEqual({ x: 1, y: 2 });
  });

  it("cannot overwrite or remove presence announced over someone else's socket", () => {
    const olivia = { id: 'olivia', name: 'Olivia', color: '#2F9E44', avatarUrl: null };
    const before = updateFrom([[21, { user: olivia, cursor: { x: 0, y: 0 } }]]);
    const removal = (() => {
      const a = new awarenessProtocol.Awareness(new Y.Doc());
      a.meta.set(21, { clock: 9, lastUpdated: 0 }); // higher clock + null state = "Olivia left"
      return awarenessProtocol.encodeAwarenessUpdate(a, [21], new Map([[21, null as never]]));
    })();
    const hijack = updateFrom([[21, { user: mallory, cursor: { x: 9, y: 9 } }]], 9);
    for (const update of [removal, hijack]) {
      const states = applied(sanitizeAwarenessUpdate(update, { user: mallory, ownedElsewhere: (id) => id === 21 }), before);
      expect(states.get(21)?.user).toEqual(olivia);
      expect(states.get(21)?.cursor).toEqual({ x: 0, y: 0 });
    }
  });
});
