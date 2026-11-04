// Offline copies (#178): what the server tells a device it may keep — through the real board routes
// with real sessions. The device asks on every online start (POST /boards/offline-check) and
// deletes whatever is not in `keep`; a board's summary says whether it may be kept at all.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account, BoardSummary } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser, getAccount } from '../auth/index';
import { createKey } from '../keys/index';
import { inviteBoardMember, removeBoardMember } from '../members/index';
import { createTeamWorkspace, updateWorkspace } from '../workspaces/index';
import { createBoard } from './index';
import boardRoutes from './routes';

let server: http.Server;
let base = '';

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test', WORKSPACE_KEYS: 'true' });
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/api', boardRoutes({ config, onShutdown: () => undefined } as unknown as ServerContext));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

type Person = Account & { cookie: string };
let n = 0;
async function person(label: string): Promise<Person> {
  const email = `${label.toLowerCase()}-${++n}@offline.test.freero.app`;
  const { id } = await createUser({ name: label, email, password: 'password-123' }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  return { ...(await getAccount(id)), cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}
async function call(who: Person, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { origin: base, cookie: who.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
const keep = async (who: Person, ids: string[]) => ((await call(who, 'POST', '/boards/offline-check', { ids })).json.keep as string[]).sort();
const mayKeep = async (who: Person, id: string) => ((await call(who, 'GET', `/boards/${id}`)).json.board as BoardSummary).permissions.offline;

it('a person removed from a board (or whose board is gone) has its device copy dropped on the next check; boards they still open stay', async () => {
  const [owner, dana] = [await person('Owner'), await person('Dana')];
  const kept = await createBoard(owner.id, 'Still shared', '', 'none');
  const revoked = await createBoard(owner.id, 'Revoked', '', 'none');
  for (const b of [kept, revoked]) await inviteBoardMember(null, b.id, owner, { email: dana.email, role: 'editor' });
  expect(await keep(dana, [kept.id, revoked.id])).toEqual([kept.id, revoked.id].sort());

  await removeBoardMember(revoked.id, owner.id, dana.id);
  expect(await keep(dana, [kept.id, revoked.id, 'no-such-board'])).toEqual([kept.id]);
});

it('a workspace that forbids offline copies: its boards say keep nothing, and devices drop the copies they already have', async () => {
  const admin = await person('Admin');
  const team = (await createTeamWorkspace(admin.id, 'Strict')).id;
  const board = await createBoard(admin.id, 'Roadmap', '', 'none', { workspaceId: team });
  expect(await mayKeep(admin, board.id)).toBe(true);
  expect(await keep(admin, [board.id])).toEqual([board.id]);

  await updateWorkspace(team, admin.id, { policies: { offlineCopies: 'off' } });
  expect(await mayKeep(admin, board.id)).toBe(false);
  expect(await keep(admin, [board.id])).toEqual([]);
});

it('a board under its workspace’s own encryption key is kept on no device unless the workspace allows it for keyed boards too', async () => {
  const admin = await person('Keyholder');
  const team = (await createTeamWorkspace(admin.id, 'Keyed')).id;
  await createKey(team, admin.id, {});
  const board = await createBoard(admin.id, 'Secrets', '', 'none', { workspaceId: team });
  expect(await mayKeep(admin, board.id)).toBe(false);
  expect(await keep(admin, [board.id])).toEqual([]);

  await updateWorkspace(team, admin.id, { policies: { offlineCopies: 'all' } });
  expect(await mayKeep(admin, board.id)).toBe(true);
  expect(await keep(admin, [board.id])).toEqual([board.id]);
});
