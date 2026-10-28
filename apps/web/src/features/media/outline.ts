// How video / audio items and file cards read in the board outline: by file name, with what kind
// of file it is.
import { defineOutline } from '@freero/shared';

/** "Q3 plan.XLSX" → "xlsx" (display only; the outline never opens the file). */
const extensionOf = (name: string) => /\.([A-Za-z0-9]{1,10})$/.exec(name.trim())?.[1].toLowerCase() ?? null;

export default defineOutline({
  kinds: {
    media: (el) => ({
      title: el.name,
      variant: el.kind,
      fields: { seconds: el.duration > 0 ? Math.round(el.duration) : null },
    }),
    file: (el) => ({
      title: el.name,
      fields: { extension: extensionOf(el.name), bytes: el.size || null },
    }),
  },
});
