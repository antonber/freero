// How live activities read in the board outline: the question, its choices, and the results the
// server published (nothing more than everyone sees on the board; sealed results stay sealed).
import { defineOutline, type ActivityResults } from '@freero/shared';

export default defineOutline({
  kinds: {
    activity: (el, ctx) => {
      const r = ctx.collection<ActivityResults>('engageResults').get(el.id);
      const text = (id: string) => el.options.find((o) => o.id === id)?.text ?? '';
      const rows: string[][] = [];
      if (r && !r.sealed) {
        for (const p of r.poll ?? []) rows.push([text(p.optionId), `${p.count}`]);
        for (const w of r.words ?? []) rows.push([w.word, `${w.count}`]);
        for (const k of r.ranking ?? []) rows.push([text(k.optionId), `${k.points} points`]);
        for (const g of r.rating ?? []) rows.push([text(g.optionId), g.count ? `${g.avg} of ${el.scale ?? 5}` : '']);
        for (const q of r.questions ?? []) rows.push([q.text, `${q.votes} upvotes${q.answered ? ', answered' : ''}`]);
      }
      return {
        variant: el.kind,
        title: ctx.plain(el.question),
        text: rows.length ? undefined : el.options.map((o) => o.text).join('\n') || undefined,
        fields: {
          answers: r?.respondents ?? 0,
          results: r?.sealed ? 'hidden until revealed' : 'shown',
          anonymous: el.anonymous,
          closed: !!el.closed,
        },
        ...(rows.length ? { rows } : {}),
      };
    },
  },
});
