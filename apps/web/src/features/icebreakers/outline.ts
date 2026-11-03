// How icebreakers read in the board outline: the widget, its names, and the latest result the
// server published.
import { defineOutline, type IcebreakerResult } from '@freero/shared';

export default defineOutline({
  kinds: {
    icebreaker: (el, ctx) => {
      const r = ctx.collection<IcebreakerResult>('icebreakerResults').get(el.id);
      const result = r ? (r.picked ?? (r.dice ? r.dice.join(' + ') : r.order ? r.order.join(', ') : undefined)) : undefined;
      return {
        variant: el.kind,
        title: el.title,
        text: el.kind === 'dice' ? undefined : el.entries.filter((e) => e.trim()).join('\n') || undefined,
        fields: { result: result ?? null, by: r?.by ?? null },
      };
    },
  },
});
