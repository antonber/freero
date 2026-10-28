// What tags add to the board outline: the names of the tags on each sticky and card.
import { defineOutline, type OutlineFacts, type Tag } from '@freero/shared';
import { isTaggable } from './lib/tags';

export default defineOutline({
  annotate(ctx) {
    const tags = ctx.collection<Tag>('tags');
    const items = new Map<string, OutlineFacts>();
    for (const el of ctx.elements()) {
      if (!isTaggable(el) || !el.tags?.length) continue;
      const names = el.tags.flatMap((id) => {
        const name = tags.get(id)?.name?.trim();
        return name ? [name] : [];
      });
      if (names.length) items.set(el.id, { tags: names });
    }
    return { items };
  },
});
