// Role enforcement for incoming Yjs updates.
//   owner/editor -> apply
//   viewer       -> drop
//   commenter    -> apply only if every top-level type it touches is in COMMENTER_WRITABLE
import * as Y from 'yjs';
import { COMMENTER_WRITABLE, type Role } from '@freero/shared';

export type UpdateDecision = 'apply' | 'drop';

const COMMENTER_SET: ReadonlySet<string> = new Set(COMMENTER_WRITABLE);

/** Name under which `type`'s top-level ancestor is registered in doc.share, or null if unknown. */
export function rootName(doc: Y.Doc, type: Y.AbstractType<unknown>): string | null {
  let t: Y.AbstractType<unknown> = type;
  while (t._item) {
    const parent = t._item.parent;
    if (!(parent instanceof Y.AbstractType)) return null;
    t = parent as Y.AbstractType<unknown>;
  }
  for (const [name, root] of doc.share) if (root === t) return name;
  return null;
}

/**
 * Applies `update` to a scratch copy of `doc` and reports which top-level types it changes.
 * `null` in `names` means a change whose root could not be identified. `ok` is false when the
 * update is malformed or leaves structs pending (missing dependencies), i.e. its effect is unknown.
 */
export function changedRoots(doc: Y.Doc, update: Uint8Array): { ok: boolean; names: Set<string | null> } {
  const names = new Set<string | null>();
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    scratch.on('afterTransaction', (tr: Y.Transaction) => {
      for (const t of tr.changed.keys()) names.add(rootName(scratch, t as Y.AbstractType<unknown>));
      for (const t of tr.changedParentTypes.keys()) names.add(rootName(scratch, t as Y.AbstractType<unknown>));
    });
    Y.applyUpdate(scratch, update);
    const pending = scratch.store.pendingStructs !== null || scratch.store.pendingDs !== null;
    return { ok: !pending, names };
  } catch {
    return { ok: false, names };
  } finally {
    scratch.destroy();
  }
}

export function commenterMayApply(doc: Y.Doc, update: Uint8Array): boolean {
  const { ok, names } = changedRoots(doc, update);
  if (!ok) return false;
  for (const n of names) if (n === null || !COMMENTER_SET.has(n)) return false;
  return true;
}

export function decideUpdate(role: Role, doc: Y.Doc, update: Uint8Array): UpdateDecision {
  switch (role) {
    case 'owner':
    case 'editor':
      return 'apply';
    case 'commenter':
      return commenterMayApply(doc, update) ? 'apply' : 'drop';
    default:
      return 'drop';
  }
}
