// How timelines read in the board outline: the timeline with its range, its lanes in order, and in
// each lane the bars, milestones and cards there (by the same lane rule the layout uses). Cards
// read as cards, with their start and due dates.
import { defineOutline } from '@freero/shared';
import { gridOf, laneAt } from './lib/layout';

export default defineOutline({
  kinds: {
    timeline: (t, ctx) => {
      const g = gridOf(t);
      return {
        title: ctx.plain(t.title),
        standalone: true,
        fields: { start: t.start, end: t.end, scale: t.scale },
        sections: t.lanes.map((l) => ({ id: l.id, title: ctx.plain(l.title) })),
        sectionOf: (child) => t.lanes[laneAt(g, child.y + child.h / 2 - t.y)]?.id ?? null,
      };
    },
    timelinebar: (b, ctx) => ({
      title: ctx.plain(b.title),
      variant: b.milestone ? 'milestone' : undefined,
      fields: { start: b.start, end: b.end },
    }),
  },
});
