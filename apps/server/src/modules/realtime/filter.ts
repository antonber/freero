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
 * connection's user may write (no nested shared types, see commentRules.ts). `layered`: the
 * `comments` records that live in a layer (threads on items in hidden frames, KAI-234). A record
 * a commenter writes there is moved into that layer (elementContent.ts), so the rules judge it
 * against what the layer holds, as if it were in the shared doc: authorship holds in layers too.
 */
export function commenterMayApply(doc: Y.Doc, update: Uint8Array, userId: string, authorNames?: ReadonlySet<string>, layered?: Y.Map<unknown>): boolean {
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
    const prior = (k: string) => plain(live.has(k) || !layered ? live.get(k) : layered.get(k));
    const keys = () => (layered ? new Set([...live.keys(), ...layered.keys()]).values() : live.keys());
    const changes: KeyChange[] = [];
    for (const key of changedKeys) {
      const after = scratchComments.get(key);
      if (after instanceof Y.AbstractType) return false;
      changes.push({ key, before: prior(key), after });
    }
    return commenterMayChangeComments(changes, userId, prior, keys, authorNames);
  } catch {
    return false;
  } finally {
    scratch.destroy();
  }
}

/** `authorNames`: the names a commenter's new comment messages may carry (commentRules.ts); `layered`: see commenterMayApply. */
export function decideUpdate(role: Role, doc: Y.Doc, update: Uint8Array, userId: string, authorNames?: ReadonlySet<string>, layered?: Y.Map<unknown>): UpdateDecision {
  switch (role) {
    case 'owner':
    case 'editor':
      return 'apply';
    case 'commenter':
      return commenterMayApply(doc, update, userId, authorNames, layered) ? 'apply' : 'drop';
    default:
      return 'drop';
  }
}
