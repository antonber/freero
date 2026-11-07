// What update_items (REST and MCP) accepts for a card, decided by planPatch before anything is written.
import { expect, it } from 'vitest';
import { cardDraft, type CardElement } from '@freero/shared';
import type { BoardView } from '../realtime/index';
import { planPatch } from './items';

it('a card stored with its start after its due date (as older clients could leave it) can still be renamed and recoloured by update_items; only a change that sets a date the wrong way round is refused', () => {
  const card = { ...cardDraft({ text: 'Launch', dueDate: '2026-11-05' }, 'c1', 0, 0, 300, null), z: 1, startDate: '2026-11-10' } as CardElement;
  const view: BoardView = { elements: [{ el: card, layer: 'shared' } as BoardView['elements'][number]], collection: () => new Map(), seesHidden: false, suggestions: [], version: '' };

  expect(planPatch(card, { title: 'Launch v2', color: '#1FA463' }, view)).toMatchObject({ color: '#1FA463' });
  expect(planPatch(card, { dueDate: '2026-11-12' }, view)).toEqual({ dueDate: '2026-11-12' });
  expect(() => planPatch(card, { dueDate: '2026-11-06' }, view)).toThrow('can’t be after dueDate');
});
