import { describe, expect, it } from 'vitest';
import { countReaction, isReactionEmoji, newSignals, newTally, peopleOnBoard, tallyCounts, takeToken, TALLY_WINDOW_MS, type Peer, type PresenceExt } from './lib/model';

const me = { id: 'u-me', name: 'Mia', color: '#111111', avatarUrl: null };
const peer = (clientId: number, userId: string, name: string, ext?: PresenceExt): Peer => ({
  clientId,
  user: { id: userId, name, color: '#222222' },
  cursor: null,
  selection: [],
  viewport: null,
  ext: ext ? { presence: ext } : {},
});

describe('avatar stack', () => {
  it('shows one avatar per person even with several tabs open, and your own other tab is still you', () => {
    const people = peopleOnBoard(me, [peer(1, 'u-zoe', 'Zoe'), peer(2, 'u-zoe', 'Zoe'), peer(3, 'u-me', 'Mia'), peer(4, 'u-al', 'Al')]);
    expect(people.map((p) => p.userId)).toEqual(['u-me', 'u-al', 'u-zoe']);
    expect(people[0].isMe).toBe(true);
    expect(people.find((p) => p.userId === 'u-zoe')!.clients).toHaveLength(2);
  });
});

describe('reaction bursts and summons', () => {
  const pick = (e: PresenceExt) => e.reaction;
  const r = (id: string): PresenceExt => ({ reaction: { id, emoji: '🎉', at: null } });

  it('does not replay a reaction someone sent before you opened the board', () => {
    const seen = new Map<number, string | null>();
    expect(newSignals(seen, [peer(1, 'u-a', 'A', r('old'))], pick)).toHaveLength(0);
  });

  it('shows each new reaction exactly once, including a second one from the same person', () => {
    const seen = new Map<number, string | null>();
    newSignals(seen, [peer(1, 'u-a', 'A')], pick);
    expect(newSignals(seen, [peer(1, 'u-a', 'A', r('r1'))], pick)).toHaveLength(1);
    expect(newSignals(seen, [peer(1, 'u-a', 'A', r('r1'))], pick)).toHaveLength(0); // unrelated presence update
    expect(newSignals(seen, [peer(1, 'u-a', 'A', r('r2'))], pick)).toHaveLength(1);
  });

  it('takes any single emoji from a peer (skin tones, flags, families) but no text, markup or several emoji', () => {
    for (const ok of ['🦄', '👍🏽', '🇵🇪', '👩‍👩‍👧', '❤️', '1️⃣']) expect(isReactionEmoji(ok), ok).toBe(true);
    for (const bad of ['<img src=x>', 'lol', '🎉🎉', '7', '', '🎉 hi']) expect(isReactionEmoji(bad), bad).toBe(false);
    const seen = new Map<number, string | null>();
    newSignals(seen, [peer(1, 'u-a', 'A')], pick);
    const bogus = peer(1, 'u-a', 'A', { reaction: { id: 'x', emoji: '<img src=x>' as never, at: null } });
    expect(newSignals(seen, [bogus], pick)).toHaveLength(0);
  });
});

describe('reaction throttle', () => {
  it('lets a short flurry through, blocks spamming, and recovers after a pause', () => {
    let bucket = { tokens: 3, at: 0 };
    const sent: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      const res = takeToken(bucket, i * 50);
      bucket = res.bucket;
      sent.push(res.ok);
    }
    expect(sent.filter(Boolean)).toHaveLength(3);
    expect(takeToken(bucket, 450 + 1600).ok).toBe(true);
  });
});

describe('reaction counts for the presenter', () => {
  it('one person flooding reactions from several tabs is counted at the burst rate, not once per message', () => {
    const t = newTally();
    for (let i = 0; i < 40; i++) countReaction(t, 'u-spam', '🎉', i * 20);
    countReaction(t, 'u-ann', '👍', 900);
    expect(tallyCounts(t, 1000)).toEqual([
      { emoji: '🎉', count: 3 },
      { emoji: '👍', count: 1 },
    ]);
  });

  it('forgets reactions older than the window', () => {
    const t = newTally();
    countReaction(t, 'u-ann', '👍', 0);
    countReaction(t, 'u-bob', '👏', TALLY_WINDOW_MS - 1000);
    expect(tallyCounts(t, TALLY_WINDOW_MS + 1)).toEqual([{ emoji: '👏', count: 1 }]);
  });
});
