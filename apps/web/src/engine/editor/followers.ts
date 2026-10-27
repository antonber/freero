// Follower pass: element types whose stored fields are derived from OTHER elements (connector
// endpoints follow the shapes they are attached to) declare `ElementDefinition.follow`. After
// every LOCAL updateMany/remove, inside the same Yjs transaction, the engine offers the change
// to each such element so it can refresh its derived fields. Consequences:
//   - the refresh lands in the same undo step and the same network update as the change;
//   - only the client that made the change writes (remote updates never run followers), so
//     collaborators never race each other rewriting the same cache.
import type { BoardElement } from '@freero/shared';
import type { FollowChange } from '../api';
import type { EngineCore } from '../runtime/core';

/** Must be called inside store.transact, after the change itself has been written. */
export function runFollowers(core: EngineCore, changed: Iterable<string>, removed: Iterable<string>): void {
  const followers = [...core.registry.elements.values()].filter((r) => r.def.follow);
  if (!followers.length) return;
  const change: Omit<FollowChange, 'editor'> = { changed: new Set(changed), removed: new Set(removed) };
  if (!change.changed.size && !change.removed.size) return;
  const store = core.store;
  const now = Date.now();
  for (const { def, feature } of followers) {
    const ctx: FollowChange = { ...change, editor: core.scoped(feature) };
    // The ordered cache still lists the pre-transaction objects: use it for ids only and read
    // the current value from the store.
    for (const stale of store.getOrderedOfType(def.type)) {
      const el = store.getElement(stale.id);
      if (!el || change.removed.has(el.id)) continue;
      const patch = def.follow!(el as never, ctx) as Record<string, unknown> | null;
      if (!patch) continue;
      const cur = el as unknown as Record<string, unknown>;
      if (!Object.keys(patch).some((k) => patch[k] !== cur[k])) continue;
      store.setElement({ ...el, ...patch, id: el.id, type: el.type, updatedAt: now } as BoardElement);
    }
  }
}
