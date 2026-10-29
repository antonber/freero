// How tables read in the board outline: their cells as plain text, row by row. Cells live in
// the `tableCells` collection (layout: TableElement in @freero/shared), read here only for
// tables the reader can see. Typed cells (KAI-123) are stored as plain values; people read as
// their names and checkboxes as yes / no. A filter is only a view: every row is listed.
import { defineOutline, tableCellKey } from '@freero/shared';

const CELLS = 'tableCells';

export default defineOutline({
  kinds: {
    table: (el, ctx) => {
      const cells = ctx.collection<string>(CELLS);
      const rows = el.rows.map((r, i) =>
        el.cols.map((c) => {
          const raw = cells.get(tableCellKey('t', el.id, r.id, c.id)) ?? '';
          if (el.header && i === 0) return ctx.plain(raw);
          if (c.type === 'person') return raw ? (ctx.personName(raw) ?? 'Unknown person') : '';
          if (c.type === 'checkbox') return raw === 'true' ? 'yes' : 'no';
          return ctx.plain(raw);
        }),
      );
      const types = el.cols.map((c) => c.type ?? 'text');
      return {
        rows,
        standalone: true,
        fields: {
          size: `${el.rows.length}×${el.cols.length}`,
          header: el.header || null,
          columns: types.some((t) => t !== 'text') ? types.join(', ') : null,
        },
      };
    },
  },
});
