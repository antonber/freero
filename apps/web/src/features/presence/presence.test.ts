import { describe, expect, it } from 'vitest';
import { cameraToShow, newSignals, peopleOnBoard, takeToken, type Peer, type PresenceExt } from './lib/model';

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

describe('following someone', () => {
  it('shows everything they see when your screen is smaller than theirs', () => {
    const theirs = { x: 100, y: 50, zoom: 2, width: 1600, height: 1000 };
    const cam = cameraToShow(theirs, { width: 800, height: 800 });
    const visible = (c: { x: number; y: number; zoom: number }, w: number, h: number) => ({ x0: c.x, y0: c.y, x1: c.x + w / c.zoom, y1: c.y + h / c.zoom });
    const mine = visible(cam, 800, 800);
    const them = visible(theirs, 1600, 1000);
    expect(mine.x0).toBeLessThanOrEqual(them.x0 + 1e-9);
    expect(mine.y0).toBeLessThanOrEqual(them.y0 + 1e-9);
    expect(mine.x1).toBeGreaterThanOrEqual(them.x1 - 1e-9);
    expect(mine.y1).toBeGreaterThanOrEqual(them.y1 - 1e-9);
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

  it('ignores reaction payloads with emoji outside the picker (untrusted peers)', () => {
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
