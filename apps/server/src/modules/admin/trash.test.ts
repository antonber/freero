// Everyone's trash for content admins (#153) — through the real admin routes, with real sessions.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account, AdminScope, AdminTrashedBoard } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser, getAccount } from '../auth/index';
import { createBoard, getBoardAccess, trashBoard } from '../boards/index';
import { changeWorkspaceRole, createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import adminRoutes from './routes';

let server: http.Server;
let base = '';

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  const ctx = { config, onShutdown: () => undefined } as unknown as ServerContext;
  app.use('/api', adminRoutes(ctx));
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
  const { id } = await createUser({ name: label, email: `${label.toLowerCase()}-${++n}@trash.test.freero.app`, password: 'password-123' }, { emailVerified: true });
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

it('a content admin sees who deleted each board of the workspace and restores any of them for its owner; not another workspace’s, and a security admin sees none', async () => {
  const [owner, member, content, security] = await Promise.all(['Owner', 'Member', 'Content', 'Security'].map(person));
  const ws = await team(owner, [member], [
    [content, ['content']],
    [security, ['security']],
  ]);
  const board = await createBoard(member.id, 'Quarterly plan', '', 'none', { workspaceId: ws });
  await trashBoard(board.id, member.id);

  expect((await call(security, 'GET', `/workspaces/${ws}/admin/trash`)).status).toBe(403);
  expect((await call(security, 'POST', `/workspaces/${ws}/admin/trash/${board.id}/restore`)).status).toBe(403);
  const { json } = await call(content, 'GET', `/workspaces/${ws}/admin/trash`);
  expect(json.boards as AdminTrashedBoard[]).toEqual([
    expect.objectContaining({ boardId: board.id, ownerId: member.id, deletedBy: { id: member.id, name: 'Member' } }),
  ]);

  // A board of another workspace's trash can't be reached through this one.
  const otherOwner = await person('Elsewhere');
  const other = await team(otherOwner, []);
  const theirs = await createBoard(otherOwner.id, 'Not yours', '', 'none', { workspaceId: other });
  await trashBoard(theirs.id, otherOwner.id);
  expect((await call(content, 'POST', `/workspaces/${ws}/admin/trash/${theirs.id}/restore`)).status).toBe(404);

  expect((await call(content, 'POST', `/workspaces/${ws}/admin/trash/${board.id}/restore`)).status).toBe(200);
  expect((await getBoardAccess(board.id, member.id)).role).toBe('owner');
  expect((await call(content, 'GET', `/workspaces/${ws}/admin/trash`)).json.boards).toEqual([]);
});
