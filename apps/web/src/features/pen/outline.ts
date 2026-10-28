// Freehand ink carries no text the outline could read: strokes are left out of it.
import { defineOutline } from '@freero/shared';

export default defineOutline({
  kinds: { pen: () => null },
});
