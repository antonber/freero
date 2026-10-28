import { afterEach, describe, expect, it } from 'vitest';
import type { CommentMessage, CommentThread } from '@freero/shared';
import { createTestBoard, type Editor, type TestBoard } from '@engine';
import manifest from './feature';
import { decodeMentions, encodeMentions, mentionQuery } from './lib/mentions';
import { anchorFor, assembleThreads, isUnread, threadPoint, upgradeLegacy } from './lib/model';
import { authorName } from './lib/people';
import { deleteMessage, deleteThread, editMessage, getThreads, replaceInMessages, reply, setResolved, startDraft, submitDraft, toggleReaction } from './lib/state';

// ---------------------------------------------------------------------------
// Several people writing one thread: real engine replicas (real Yjs docs) that only see each
// other's writes on sync(), so everything between two syncs is concurrent.
// ---------------------------------------------------------------------------
let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

function twoPeople(users: [string, string] = ['ann', 'bob']): [Editor, Editor] {
  let clock = 1_000;
  board = createTestBoard({ users, features: [manifest], now: () => ++clock });
  const [a, b] = board.editors('comments');
  return [a, b];
}

function startThread(editor: Editor, text: string): string {
  startDraft(editor, { x: 10, y: 20, elementId: null });
  return submitDraft(editor, text)!;
}

const texts = (t: CommentThread | undefined) => t?.messages.map((m) => m.text);
const msgId = (editor: Editor, threadId: string, text: string) =>
  getThreads(editor).find((t) => t.id === threadId)!.messages.find((m: CommentMessage) => m.text === text)!.id;

describe('two people writing the same thread at once', () => {
  it('keeps both replies, an edit, a delete, both reactions and a resolve made at the same moment', () => {
    const [ann, bob] = twoPeople();
    const id = startThread(ann, 'first');
    reply(bob, id, 'oops');
    board!.sync();
    const first = msgId(ann, id, 'first');

    // All of this happens before either side hears from the other.
    reply(ann, id, 'from ann');
    editMessage(ann, id, first, 'first (edited)');
    toggleReaction(ann, id, first, '👍');
    reply(bob, id, 'from bob');
    deleteMessage(bob, id, msgId(bob, id, 'oops'));
    toggleReaction(bob, id, first, '👍');
    setResolved(bob, id, true);
    board!.sync();

    const [mine, theirs] = [getThreads(ann), getThreads(bob)];
    expect(mine).toEqual(theirs);
    const t = mine.find((x) => x.id === id);
    expect(texts(t)).toEqual(['first (edited)', 'from ann', 'from bob']);
    expect(t?.messages[0].reactions['👍']).toEqual(['ann', 'bob']);
    expect(t?.resolved).toBe(true);
  });

  it('a message deleted on one device stays deleted when its author edits it on another at the same time', () => {
    const [phone, laptop] = twoPeople(['ann', 'ann']);
    const id = startThread(phone, 'keep');
    reply(phone, id, 'typo');
    board!.sync();
    const typo = msgId(phone, id, 'typo');

    deleteMessage(phone, id, typo);
    editMessage(laptop, id, typo, 'typo fixed');
    board!.sync();

    expect(texts(getThreads(phone)[0])).toEqual(['keep']);
    expect(getThreads(laptop)).toEqual(getThreads(phone));
  });

  it('a deleted thread does not come back because someone replied to it at the same moment', () => {
    const [ann, bob] = twoPeople();
    const id = startThread(ann, 'first');
    board!.sync();

    deleteThread(ann, id);
    reply(bob, id, 'late reply');
    board!.sync();

    expect(getThreads(ann)).toEqual([]);
    expect(getThreads(bob)).toEqual([]);
  });
});

describe('find & replace in comments', () => {
  it('rewrites only the replacer’s own messages, never words someone else wrote', () => {
    const [ann, bob] = twoPeople();
    const id = startThread(ann, 'ship the Beta');
    reply(bob, id, 'beta is late');
    board!.sync();
    expect(replaceInMessages(ann, 'beta', 'GA')).toBe(1);
    board!.sync();
    expect(texts(getThreads(bob).find((t) => t.id === id))).toEqual(['ship the GA', 'beta is late']);
  });
});

