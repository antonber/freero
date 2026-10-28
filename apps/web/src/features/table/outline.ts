// How tables read in the board outline: their cells as plain text, row by row. Cells live in
// the `tableCells` collection (layout: TableElement in @freero/shared), read here only for
// tables the reader can see.
import { defineOutline, tableCellKey } from '@freero/shared';

const CELLS = 'tableCells';

export default defineOutline({
  kinds: {
    table: (el, ctx) => {
      const cells = ctx.collection<string>(CELLS);
      const rows = el.rows.map((r) => el.cols.map((c) => ctx.plain(cells.get(tableCellKey('t', el.id, r.id, c.id)) ?? '')));
      return { rows, standalone: true, fields: { size: `${el.rows.length}×${el.cols.length}`, header: el.header || null } };
    },
  },
});
