// What comments add to the board outline: each thread on the item it is pinned to (or on the
// board), with authors by their current name and @mentions resolved. Deleted threads and
// messages never appear (assembleThreads honours the tombstones).
import { defineOutline, type OutlineFacts, type OutlineThread } from '@freero/shared';
import { assembleThreads } from './lib/model';

const COLLECTION = 'comments';

export default defineOutline({
  annotate(ctx) {
    const threads = assembleThreads([...ctx.collection(COLLECTION)]);
    const items = new Map<string, OutlineFacts>();
    const comments: OutlineThread[] = [];
    for (const t of threads) {
      const thread: OutlineThread = {
        id: t.id,
        ...(t.resolved ? { resolved: true as const } : {}),
        messages: t.messages.map((m) => ({
          id: m.id,
          authorId: m.authorId,
          author: ctx.personName(m.authorId) ?? m.authorName,
          text: ctx.mentions(m.text),
          at: m.createdAt,
        })),
      };
      if (!t.elementId) {
        comments.push(thread);
        continue;
      }
      const facts = items.get(t.elementId) ?? {};
      facts.comments = [...(facts.comments ?? []), thread];
      items.set(t.elementId, facts);
    }
    return { items, comments };
  },
});
