import { expect, it } from 'vitest';
import type { AuthorizedApp, PersonalToken } from '@freero/shared';
import { connectionStates } from './connections';

const NOW = 1_800_000_000_000;
const app = (over: Partial<AuthorizedApp>): AuthorizedApp => ({
  clientId: 'c1',
  name: 'Cursor',
  website: null,
  registration: 'dynamic',
  scopes: ['boards:read'],
  authorizedAt: NOW - 60_000,
  lastUsedAt: null,
  resource: '/mcp',
  ...over,
});
const token = (over: Partial<PersonalToken>): PersonalToken => ({
  id: 't1',
  name: 'CI',
  hint: 'abcd',
  scopes: ['boards:read'],
  createdAt: NOW - 60_000,
  expiresAt: null,
  lastUsedAt: NOW - 1000,
  paused: false,
  ...over,
});

it('“Connected” means the client has called Freero and can still: an approved app before its first call, or a paused or expired token, never shows as connected', () => {
  const list = connectionStates(
    [app({ clientId: 'waiting', name: 'Waiting app' }), app({ clientId: 'used', name: 'Used app', lastUsedAt: NOW - 5000 })],
    [token({ id: 'ok', name: 'Working' }), token({ id: 'paused', name: 'Paused', paused: true }), token({ id: 'old', name: 'Old', expiresAt: NOW - 1 })],
    NOW,
  );
  const state = Object.fromEntries(list.map((c) => [c.name, { connected: c.connected, problem: c.problem }]));
  expect(state).toEqual({
    'Waiting app': { connected: false, problem: null },
    'Used app': { connected: true, problem: null },
    Working: { connected: true, problem: null },
    Paused: { connected: false, problem: 'Paused' },
    Old: { connected: false, problem: 'Expired' },
  });
  // Revoking an app takes its client id, a token its own id.
  expect(list.find((c) => c.name === 'Used app')).toMatchObject({ kind: 'app', id: 'used' });
});
