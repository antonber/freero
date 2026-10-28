// How images read in the board outline: their alt text, when they have one.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: { image: (el) => ({ text: el.alt ?? '' }) },
});
