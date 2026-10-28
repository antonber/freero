// How mind maps read in the board outline: a tree. Each node nests under its parent; the root is
// one standalone item (never part of a proximity cluster).
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: {
    mindmap: (el, ctx) => ({
      text: ctx.plain(el.text),
      parentId: el.parentId,
      standalone: !el.parentId,
      fields: { collapsed: el.collapsed || null },
    }),
  },
});
