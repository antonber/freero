import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { messageEvents, type CommentMessageEvent } from './comments';

/** Applies `write` as one change of the comments map and returns the events the server derives. */
function eventsOf(doc: Y.Doc, authorId: string, write: (m: Y.Map<unknown>) => void): CommentMessageEvent[] {
  const comments = doc.getMap<unknown>('comments');
  let out: CommentMessageEvent[] = [];
  const observer = (e: Y.YMapEvent<unknown>) => (out = messageEvents('b1', comments, e.changes.keys, authorId));
  comments.observe(observer);
  doc.transact(() => write(comments));
  comments.unobserve(observer);
  return out;
}

const msg = (id: string, authorId: string, text: string) => ({ kind: 'message', threadId: 't1', id, authorId, authorName: authorId, text, createdAt: Date.now() });

it('only messages a socket writes under its own user id count, and only when their text is new or changed', () => {
  const doc = new Y.Doc();
  eventsOf(doc, 'ann', (m) => {
    m.set('t:t1', { kind: 'thread', id: 't1', createdBy: 'ann' });
    m.set('m:t1:a', msg('a', 'ann', 'first'));
    m.set('m:t1:y', msg('y', 'cy', 'me too'));
    m.set('m:t1:gone', msg('gone', 'dan', 'deleted later'));
    m.set('x:t1:gone', { kind: 'deleted', threadId: 't1', messageId: 'gone' });
  });

  // Bob's socket writing a message that claims to be Ann's: nothing is notified in Ann's name.
  expect(eventsOf(doc, 'bob', (m) => m.set('m:t1:b', msg('b', 'ann', `spoofed <@cy>`)))).toEqual([]);
  doc.getMap('comments').delete('m:t1:b');

  const [reply] = eventsOf(doc, 'bob', (m) => m.set('m:t1:c', msg('c', 'bob', 'a reply')));
  expect(reply).toMatchObject({ authorId: 'bob', messageId: 'c', previousText: null });
  // The thread's creator and other writers — not deleted messages' authors, not Bob himself.
  expect(reply.participantIds.sort()).toEqual(['ann', 'cy']);

  // Rewriting a message without changing its text (author name, color) is not news.
  expect(eventsOf(doc, 'bob', (m) => m.set('m:t1:c', { ...msg('c', 'bob', 'a reply'), authorName: 'Robert' }))).toEqual([]);
  const [edit] = eventsOf(doc, 'bob', (m) => m.set('m:t1:c', msg('c', 'bob', 'a better reply')));
  expect(edit).toMatchObject({ previousText: 'a reply', text: 'a better reply' });
});

it('only a thread’s first message starts a thread (#104): a reply, an edit of the first message or a message after all were deleted does not', () => {
  const doc = new Y.Doc();
  const [first] = eventsOf(doc, 'ann', (m) => {
    m.set('t:t1', { kind: 'thread', id: 't1', createdBy: 'ann' });
    m.set('m:t1:a', msg('a', 'ann', 'kickoff'));
  });
  expect(first.newThread).toBe(true);
  expect(eventsOf(doc, 'ann', (m) => m.set('m:t1:a', msg('a', 'ann', 'kickoff!')))[0].newThread).toBeUndefined();
  expect(eventsOf(doc, 'bob', (m) => m.set('m:t1:b', msg('b', 'bob', 'a reply')))[0].newThread).toBeUndefined();
  eventsOf(doc, 'ann', (m) => m.set('x:t1:a', { kind: 'deleted', threadId: 't1', messageId: 'a' }));
  eventsOf(doc, 'bob', (m) => m.set('x:t1:b', { kind: 'deleted', threadId: 't1', messageId: 'b' }));
  expect(eventsOf(doc, 'ann', (m) => m.set('m:t1:c', msg('c', 'ann', 'again')))[0].newThread).toBeUndefined();
});
