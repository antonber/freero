// Feature-owned collections: one Y.Map per name, with a single-writer guard.
import type { Collection } from '../api';
import type { BoardStore } from './BoardStore';

export function ownershipError(name: string, owner: string | undefined): Error {
  if (!owner)
    return new Error(
      `Collection '${name}' is not owned by any feature; declare it in a feature.ts \`owns\` list before writing to it.`,
    );
  return new Error(`Collection '${name}' is owned by feature '${owner}'; run one of its commands instead.`);
}

export interface CollectionGuard {
  /** Feature that owns `name`, if any. */
  ownerOf(name: string): string | undefined;
  /** Returns false (after telling the user) when the current role may not write `name`. */
  canWrite(name: string): boolean;
}

/**
 * A collection view scoped to `scope` (a feature name, or 'engine'). Reads are open to
 * everyone; writes throw unless `scope` owns the collection.
 */
export function createCollection<T>(store: BoardStore, name: string, scope: string, guard: CollectionGuard): Collection<T> {
  const map = store.collectionMap<T>(name);
  const assertOwner = () => {
    const owner = guard.ownerOf(name);
    if (owner !== scope) throw ownershipError(name, owner);
  };
  return {
    get: (key) => map.get(key),
    entries: () => Array.from(map.entries()),
    set(key, value) {
      assertOwner();
      if (!guard.canWrite(name)) return;
      store.transact(() => map.set(key, value));
    },
    delete(key) {
      assertOwner();
      if (!guard.canWrite(name)) return;
      store.transact(() => map.delete(key));
    },
    observe(cb) {
      const h = () => cb();
      map.observe(h);
      return () => map.unobserve(h);
    },
  };
}

/** Builds collection → owner map, throwing if two features claim one name. */
export function claimCollections(features: Array<{ name: string; owns?: string[] }>): Map<string, string> {
  const owners = new Map<string, string>();
  for (const f of features) {
    for (const c of f.owns ?? []) {
      if (c === 'elements' || c === 'settings')
        throw new Error(`Feature '${f.name}' claims '${c}', which is owned by the engine.`);
      const prev = owners.get(c);
      if (prev && prev !== f.name)
        throw new Error(`Collection '${c}' is claimed by both feature '${prev}' and feature '${f.name}'. Every collection has exactly one owner.`);
      owners.set(c, f.name);
    }
  }
  return owners;
}
