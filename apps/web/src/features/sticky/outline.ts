// How stickies read in the board outline (see @freero/shared outline/define.ts).
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: { sticky: (el, ctx) => ({ text: ctx.plain(el.text), variant: el.color }) },
});
