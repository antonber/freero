// How kanban boards read in the board outline: the board with its fields (a kanban is a
// collection: the field it is grouped by — "Stage" unless its view says otherwise — makes its
// columns), what it is grouped by and its swimlanes, its columns in order, and in each column the
// items stacked there (by the same column rule the layout uses). A collapsed column, or one
// showing only its first cards, still lists all of its items: they are folded away on the board,
// not gone. Cards read their own values, a swimlane's among them (features/card/outline.ts). The
// board's filter and sort read in words (labels, names); cards the filter leaves out are still
// listed in their column, marked `filtered` (features/card/outline.ts).
import { NO_GROUP, boardView, collectionSchema, defineOutline, describeFilter, describeSort, kanbanColumnAt, savedTabId, viewTabs } from '@freero/shared';

export default defineOutline({
  kinds: {
    kanban: (k, ctx) => {
      const schema = collectionSchema(k);
      const view = boardView(k);
      const group = schema.find((f) => f.id === view.groupBy);
      const rows = view.subGroupBy ? schema.find((f) => f.id === view.subGroupBy) : undefined;
      const tabs = viewTabs(k);
      const active = savedTabId(k);
      // A person column is named after the person; "No <field>" and checkbox columns by their field.
      const title = (c: (typeof k.columns)[number]) =>
        group?.type === 'person' && c.id !== NO_GROUP ? (ctx.personName(c.id) ?? 'someone') : ctx.plain(c.title);
      return {
        title: ctx.plain(k.title),
        standalone: true,
        fields: {
          'grouped by': group?.name ?? null,
          rows: rows?.name ?? null,
          filter: describeFilter(view.filter, schema, ctx.personName) || null,
          sort: describeSort(view.sort, schema) || null,
          'view locked': view.locked ? true : null,
          // Its tabs once it has more than the board (step 3a): the one everyone starts on marked *.
          views: tabs.length > 1 ? tabs.map((t) => `${t.name}${t.id === active ? '*' : ''}${t.layout === 'board' ? '' : ` (${t.layout})`}`).join(', ') : null,
        },
        schema: schema.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          ...(f.options ? { options: f.options.map((o) => ({ id: o.id, label: o.label, ...(o.status ? { status: o.status } : {}) })) } : {}),
        })),
        sections: k.columns.map((c) => ({
          id: c.id,
          title: title(c),
          fields: { status: c.status, wip: c.wip || null, collapsed: c.collapsed ? true : null, shows: c.limit || null },
        })),
        sectionOf: (child) => k.columns[kanbanColumnAt(k, child.x + child.w / 2)]?.id ?? null,
      };
    },
  },
});
