// How emoji, stamps and stickers read in the board outline. A reaction stamp riding on an item
// (attachedTo) is listed under that item by the outline builder. A team sticker (`img:`) reads by
// its name.
import { defineOutline } from '@freero/shared';

const STAMP_PREFIX = 'stamp:';
const CUSTOM_PREFIX = 'img:';

export default defineOutline({
  kinds: {
    emoji: (el) => ({
      text: el.emoji.startsWith(STAMP_PREFIX)
        ? `${el.emoji.slice(STAMP_PREFIX.length).replace(/[-_]/g, ' ')} stamp`
        : el.emoji.startsWith(CUSTOM_PREFIX)
          ? `${el.name?.trim() || 'team'} sticker`
          : el.emoji,
    }),
  },
});
