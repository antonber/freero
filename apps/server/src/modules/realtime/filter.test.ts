import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { changedRoots, decideUpdate } from './filter';

/** A server doc with some content, plus a client doc synced to it. */
function setup() {
  const server = new Y.Doc();
  const els = server.getMap<Y.Map<unknown>>('elements');
  const el = new Y.Map<unknown>();
  el.set('type', 'sticky');
  el.set('text', 'hello');
  els.set('e1', el);
  server.getMap('comments').set('t1', 'first thread');

  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return { server, client };
}

/** Runs fn on the client and returns the resulting incremental update. */
function edit(client: Y.Doc, fn: (doc: Y.Doc) => void): Uint8Array {
  const before = Y.encodeStateVector(client);
  fn(client);
  return Y.encodeStateAsUpdate(client, before);
}

describe('decideUpdate', () => {
  it('does not block legitimate edits from owners and editors', () => {
    const { server, client } = setup();
    const u = edit(client, (d) => d.getMap('elements').set('e2', 'x'));
    expect(decideUpdate('owner', server, u)).toBe('apply');
    expect(decideUpdate('editor', server, u)).toBe('apply');
  });

  it('does not let a viewer write elements or comments', () => {
    const { server, client } = setup();
    expect(decideUpdate('viewer', server, edit(client, (d) => d.getMap('elements').set('e2', 'x')))).toBe('drop');
    expect(decideUpdate('viewer', server, edit(client, (d) => d.getMap('comments').set('t2', 'x')))).toBe('drop');
  });

  it('does not block commenters adding, editing or deleting comment threads', () => {
    const { server, client } = setup();
    const add = edit(client, (d) => {
      const thread = new Y.Map<unknown>();
      thread.set('text', 'nice idea');
      d.getMap('comments').set('t2', thread);
    });
    expect(decideUpdate('commenter', server, add)).toBe('apply');
    Y.applyUpdate(server, add);

    // Nested change inside a comment thread still maps back to 'comments'.
    const nested = edit(client, (d) => (d.getMap('comments').get('t2') as Y.Map<unknown>).set('resolved', true));
    expect(decideUpdate('commenter', server, nested)).toBe('apply');

    const del = edit(client, (d) => d.getMap('comments').delete('t1'));
    expect(decideUpdate('commenter', server, del)).toBe('apply');
  });

  it('does not let a commenter add, edit nested fields of, or delete elements, or touch settings', () => {
    const { server, client } = setup();
    expect(decideUpdate('commenter', server, edit(client, (d) => d.getMap('elements').set('e2', 'x')))).toBe('drop');
    expect(
      decideUpdate('commenter', server, edit(client, (d) => (d.getMap('elements').get('e1') as Y.Map<unknown>).set('text', 'pwned'))),
    ).toBe('drop');
    expect(decideUpdate('commenter', server, edit(client, (d) => d.getMap('elements').delete('e1')))).toBe('drop');
    expect(decideUpdate('commenter', server, edit(client, (d) => d.getMap('settings').set('grid', 'none')))).toBe('drop');
  });

  it('does not let a commenter smuggle an element change inside a comment update', () => {
    const { server, client } = setup();
    const mixed = edit(client, (d) =>
      d.transact(() => {
        d.getMap('comments').set('t3', 'ok');
        d.getMap('elements').set('e9', 'sneaky');
      }),
    );
    expect(decideUpdate('commenter', server, mixed)).toBe('drop');
  });

  it('does not let a commenter create new top-level types', () => {
    const { server, client } = setup();
    expect(decideUpdate('commenter', server, edit(client, (d) => d.getArray('whatever').push([1])))).toBe('drop');
  });

  it('does not accept a commenter update whose effect cannot be determined (missing dependencies)', () => {
    const { server, client } = setup();
    edit(client, (d) => d.getMap('comments').set('a', 1)); // never sent to the server
    const second = edit(client, (d) => d.getMap('comments').set('a', 2));
    expect(changedRoots(server, second).ok).toBe(false);
    expect(decideUpdate('commenter', server, second)).toBe('drop');
  });

  it('does not accept or crash on a malformed update', () => {
    const { server } = setup();
    expect(decideUpdate('commenter', server, new Uint8Array([1, 2, 3, 255, 255]))).toBe('drop');
  });

  it('does not leak a rejected update into the live doc while checking it', () => {
    const { server, client } = setup();
    const u = edit(client, (d) => d.getMap('elements').set('e2', 'x'));
    decideUpdate('commenter', server, u);
    expect(server.getMap('elements').has('e2')).toBe(false);
  });
});
