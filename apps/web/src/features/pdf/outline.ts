// How PDF documents read in the board outline: by file name.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: { pdf: (el) => ({ title: el.name, fields: { pages: el.pageCount || null } }) },
});
