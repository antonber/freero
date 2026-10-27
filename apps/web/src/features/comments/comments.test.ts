import { describe, expect, it } from 'vitest';
import { anchorFor, isUnread, ops, reconcile, threadPoint, type StoredMessage, type StoredThread } from './lib/model';

const msg = (id: string, authorId: string, createdAt: number, text = id): StoredMessage => ({ id, authorId, authorName: authorId, text, createdAt });
const thread = (messages: StoredMessage[], extra: Partial<StoredThread> = {}): StoredThread => ({
  id: 't1',
  x: 0,
  y: 0,
  elementId: null,
  resolved: false,
  messages,
  createdAt: messages[0]?.createdAt ?? 0,
  ...extra,
});

describe('pins on items', () => {
  it('keeps a pin on the same spot of an item after the item is moved and rotated', () => {
    const sticky = { id: 's1', x: 100, y: 100, w: 200, h: 100, rotation: 0 };
    const clicked = { x: 280, y: 110 }; // near the top-right corner
    const anchor = anchorFor(clicked, sticky);
    // Rotating 180° about its center puts the top-right corner at the bottom-left.
    const moved = { ...sticky, x: 600, y: 400, rotation: 180 };
    const p = threadPoint(anchor, moved);
    expect(p.x).toBeCloseTo(600 + 20);
    expect(p.y).toBeCloseTo(400 + 90);
  });

  it('pins clicked on a rotated item land exactly where you clicked', () => {
    const el = { id: 'e', x: 0, y: 0, w: 300, h: 120, rotation: 37 };
    const click = { x: 210, y: 140 };
    const p = threadPoint(anchorFor(click, el), el);
    expect(p.x).toBeCloseTo(click.x);
    expect(p.y).toBeCloseTo(click.y);
  });
});

describe('two people writing the same thread at once', () => {
  it('does not lose my reply when another reply wins the concurrent write', () => {
    const base = thread([msg('m0', 'ann', 1)]);
    const mine = ops.addMessage(msg('mine', 'me', 3));
    // Their write (base + their reply) replaced mine on the shared map.
    const winner = ops.addMessage(msg('theirs', 'ann', 2))(base);
    const fixed = reconcile(winner, [mine]);
    expect(fixed?.messages.map((m) => m.id)).toEqual(['m0', 'theirs', 'mine']);
    // Once both are in, re-applying writes nothing (no ping-pong between clients).
    expect(reconcile(fixed!, [mine])).toBeNull();
  });

  it('does not bring back a message I deleted when a stale copy of the thread is written over it', () => {
    const stale = thread([msg('m0', 'ann', 1), msg('oops', 'me', 2)], { resolved: true });
    const fixed = reconcile(stale, [ops.deleteMessage('oops')]);
    expect(fixed?.messages.map((m) => m.id)).toEqual(['m0']);
    expect(fixed?.resolved).toBe(true); // their resolve survives too
  });

  it('keeps my latest edit when I edit the same message twice quickly', () => {
    const t = thread([msg('m', 'me', 1, 'v0')]);
    const pending = [ops.editMessage('m', 'v1', 2), ops.editMessage('m', 'v2', 3)];
    const after = pending.reduce((acc, op) => op(acc), t);
    expect(after.messages[0].text).toBe('v2');
    expect(reconcile(after, pending)).toBeNull();
  });
});

describe('unread', () => {
  it('my own replies and edits never make a thread unread for me', () => {
    const t = thread([msg('a', 'ann', 1), { ...msg('b', 'me', 5), editedAt: 9 }]);
    expect(isUnread(t, 1, 'me')).toBe(false);
  });

  it('a reply from someone else after I last looked makes it unread', () => {
    const t = thread([msg('a', 'ann', 1), msg('b', 'bob', 7)]);
    expect(isUnread(t, 5, 'me')).toBe(true);
  });
});
