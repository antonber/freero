// How emoji and stamps read in the board outline. A reaction stamp riding on an item
// (attachedTo) is listed under that item by the outline builder.
import { defineOutline } from '@freero/shared';

const STAMP_PREFIX = 'stamp:';

export default defineOutline({
  kinds: {
    emoji: (el) => ({
      text: el.emoji.startsWith(STAMP_PREFIX) ? `${el.emoji.slice(STAMP_PREFIX.length).replace(/[-_]/g, ' ')} stamp` : el.emoji,
    }),
  },
});
