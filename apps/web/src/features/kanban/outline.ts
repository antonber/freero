// How kanban boards read in the board outline: the board with its fields (a kanban is a
// collection: the column field "Stage" is its columns), its columns in order, and in each column
// the items stacked there (by the same column rule the layout uses). A collapsed column still
// lists its items: they are folded away on the board, not gone. Cards read their own values
// (features/card/outline.ts).
import { collectionSchema, defineOutline, kanbanColumnAt } from '@freero/shared';

export default defineOutline({
  kinds: {
    kanban: (k, ctx) => ({
      title: ctx.plain(k.title),
      standalone: true,
      schema: collectionSchema(k).map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        ...(f.options ? { options: f.options.map((o) => ({ id: o.id, label: o.label, ...(o.status ? { status: o.status } : {}) })) } : {}),
      })),
      sections: k.columns.map((c) => ({
        id: c.id,
        title: ctx.plain(c.title),
        fields: { status: c.status, wip: c.wip || null, collapsed: c.collapsed ? true : null },
      })),
      sectionOf: (child) => k.columns[kanbanColumnAt(k, child.x + child.w / 2)]?.id ?? null,
    }),
  },
});
