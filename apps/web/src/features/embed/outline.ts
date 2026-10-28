// How link cards read in the board outline.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: {
    embed: (el) => ({ title: el.title ?? '', text: el.description ?? '', fields: { url: el.url, site: el.siteName } }),
  },
});
