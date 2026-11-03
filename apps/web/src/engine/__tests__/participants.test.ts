// Participants (parity rank 1): a commenter or guest the server lets take part writes only their
// own private-mode drafts, ballot and pick. The engine mirrors the server so an honest client never
// sends a write the server would drop (a dropped update would stall everything it sends after).
import { afterEach, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import type { ElementDefinition } from '../api';
import { createTestBoard, type TestBoard } from '../testing';
import { boxDef, bundle } from './harness';

let board: TestBoard;
afterEach(() => board?.destroy());

const sticky = (x: number) => ({ type: 'sticky', x, y: 0 }) as never;
/** Private mode over the left half of the board, as features/private-mode sets it. */
const leftHalf = (el: BoardElement) => el.x < 500;

it("a participant adds only drafts private mode makes private, changes only those, and never touches anyone else's item or the shared board", () => {
  board = createTestBoard({
    users: ['owner', 'guest'],
    roles: ['owner', 'commenter'],
    participants: [1],
    features: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>] })],
  });
  const [owner, guest] = board.editors();
  const theirs = owner.create(sticky(0));
  board.sync();

  // No private mode: a participant adds nothing.
  expect(guest.create(sticky(0))).toBe('');

  owner.setPrivatePlacement(leftHalf, { types: ['sticky'] });
  guest.setPrivatePlacement(leftHalf, { types: ['sticky'] });
  const draft = guest.create(sticky(100));
  expect(guest.layerOf(draft)).toBe('private');
  expect(guest.create(sticky(900))).toBe(''); // would land on the shared board

  guest.update(draft, { x: 120 } as never);
  guest.update(theirs, { x: 300 } as never);
  guest.remove([theirs]);
  board.sync();
  expect(guest.getElement(draft)?.x).toBe(120);
  expect(owner.getElement(draft)).toBeUndefined(); // still private
  expect(owner.getElement(theirs)?.x).toBe(0);

  guest.remove([draft]);
  expect(guest.getElement(draft)).toBeUndefined();
});
