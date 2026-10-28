import { nanoid } from 'nanoid';
import type { Tag } from '@freero/shared';
import { defineCommands, type ElementPatch } from '@engine';
import { isTaggable, nextColor, normName } from './lib/tags';

export default defineCommands([
  {
    // Tags by NAME for other features (a CSV import, KAI-136): `{ items: [{ id, names }] }` adds the
    // named tags to those stickies / cards, creating the board tags that don't exist yet (matched
    // case-insensitively). Runs in the caller's transaction when there is one (one undo step).
    id: 'tags.applyNames',
    label: 'Tag items by name',
    run(editor, args) {
      const items = Array.isArray(args?.items) ? (args.items as Array<{ id?: unknown; names?: unknown }>) : [];
      const coll = editor.collection<Tag>('tags');
      const known = coll.entries().map(([, t]) => t);
      const byName = new Map(known.map((t) => [normName(t.name).toLowerCase(), t]));
      const idOf = (raw: string): string | null => {
        const name = normName(raw).slice(0, 40);
        if (!name) return null;
        const hit = byName.get(name.toLowerCase());
        if (hit) return hit.id;
        const tag: Tag = { id: nanoid(10), name, color: nextColor([...byName.values()]) };
        coll.set(tag.id, tag);
        byName.set(name.toLowerCase(), tag);
        return tag.id;
      };
      const patches: Array<{ id: string; patch: ElementPatch }> = [];
      for (const it of items) {
        if (typeof it.id !== 'string' || !Array.isArray(it.names)) continue;
        const el = editor.getElement(it.id);
        if (!isTaggable(el)) continue;
        const ids = it.names.flatMap((n) => (typeof n === 'string' ? [idOf(n)] : [])).filter((x): x is string => !!x);
        const next = [...new Set([...(el.tags ?? []), ...ids])];
        if (next.length !== (el.tags ?? []).length) patches.push({ id: el.id, patch: { tags: next } as ElementPatch });
      }
      if (patches.length) editor.updateMany(patches);
    },
  },
]);
