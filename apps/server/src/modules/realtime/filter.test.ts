import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { decideUpdate } from './filter';

// Ana started thread t1 (message m1) on element e1; Ben replied (m2) and reacted to m1.
// Dan is the commenter whose updates are checked.
const thread = { kind: 'thread', id: 't1', x: 0, y: 0, elementId: 'e1', corner: null, createdAt: 1, createdBy: 'ana' };
const msg = (id: string, authorId: string, text: string) => ({ kind: 'message', threadId: 't1', id, authorId, authorName: authorId, text, createdAt: 1 });
const reaction = (messageId: string, userId: string, emoji = '👍') => ({ kind: 'reaction', threadId: 't1', messageId, userId, emoji });

/** A server doc with some content, plus a client doc synced to it. */
function setup() {
  const server = new Y.Doc();
  const els = server.getMap<Y.Map<unknown>>('elements');
  const el = new Y.Map<unknown>();
  el.set('type', 'sticky');
  el.set('text', 'hello');
  els.set('e1', el);
  const comments = server.getMap('comments');
  comments.set('t:t1', thread);
  comments.set('m:t1:m1', msg('m1', 'ana', 'first'));
  comments.set('m:t1:m2', msg('m2', 'ben', 'reply'));
  comments.set('r:t1:m1:ben:👍', reaction('m1', 'ben'));

  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return { server, client };
}

/** Runs fn on the client and returns the resulting incremental update. */
function edit(client: Y.Doc, fn: (comments: Y.Map<unknown>, doc: Y.Doc) => void): Uint8Array {
  const before = Y.encodeStateVector(client);
  client.transact(() => fn(client.getMap('comments'), client));
  return Y.encodeStateAsUpdate(client, before);
}

/** Dan's (commenter) update, applied to the server when accepted so later edits build on it. */
function asDan(server: Y.Doc, update: Uint8Array) {
  const d = decideUpdate('commenter', server, update, 'dan');
  if (d === 'apply') Y.applyUpdate(server, update);
  return d;
}

