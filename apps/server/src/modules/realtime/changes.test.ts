import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { elementChanges } from './changes';

it('moving a hidden frame’s contents out of the shared doc is not reported (it would tell viewers how much the frame holds)', () => {
  const doc = new Y.Doc();
  const els = doc.getMap<unknown>('elements');
  els.set('f', { id: 'f', type: 'frame', title: 'Plans', frameId: null });
  els.set('a', { id: 'a', type: 'sticky', frameId: 'f', text: 'secret' });
  els.set('b', { id: 'b', type: 'sticky', frameId: null, text: 'public' });
  let seen: ReturnType<typeof elementChanges> | null = null;
  els.observe((e) => (seen = elementChanges('shared', els, els, e.changes.keys)));

  doc.transact(() => {
    els.set('f', { id: 'f', type: 'frame', title: 'Plans', frameId: null, hidden: true });
    els.delete('a'); // the editors' clients move it into the editors layer
    els.delete('b');
  });

  expect(seen!.changes.map((c) => [c.id, c.op])).toEqual([
    ['f', 'change'],
    ['b', 'remove'],
  ]);
  expect(JSON.stringify(seen)).not.toContain('secret'); // no content, ever
});
