// How kanban boards read in the board outline: the board, its columns in order, and in each
// column the items stacked there (by the same column rule the layout uses). A collapsed column
// still lists its items: they are folded away on the board, not gone.
import { defineOutline, kanbanColumnAt } from '@freero/shared';

export default defineOutline({
  kinds: {
    kanban: (k, ctx) => ({
      title: ctx.plain(k.title),
      standalone: true,
      sections: k.columns.map((c) => ({
        id: c.id,
        title: ctx.plain(c.title),
        fields: { status: c.status, wip: c.wip || null, collapsed: c.collapsed ? true : null },
      })),
      sectionOf: (child) => k.columns[kanbanColumnAt(k, child.x + child.w / 2)]?.id ?? null,
    }),
  },
});
