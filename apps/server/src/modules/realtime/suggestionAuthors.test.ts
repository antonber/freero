// KAI-224: revoking an app withdraws its pending suggestions, found through the
// board_suggestion_authors hint. The hint must survive a clean-up that ran from a view taken
// before the app's newest proposal was written.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { BoardElement } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { proposeSuggestions, readBoardView, withdrawSuggestionsOn } from './rooms';
import { withdrawRevokedSuggestions } from './withdrawals';

/** Holds a proposal right after its hint is written, before its records exist. */
const hold = vi.hoisted(() => ({ afterNote: Promise.resolve(), noted: () => {} }));
vi.mock('./repo', async (importOriginal) => {
  const real = await importOriginal<typeof import('./repo')>();
  return {
    ...real,
    noteSuggestionAuthor: async (...args: Parameters<typeof real.noteSuggestionAuthor>) => {
      await real.noteSuggestionAuthor(...args);
      hold.noted();
      await hold.afterNote;
    },
  };
});

let owner = '';
beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: '100' });
  owner = (await createUser({ name: 'Owner', email: 'authors@test.freero.app', password: 'password-123' })).id;
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await closeTestDb();
});

const app = (credentialId: string) => ({ kind: 'app' as const, name: `App ${credentialId}`, userId: 'maria', userName: 'Maria', credentialId });
const sticky = (id: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, rotation: 0, text: id, color: 'yellow' }) as unknown as BoardElement;

it('an app’s proposal made while another app’s suggestions are withdrawn is still withdrawn when that app is revoked', async () => {
  const boardId = (await createBoard(owner, 'Hints', '')).id;
  const editor = { userId: owner, role: 'owner' as const };
  await proposeSuggestions(boardId, editor, { author: app('tok-b'), description: 'Other ideas' }, () => ({ change: { create: [sticky('m1')] } }));

  let release!: () => void;
  const noted = new Promise<void>((r) => (hold.noted = r));
  hold.afterNote = new Promise<void>((r) => (release = r));
  const proposing = proposeSuggestions(boardId, editor, { author: app('tok-a'), description: 'Ideas' }, () => ({ change: { create: [sticky('n1')] } }));
  await noted;
  // Meanwhile the other app is revoked: its withdrawal tidies the hint from the pending it sees now.
  await withdrawSuggestionsOn(boardId, { userId: null, credentialId: 'tok-b' });
  hold.afterNote = Promise.resolve();
  release();
  await proposing;

  // Now the first app is revoked: its proposal must not stay pending (and acceptable).
  expect(await withdrawRevokedSuggestions({ userId: null, credentialId: 'tok-a' })).toBe(1);
  const view = await readBoardView(boardId, editor);
  expect(view.suggestions).toHaveLength(0); // pending ones
});
