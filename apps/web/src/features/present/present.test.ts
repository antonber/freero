import { describe, expect, it } from 'vitest';
import type { FrameElement } from '@freero/shared';
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
