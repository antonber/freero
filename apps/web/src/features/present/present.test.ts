import { describe, expect, it } from 'vitest';
import type { FrameElement } from '@freero/shared';
import { EMPTY_TRAIL, FADE_MS, mergeTrail } from './lib/laser';
import { activePresenter, currentPosition, slides, type Peer } from './lib/model';

const frame = (id: string, index: number): FrameElement => ({
  id,
  type: 'frame',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  z: 0,
  createdBy: 'u',
  createdAt: 0,
  updatedAt: 0,
  title: id,
  fill: '#fff',
  index,
});

describe('staying on the right slide while the deck changes underneath', () => {
  it('keeps presenting the same frame when someone reorders frames mid-presentation', () => {
    const before = slides([frame('A', 0), frame('B', 1), frame('C', 2)]);
    expect(currentPosition(before, 'B', 1)).toBe(1);
    const after = slides([frame('A', 1), frame('B', 2), frame('C', 0)]);
    expect(after[currentPosition(after, 'B', 1)].id).toBe('B');
  });

  it('lands on the neighbour, not back on slide 1, when the current frame is deleted', () => {
    const after = slides([frame('A', 0), frame('B', 1), frame('D', 3)]); // C (position 2) deleted
    expect(after[currentPosition(after, 'C', 2)].id).toBe('D');
    const lastGone = slides([frame('A', 0), frame('B', 1)]);
    expect(lastGone[currentPosition(lastGone, 'C', 2)].id).toBe('B');
  });
});

describe('who is presenting', () => {
  const peer = (clientId: number, userId: string, startedAt: number | null): Peer => ({
    clientId,
    user: { id: userId, name: userId, color: '#000' },
    cursor: null,
    selection: [],
    viewport: null,
    ext: startedAt === null ? {} : { present: { presenting: { frameId: null, startedAt } } },
  });

  it("does not tell you that you are presenting when it's your own other tab", () => {
    expect(activePresenter([peer(1, 'me', 10)], 'me')).toBeNull();
  });

  it('shows the most recent presenter when two people present at once', () => {
    expect(activePresenter([peer(1, 'ann', 10), peer(2, 'bob', 20), peer(3, 'cy', null)], 'me')?.user.id).toBe('bob');
  });
});

describe('skipped slides (KAI-126)', () => {
  it('presents the deck without a skipped slide, and moving on from the slide before it lands on the one after', () => {
    const deck = slides([frame('A', 0), { ...frame('B', 1), skip: true }, frame('C', 2)]);
    expect(deck.map((f) => f.id)).toEqual(['A', 'C']);
    expect(deck[currentPosition(deck, 'A', 0) + 1].id).toBe('C');
  });
});

describe('laser pointer trails', () => {
  it('a faded trail does not come back when presence re-sends the same points with a cursor move', () => {
    const ext = { pts: [[0, 0, 1], [5, 5, 2]] as Array<[number, number, number]> };
    let trail = mergeTrail(EMPTY_TRAIL, ext, 0);
    expect(trail.pts).toHaveLength(2);
    trail = mergeTrail(trail, ext, FADE_MS + 1); // same points again, after they faded
    expect(trail.pts).toHaveLength(0);
    trail = mergeTrail(trail, { pts: [...ext.pts, [9, 9, 3]] }, FADE_MS + 2);
    expect(trail.pts.map((p) => p.n)).toEqual([3]);
  });
});
