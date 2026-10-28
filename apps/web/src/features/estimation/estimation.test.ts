import { describe, expect, it } from 'vitest';
import { createTestBoard } from '@engine';
import manifest from './feature';
import { COLLECTION, getRound, pick, reveal, start } from './lib/actions';
import { DECKS, estimatesOf, results, type Estimate, type EstimationValue } from './lib/model';

const deck = { kind: 'fibonacci' as const, values: DECKS.fibonacci.values };
const est = (userId: string, value: string): Estimate => ({ roundId: 'r', itemId: 'i', userId, userName: userId, userColor: '#000', value });

describe('planning poker', () => {
  it('before an item is revealed the other replicas learn only who picked a card, never which; revealing shows it', () => {
    const board = createTestBoard({ users: ['ana', 'ben'], features: [manifest] });
    const [ana, ben] = board.editors('estimation');
    const card = ana.create({ type: 'sticky', x: 0, y: 0 } as never);
    start(ana, [card], deck);
    board.sync();
    pick(ana, '13');
    board.sync();

    const round = getRound(ben)!;
    const seen = ben.collection<EstimationValue>(COLLECTION).entries();
    expect(seen.some(([, v]) => 'value' in (v as object))).toBe(false);
    expect(estimatesOf(seen, round, card).map((e) => e.userId)).toEqual(['ana']);

    reveal(ana);
    board.sync();
    const after = estimatesOf(ben.collection<EstimationValue>(COLLECTION).entries(), getRound(ben)!, card);
    expect(after.map((e) => e.value)).toEqual(['13']);
    expect(getRound(ben)!.revealed).toBe(true);
    board.destroy();
  });

  it('results: "?" never counts, a tie goes to the larger estimate, and a pick two cards away is flagged', () => {
    const r = results([est('a', '3'), est('b', '5'), est('c', '3'), est('d', '5'), est('e', '13'), est('f', '?')], deck);
    expect(r.suggestion).toBe('5');
    expect(r.average).toBe(5.8);
    expect(r.median).toBe(5);
    expect([r.min, r.max]).toEqual(['3', '13']);
    expect(r.outliers).toEqual(['e']);
    expect(r.consensus).toBe(false);
  });
});
