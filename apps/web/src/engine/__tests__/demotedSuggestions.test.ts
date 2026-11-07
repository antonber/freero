// Losing the editor role forgets the editors layer ("Hidden frames' contents and pending
// suggestions: only owners/editors may hold them", core.ts), also when that layer holds
// suggestions but no hidden items.
import { afterEach, expect, it } from 'vitest';
import type { BoardElement, SuggestionRecord } from '@freero/shared';
import type { EngineCore } from '../runtime/core';
import { REPLICA_ORIGIN } from '../store/replicas';
import { makeCore } from './harness';

let core: EngineCore;
afterEach(() => core?.destroy());

it('someone made a commenter no longer holds the pending suggestions of a board without hidden frames', () => {
  core = makeCore({ role: 'editor' });
  const record: SuggestionRecord = {
    id: 's1',
    groupId: 'g1',
    author: { kind: 'app', name: 'Planner bot', userId: 'maria', userName: 'Maria', credentialId: 'tok1' },
    description: 'Ideas',
    createdAt: 1,
    op: 'create',
    element: { id: 'n1', type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 0, createdBy: 'maria', createdAt: 1, updatedAt: 1 } as unknown as BoardElement,
  };
  const map = core.store.suggestionsMap();
  core.store.layers.editors.doc.transact(() => map.set(record.id, record), REPLICA_ORIGIN); // the server's proposal
  expect(core.editor.getSuggestions()).toHaveLength(1);

  // The server's role message after the owner made this person a commenter (refreshAccess).
  core.store.serverRole = 'commenter';
  for (const l of [...(core.store as unknown as { roleListeners: Set<() => void> }).roleListeners]) l();

  expect(core.editor.getSuggestions()).toHaveLength(0);
});
