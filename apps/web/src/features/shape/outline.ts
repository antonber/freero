// How shapes read in the board outline: their text, and the outline as a variant (a diamond is a
// decision in a flowchart).
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: { shape: (el, ctx) => ({ text: ctx.plain(el.text), variant: el.shape }) },
});
