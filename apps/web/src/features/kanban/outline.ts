// How kanban boards read in the board outline: the board, its columns in order, and in each
// column the items stacked there (by the same column rule the layout uses).
import { defineOutline } from '@freero/shared';
import { columnIndexAt } from './lib/layout';

export default defineOutline({
  kinds: {
    kanban: (k, ctx) => ({
      title: ctx.plain(k.title),
      standalone: true,
      sections: k.columns.map((c) => ({ id: c.id, title: ctx.plain(c.title), fields: { status: c.status, wip: c.wip || null } })),
      sectionOf: (child) => k.columns[columnIndexAt(k, child.x + child.w / 2)]?.id ?? null,
    }),
  },
});
