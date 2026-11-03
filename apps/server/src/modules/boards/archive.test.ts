// Archived boards (#153) — through the real board routes, with real sessions.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account, AdminScope, BoardSummary } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser, getAccount } from '../auth/index';
import { createBoard, getBoardAccess } from './index';
import { changeWorkspaceRole, createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import boardRoutes from './routes';

let server: http.Server;
let base = '';

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  const ctx = { config, onShutdown: () => undefined } as unknown as ServerContext;
  app.use('/api', boardRoutes(ctx));
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
  const { id } = await createUser({ name: label, email: `${label.toLowerCase()}-${++n}@archive.test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  return { ...(await getAccount(id)), cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}
async function call(who: Person, method: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}/api${path}`, { method, headers: { origin: base, cookie: who.cookie } });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function team(owner: Person, members: Person[], admins: Array<[Person, AdminScope[]]> = []) {
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  for (const m of members) await inviteToWorkspace(null, ws, owner, { email: m.email, role: 'member' });
  for (const [a, scopes] of admins) {
    await inviteToWorkspace(null, ws, owner, { email: a.email, role: 'admin' });
    await changeWorkspaceRole(ws, owner.id, a.id, 'admin', scopes);
  }
  return ws;
}

it('an archived board is read-only for everyone — its owner too — and out of the default lists until it is unarchived; only its owner or a content admin archives it', async () => {
  const [owner, member, content, security] = await Promise.all(['Owner', 'Member', 'Content', 'Security'].map(person));
  const ws = await team(owner, [member], [
    [content, ['content']],
    [security, ['security', 'members']],
  ]);
  const board = await createBoard(member.id, 'Finished project', '', 'none', { workspaceId: ws });

  expect((await call(owner, 'GET', `/boards/${board.id}`)).status).toBe(200);
  const someoneElse = await createBoard(owner.id, 'Owner’s board', '', 'none', { workspaceId: ws });
  expect((await call(member, 'POST', `/boards/${someoneElse.id}/archive`)).status).toBe(403);
  expect((await call(security, 'POST', `/boards/${board.id}/archive`)).status).toBe(403);

  const archived = await call(member, 'POST', `/boards/${board.id}/archive`);
  expect(archived.status).toBe(200);
  expect(archived.json.board).toMatchObject({ role: 'viewer', archivedAt: expect.any(Number), permissions: { canArchive: true } });
  for (const who of [member, owner, content]) expect((await getBoardAccess(board.id, who.id)).role).toBe('viewer');
  // Read-only means no owner-only actions either: trashing it waits for an unarchive.
  expect((await call(member, 'DELETE', `/boards/${board.id}`)).status).toBe(403);

  const list = async (filter: string) => ((await call(member, 'GET', `/boards?workspace=${ws}&filter=${filter}`)).json.boards as BoardSummary[]).map((b) => b.id);
  expect(await list('all')).not.toContain(board.id);
  expect(await list('mine')).not.toContain(board.id);
  expect(await list('archived')).toEqual([board.id]);

  expect((await call(content, 'POST', `/boards/${board.id}/unarchive`)).status).toBe(200);
  expect((await getBoardAccess(board.id, member.id)).role).toBe('owner');
  expect(await list('all')).toContain(board.id);
});
