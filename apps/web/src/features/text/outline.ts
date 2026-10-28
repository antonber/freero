// How text boxes read in the board outline. An empty text box says nothing and is left out.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: {
    text: (el, ctx) => {
      const text = ctx.plain(el.text);
      return text.trim() ? { text } : null;
    },
  },
});
