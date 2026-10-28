// How task cards read in the board outline: title, description and their task fields.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: {
    card: (el, ctx) => ({
      title: el.title,
      text: ctx.plain(el.description),
      fields: {
        status: el.status,
        due: el.dueDate,
        assignee: el.assigneeId ? (ctx.personName(el.assigneeId) ?? 'someone') : null,
      },
    }),
  },
});