describe('boards from before the keyed layout', () => {
  it('keeps a whole-thread value’s messages, reactions and resolved state after upgrading it', () => {
    const legacy = {
      id: 't1',
      x: 5,
      y: 6,
      elementId: null,
      resolved: true,
      createdAt: 1,
      messages: [
        { id: 'm1', authorId: 'ann', authorName: 'Ann', text: 'hi', createdAt: 1, reactions: { '🎉': ['bob'] } },
        { id: 'm2', authorId: 'bob', authorName: 'Bob', text: 'yo', createdAt: 2 },
      ],
    };
    const [t] = assembleThreads(upgradeLegacy('t1', legacy)!);
    expect(texts(t)).toEqual(['hi', 'yo']);
    expect(t.messages[0].reactions).toEqual({ '🎉': ['bob'] });
    expect(t.resolved).toBe(true);
    expect(t.createdBy).toBe('ann');
  });
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

  it('a corner pin stays just outside the item’s top-right corner (same screen gap) after a resize, at any zoom', () => {
    const pin = { x: 200, y: 0, elementId: 'e', corner: 'top-right' as const };
    const resized = { x: 0, y: 0, w: 320, h: 80, rotation: 0 };
    for (const zoom of [0.5, 1, 2]) {
      const p = threadPoint(pin, resized, zoom);
      // Outside the box: right of its right edge and above its top edge, by the same screen px.
      expect((p.x - 320) * zoom).toBeGreaterThan(4);
      expect(-p.y * zoom).toBeCloseTo((p.x - 320) * zoom);
    }
  });
});

describe('unread', () => {
  const msg = (id: string, authorId: string, createdAt: number, editedAt?: number): CommentMessage => ({ id, authorId, authorName: authorId, text: id, createdAt, editedAt, reactions: {} });
  const thread = (messages: CommentMessage[]): CommentThread => ({
    id: 't1', x: 0, y: 0, elementId: null, corner: null, resolved: false, messages, createdAt: messages[0].createdAt, createdBy: messages[0].authorId,
  });

  it('my own replies and edits never make a thread unread for me', () => {
    expect(isUnread(thread([msg('a', 'ann', 1), msg('b', 'me', 5, 9)]), 1, 'me')).toBe(false);
  });

  it('a reply from someone else after I last looked makes it unread', () => {
    expect(isUnread(thread([msg('a', 'ann', 1), msg('b', 'bob', 7)]), 5, 'me')).toBe(true);
  });
});

describe('@mentions', () => {
  it('only names picked from the member list become mentions, and a mention survives being edited', () => {
    const picks = [{ id: 'u-ann', name: 'Ann' }, { id: 'u-annlee', name: 'Ann Lee' }];
    // Typed by hand (nothing picked): plain text, nobody is mentioned or notified.
    expect(encodeMentions('ask @Ann', [])).toBe('ask @Ann');
    // The longer picked name wins; a name inside a longer word is not that person.
    const stored = encodeMentions('@Ann Lee and @Ann, not @Annabel', picks);
    expect(stored).toBe('<@u-annlee> and <@u-ann>, not @Annabel');
    // Editing shows names; saving unchanged text stores exactly the same mentions.
    const names: Record<string, string> = { 'u-ann': 'Ann', 'u-annlee': 'Ann Lee' };
    const shown = decodeMentions(stored, (id) => names[id]);
    expect(shown.text).toBe('@Ann Lee and @Ann, not @Annabel');
    expect(encodeMentions(shown.text, shown.picks)).toBe(stored);
  });

  it('find & replace in my comments never rewrites the user id inside a mention', () => {
    const [ann] = twoPeople();
    const id = startThread(ann, 'ping <@bob> about bob');
    expect(replaceInMessages(ann, 'bob', 'Rob')).toBe(1);
    expect(texts(getThreads(ann).find((t) => t.id === id))).toEqual(['ping <@bob> about Rob']);
  });

  it('an email typed after @ is one query (to invite them), while an address in running text opens nothing', () => {
    expect(mentionQuery('hi @kim@example.com', 19)).toEqual({ start: 3, query: 'kim@example.com' });
    expect(mentionQuery('mail kim@example.com', 20)).toBeNull();
  });
});

// KAI-187: the stored name is whatever the writing client put there.
describe('who a comment is shown as', () => {
  const person = (id: string, name: string) => ({ id, name, color: '#1C7ED6', avatarUrl: null });
  it('reads as its author’s current name whatever name the record carries, and a guest’s always reads as a guest', () => {
    expect(authorName({ authorId: 'u1', authorName: 'Jane Doe (CEO)' }, { u1: person('u1', 'Mallory') })).toBe('Mallory');
    expect(authorName({ authorId: 'guest_x', authorName: 'Ana' }, {})).toBe('Guest · Ana');
    // Accounts that are gone keep what the purge wrote.
    expect(authorName({ authorId: 'gone', authorName: 'Deleted user' }, {})).toBe('Deleted user');
  });
});
