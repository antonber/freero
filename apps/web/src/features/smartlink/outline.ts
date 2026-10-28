// How smart links read in the board outline: the address only. The board stores no title for the
// target (each reader resolves it with their own access), so the outline can't carry one either.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: {
    objectlink: (el) => ({ text: '', fields: { link: el.uri } }),
  },
});