describe('decideUpdate', () => {
  it('does not block legitimate edits from owners and editors', () => {
    const { server, client } = setup();
    const u = edit(client, (_c, d) => d.getMap('elements').set('e2', 'x'));
    expect(decideUpdate('owner', server, u, 'ana')).toBe('apply');
    expect(decideUpdate('editor', server, u, 'ben')).toBe('apply');
  });

  it('does not let a viewer write elements or comments', () => {
    const { server, client } = setup();
    expect(decideUpdate('viewer', server, edit(client, (_c, d) => d.getMap('elements').set('e2', 'x')), 'dan')).toBe('drop');
    expect(decideUpdate('viewer', server, edit(client, (c) => c.set('s:t1', { kind: 'status', threadId: 't1', resolved: true, by: 'dan', at: 2 })), 'dan')).toBe('drop');
  });

  it('does not block what a commenter does with their own comments (thread, reply, edit, react, resolve, delete)', () => {
    const { server, client } = setup();
    expect(
      asDan(server, edit(client, (c) => {
        c.set('t:t2', { ...thread, id: 't2', elementId: null, createdBy: 'dan' });
        c.set('m:t2:d1', { ...msg('d1', 'dan', 'mine'), threadId: 't2' });
      })),
    ).toBe('apply');
    expect(asDan(server, edit(client, (c) => c.set('m:t1:d2', msg('d2', 'dan', 'me too'))))).toBe('apply');
    expect(asDan(server, edit(client, (c) => c.set('m:t1:d2', { ...msg('d2', 'dan', 'me too!'), editedAt: 3 })))).toBe('apply');
    expect(asDan(server, edit(client, (c) => c.set('r:t1:m1:dan:🎉', reaction('m1', 'dan', '🎉'))))).toBe('apply');
    expect(asDan(server, edit(client, (c) => c.delete('r:t1:m1:dan:🎉')))).toBe('apply');
    // Resolving is shared workflow state: anyone who may comment resolves anyone's thread.
    expect(asDan(server, edit(client, (c) => c.set('s:t1', { kind: 'status', threadId: 't1', resolved: true, by: 'dan', at: 4 })))).toBe('apply');
    // Deleting their own message takes its reactions along, and leaves a tombstone.
    expect(
      asDan(server, edit(client, (c) => {
        c.delete('m:t1:d2');
        c.set('x:t1:d2', { kind: 'deleted', threadId: 't1', messageId: 'd2', by: 'dan', at: 5 });
      })),
    ).toBe('apply');
    // The creator deletes the whole thread, including other people's records in it.
    client.getMap('comments').set('m:t2:b9', { ...msg('b9', 'ben', 'ben in dan thread'), threadId: 't2' });
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client, Y.encodeStateVector(server))); // Ben's reply
    expect(
      asDan(server, edit(client, (c) => {
        for (const k of ['t:t2', 'm:t2:d1', 'm:t2:b9']) c.delete(k);
        c.set('x:t2', { kind: 'deleted', threadId: 't2', by: 'dan', at: 6 });
      })),
    ).toBe('apply');
    // Anyone may detach a thread whose element is gone (only the pin's position changes).
    expect(asDan(server, edit(client, (c) => c.set('t:t1', { ...thread, elementId: null, x: 40, y: 50 })))).toBe('apply');
  });

  it("does not let a commenter rewrite, delete or forge other people's comments and reactions", () => {
    const { server, client } = setup();
    const attempts: Array<[string, (c: Y.Map<unknown>) => void]> = [
      ["edit Ben's message", (c) => c.set('m:t1:m2', { ...msg('m2', 'ben', 'I was wrong'), editedAt: 2 })],
      ["take over Ben's message", (c) => c.set('m:t1:m2', msg('m2', 'dan', 'mine now'))],
      ["delete Ben's message", (c) => c.delete('m:t1:m2')],
      ["delete Ben's message with a tombstone", (c) => {
        c.delete('m:t1:m2');
        c.set('x:t1:m2', { kind: 'deleted', threadId: 't1', messageId: 'm2', by: 'dan', at: 2 });
      }],
      ['post as Ana', (c) => c.set('m:t1:f1', msg('f1', 'ana', 'forged'))],
      ["remove Ben's reaction", (c) => c.delete('r:t1:m1:ben:👍')],
      ['react as Ben', (c) => c.set('r:t1:m2:ben:🎉', reaction('m2', 'ben', '🎉'))],
      ["delete Ana's thread", (c) => {
        for (const k of ['t:t1', 'm:t1:m1', 'm:t1:m2', 'r:t1:m1:ben:👍']) c.delete(k);
        c.set('x:t1', { kind: 'deleted', threadId: 't1', by: 'dan', at: 2 });
      }],
      ["move Ana's thread", (c) => c.set('t:t1', { ...thread, x: 999 })],
      ['resolve in Ana\'s name', (c) => c.set('s:t1', { kind: 'status', threadId: 't1', resolved: true, by: 'ana', at: 2 })],
      ['write a value that is not a comment record', (c) => c.set('t:t9', 'free text')],
      ['nest a shared type', (c) => c.set('m:t1:d9', new Y.Map())],
    ];
    for (const [what, fn] of attempts) expect(decideUpdate('commenter', server, edit(client, fn), 'dan'), what).toBe('drop');
  });

  it('does not let a commenter undo a deletion by removing its tombstone', () => {
    const { server, client } = setup();
    client.getMap('comments').set('x:t1:m2', { kind: 'deleted', threadId: 't1', messageId: 'm2', by: 'ben', at: 2 });
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)));
    expect(decideUpdate('commenter', server, edit(client, (c) => c.delete('x:t1:m2')), 'dan')).toBe('drop');
  });

  it('does not block upgrading a legacy whole-thread value, but does not let the upgrade forge a message', () => {
    const { server, client } = setup();
    const legacy = { id: 'old', x: 1, y: 2, createdAt: 1, messages: [{ id: 'o1', authorId: 'ana', authorName: 'Ana', text: 'legacy', createdAt: 1, reactions: { '👍': ['ben'] } }] };
    client.getMap('comments').set('old', legacy);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)));
    const upgrade = (text: string) =>
      edit(client, (c) => {
        c.set('t:old', { kind: 'thread', id: 'old', x: 1, y: 2, elementId: null, createdAt: 1, createdBy: 'ana' });
        c.set('m:old:o1', { kind: 'message', threadId: 'old', id: 'o1', authorId: 'ana', authorName: 'Ana', text, createdAt: 1 });
        c.set('r:old:o1:ben:👍', { kind: 'reaction', threadId: 'old', messageId: 'o1', userId: 'ben', emoji: '👍' });
        c.delete('old');
      });
    const fork = new Y.Doc();
    Y.applyUpdate(fork, Y.encodeStateAsUpdate(client));
    expect(decideUpdate('commenter', server, edit(fork, (c) => {
      c.set('m:old:o1', { kind: 'message', threadId: 'old', id: 'o1', authorId: 'ana', authorName: 'Ana', text: 'something Ana never said', createdAt: 1 });
      c.delete('old');
    }), 'dan')).toBe('drop');
    expect(decideUpdate('commenter', server, upgrade('legacy'), 'dan')).toBe('apply');
  });

  it('does not let a commenter add, edit nested fields of, or delete elements, or touch settings', () => {
    const { server, client } = setup();
    expect(decideUpdate('commenter', server, edit(client, (_c, d) => d.getMap('elements').set('e2', 'x')), 'dan')).toBe('drop');
    expect(
      decideUpdate('commenter', server, edit(client, (_c, d) => (d.getMap('elements').get('e1') as Y.Map<unknown>).set('text', 'pwned')), 'dan'),
    ).toBe('drop');
    expect(decideUpdate('commenter', server, edit(client, (_c, d) => d.getMap('elements').delete('e1')), 'dan')).toBe('drop');
    expect(decideUpdate('commenter', server, edit(client, (_c, d) => d.getMap('settings').set('grid', 'none')), 'dan')).toBe('drop');
  });

  it('does not let a commenter smuggle an element change inside a comment update', () => {
    const { server, client } = setup();
    const mixed = edit(client, (c, d) => {
      c.set('s:t1', { kind: 'status', threadId: 't1', resolved: true, by: 'dan', at: 2 });
      d.getMap('elements').set('e9', 'sneaky');
    });
    expect(decideUpdate('commenter', server, mixed, 'dan')).toBe('drop');
  });

  it('does not let a commenter create new top-level types', () => {
    const { server, client } = setup();
    expect(decideUpdate('commenter', server, edit(client, (_c, d) => d.getArray('whatever').push([1])), 'dan')).toBe('drop');
  });

  it('does not accept a commenter update whose effect cannot be determined (missing dependencies)', () => {
    const { server, client } = setup();
    const status = (resolved: boolean) => ({ kind: 'status', threadId: 't1', resolved, by: 'dan', at: 2 });
    edit(client, (c) => c.set('s:t1', status(true))); // never sent to the server
    const second = edit(client, (c) => c.set('s:t1', status(false)));
    expect(decideUpdate('commenter', server, second, 'dan')).toBe('drop');
  });

  it('does not accept or crash on a malformed update', () => {
    const { server } = setup();
    expect(decideUpdate('commenter', server, new Uint8Array([1, 2, 3, 255, 255]), 'dan')).toBe('drop');
  });

  it('does not leak a rejected update into the live doc while checking it', () => {
    const { server, client } = setup();
    const u = edit(client, (_c, d) => d.getMap('elements').set('e2', 'x'));
    decideUpdate('commenter', server, u, 'dan');
    expect(server.getMap('elements').has('e2')).toBe(false);
  });
});
