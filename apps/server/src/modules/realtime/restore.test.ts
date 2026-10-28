import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { restoreInto } from './restore';

it('restoring a version equal to the live board writes nothing, so it cannot overwrite a concurrent edit by someone else', () => {
  const live = new Y.Doc();
  live.getMap('elements').set('a', { id: 'a', x: 1, text: 'hello', tags: ['x'] });
  live.getMap('settings').set('grid', 'dots');
  // Same content, written by another client in a different key order.
  const version = new Y.Doc();
  version.getMap('elements').set('a', { tags: ['x'], text: 'hello', x: 1, id: 'a' });
  version.getMap('settings').set('grid', 'dots');

  let updates = 0;
  live.on('update', () => updates++);
  expect(restoreInto(live, Y.encodeStateAsUpdate(version), ['comments'])).toBe(0);
  expect(updates).toBe(0);
});
