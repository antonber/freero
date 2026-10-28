// Role enforcement for incoming Yjs updates.
//   owner/editor -> apply
//   viewer       -> drop
//   commenter    -> apply only if every top-level type it touches is in COMMENTER_WRITABLE, and
//                   every `comments` record it writes is one it may write (commentRules.ts)
import * as Y from 'yjs';
import { COMMENTER_WRITABLE, type Role } from '@freero/shared';
import { commenterMayChangeComments, type KeyChange } from './commentRules';

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

const COMMENTS = 'comments';

/**
 * A commenter's update: confined to COMMENTER_WRITABLE, and in `comments` only plain records the
 * connection's user may write (no nested shared types, see commentRules.ts).
 */
export function commenterMayApply(doc: Y.Doc, update: Uint8Array, userId: string): boolean {
  const names = new Set<string | null>();
  const scratch = new Y.Doc();
  const changedKeys = new Set<string>();
  let nested = false;
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    const scratchComments = scratch.getMap<unknown>(COMMENTS);
    scratch.on('afterTransaction', (tr: Y.Transaction) => {
      for (const [t, keys] of tr.changed) {
        names.add(rootName(scratch, t as Y.AbstractType<unknown>));
        if ((t as unknown) !== scratchComments) nested = true;
        else for (const k of keys) if (k !== null) changedKeys.add(k);
      }
      for (const t of tr.changedParentTypes.keys()) names.add(rootName(scratch, t as Y.AbstractType<unknown>));
    });
    Y.applyUpdate(scratch, update);
    if (scratch.store.pendingStructs !== null || scratch.store.pendingDs !== null) return false;
    for (const n of names) if (n === null || !COMMENTER_SET.has(n)) return false;
    if (!changedKeys.size) return !nested;
    if (nested) return false;
    const live = doc.getMap<unknown>(COMMENTS);
    const plain = (v: unknown) => (v instanceof Y.AbstractType ? Symbol('shared type') : v);
    const changes: KeyChange[] = [];
    for (const key of changedKeys) {
      const after = scratchComments.get(key);
      if (after instanceof Y.AbstractType) return false;
      changes.push({ key, before: plain(live.get(key)), after });
    }
    return commenterMayChangeComments(changes, userId, (k) => plain(live.get(k)), () => live.keys());
  } catch {
    return false;
  } finally {
    scratch.destroy();
  }
}

export function decideUpdate(role: Role, doc: Y.Doc, update: Uint8Array, userId: string): UpdateDecision {
  switch (role) {
    case 'owner':
    case 'editor':
      return 'apply';
    case 'commenter':
      return commenterMayApply(doc, update, userId) ? 'apply' : 'drop';
    default:
      return 'drop';
  }
}
