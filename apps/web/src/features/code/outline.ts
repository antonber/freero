// How code blocks read in the board outline: the code itself, with its language.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: {
    code: (el) => ({ text: el.code, fields: { language: el.language } }),
  },
});
