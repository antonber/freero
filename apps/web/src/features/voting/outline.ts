// What voting adds to the board outline: each item's votes in the board's vote — only when its
// results may be shown (the vote ended, or results aren't hidden), counted by the same rules as
// the results panel — and one note about the vote.
import { defineOutline, type OutlineFacts } from '@freero/shared';
import { ballotsOf, getSession, isEligible, tally, voters, type VotingValue } from './lib/voting';

export default defineOutline({
  annotate(ctx) {
    const coll = ctx.collection<VotingValue>('voting');
    const session = getSession(coll);
    if (!session) return {};
    const exists = (id: string) => {
      const el = ctx.element(id);
      return !!el && isEligible(session, el);
    };
    const ballots = ballotsOf([...coll], session);
    const showTotals = !session.active || !session.anonymous;
    const title = session.title.trim() ? `"${session.title.trim()}"` : '';
    const note = [
      `Vote ${title}`.trim(),
      session.active ? 'in progress' : 'ended',
      `${voters(ballots, session, exists).length} voted`,
      `${session.votesPerUser} votes each`,
      ...(showTotals ? [] : ['results hidden until it ends']),
    ].join(' · ');
    if (!showTotals) return { notes: [note] };
    const items = new Map<string, OutlineFacts>();
    for (const [id, votes] of tally(session, ballots, exists)) if (votes > 0) items.set(id, { votes });
    return { items, notes: [note] };
  },
});
