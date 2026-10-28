// How library icons read in the board outline: by name.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: { icon: (el) => ({ text: el.name.replace(/-/g, ' ') }) },
});
