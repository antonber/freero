// How kanban boards read in the board outline: the board with its fields (a kanban is a
// collection: the field it is grouped by — "Stage" unless its view says otherwise — makes its
// columns), what it is grouped by and its swimlanes, its columns in order, and in each column the
// items stacked there (by the same column rule the layout uses). A collapsed column, or one
// showing only its first cards, still lists all of its items: they are folded away on the board,
// not gone. Cards read their own values, a swimlane's among them (features/card/outline.ts). The
// board's filter and sort read in words (labels, names); cards the filter leaves out are still
// listed in their column, marked `filtered` (features/card/outline.ts).
import {
  NO_GROUP,
  boardView,
  calendarDateField,
  collectionSchema,
  dateFields,
  defineOutline,
  describeFilter,
  describeSort,
  kanbanColumnAt,
  listGroupField,
  projectionView,
  savedTabId,
  timelineFields,
  viewTabs,
  type FieldDef,
  type KanbanElement,
} from '@freero/shared';

/** "table", "list by Stage", "calendar by Due date", "timeline from Start date to Due date in lanes by Team". */
function tabWords(k: KanbanElement, id: string, schema: readonly FieldDef[]): string {
  const v = projectionView(k, id);
  if (!v) return 'view';
  const date = (ref: string) => dateFields(schema).find((f) => f.id === ref)?.name ?? ref;
  switch (v.layout) {
    case 'table':
      return 'table';
    case 'list': {
      const g = listGroupField(k, v, schema);
      return g ? `list by ${g.name}` : 'list';
    }
    case 'calendar':
      return `calendar by ${date(calendarDateField(v, schema))}`;
    case 'timeline': {
      const t = timelineFields(v, schema);
      return `timeline from ${date(t.start)} to ${date(t.end)}${t.lanes ? ` in lanes by ${t.lanes.name}` : ''}`;
    }
  }
}

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
          // Its tabs once it has more than the board (steps 3a, 3b): the one everyone starts on
          // marked *, each with its layout and what places its cards (a list's groups, a
          // calendar's date field, a timeline's dates and swimlanes).
          views: tabs.length > 1 ? tabs.map((t) => `${t.name}${t.id === active ? '*' : ''}${t.layout === 'board' ? '' : ` (${tabWords(k, t.id, schema)})`}`).join(', ') : null,
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
