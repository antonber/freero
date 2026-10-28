// How connectors read in the board outline: not items but edges between the items at their ends,
// with their labels and which way the arrowheads point.
import { defineOutline, type CapStyle } from '@freero/shared';

const pointy = (cap: CapStyle) => cap === 'arrow' || cap === 'triangle';

export default defineOutline({
  kinds: {
    connector: (c, ctx) => {
      const head = pointy(c.endCap);
      const tail = pointy(c.startCap);
      return {
        edge: {
          from: c.start.elementId ?? null,
          to: c.end.elementId ?? null,
          label: [c.label, ...(c.labels ?? []).map((l) => l.text)]
            .map((t) => ctx.plain(t).trim())
            .filter(Boolean)
            .join(' · '),
          arrow: head && tail ? 'both' : head ? 'forward' : tail ? 'backward' : 'none',
        },
      };
    },
  },
});
