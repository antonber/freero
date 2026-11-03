// How task cards read in the board outline: title, description and their task fields, and on a
// kanban the values of its fields, by field name (select labels, names, ISO dates, numbers), and
// `filtered` when the kanban's filter leaves it out (folded away on the board, still its card).
import { boardView, cardPasses, cardValue, collectionSchema, defineOutline, valueText } from '@freero/shared';

export default defineOutline({
  kinds: {
    card: (el, ctx) => {
      const fields: Record<string, string | number | boolean | null | undefined> = {
        status: el.status,
        start: el.startDate ?? null,
        due: el.dueDate,
        estimate: el.estimate ?? null,
        assignee: el.assigneeId ? (ctx.personName(el.assigneeId) ?? 'someone') : null,
        // A flip card (#142): its back, and which side shows.
        ...(el.back ? { back: ctx.plain(el.back.title), showing: el.flipped ? 'back' : 'front' } : {}),
      };
      const k = el.frameId ? ctx.element(el.frameId) : undefined;
      if (k?.type === 'kanban') {
        const schema = collectionSchema(k);
        const { filter } = boardView(k);
        if (filter && !cardPasses(k, el, filter, schema)) fields.filtered = true;
        for (const f of schema) {
          const v = cardValue(k, el, f);
          // A built-in key keeps its meaning (custom fields can't take those names).
          if (v === null || Object.hasOwn(fields, f.name) || f.name === '__proto__') continue;
          fields[f.name] = typeof v === 'number' || v === true ? v : valueText(f, v, ctx.personName);
        }
      }
      return { title: el.title, text: ctx.plain(el.description), fields };
    },
  },
});
