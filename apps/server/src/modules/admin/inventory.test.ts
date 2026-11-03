// The admin board inventory (#152) — through the real admin routes, with real sessions: what it
// shows and filters, what content admins fix from it, and that it reaches no other workspace.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account, AdminBoardRow } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { listAuditEvents } from '../audit/index';
import { completeSignIn, createUser, getAccount } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { changeWorkspaceRole, createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import adminRoutes from './routes';

let server: http.Server;
let base = '';

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/api', adminRoutes({ config, onShutdown: () => undefined } as unknown as ServerContext));
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
  const { id } = await createUser({ name: label, email: `${label.toLowerCase()}-${++n}@inventory.test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  return { ...(await getAccount(id)), cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}
async function call(who: Person, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { origin: base, cookie: who.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function setting() {
  const [owner, member, guest, outsider, content, security] = await Promise.all(['Owner', 'Member', 'Guest', 'Outsider', 'Content', 'Security'].map(person));
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  await inviteToWorkspace(null, ws, owner, { email: member.email, role: 'member' });
  await inviteToWorkspace(null, ws, owner, { email: guest.email, role: 'guest' });
  for (const [a, scope] of [
    [content, 'content'],
    [security, 'security'],
  ] as const) {
    await inviteToWorkspace(null, ws, owner, { email: a.email, role: 'admin' });
    await changeWorkspaceRole(ws, owner.id, a.id, 'admin', [scope]);
  }
  const linked = await createBoard(owner.id, 'Launch plan', '', 'viewer', { workspaceId: ws });
  await inviteBoardMember(null, linked.id, owner, { email: outsider.email, role: 'editor' });
  const withGuest = await createBoard(owner.id, 'Vendor notes', '', 'none', { workspaceId: ws });
  await inviteBoardMember(null, withGuest.id, owner, { email: guest.email, role: 'commenter' });
  const quiet = await createBoard(member.id, 'Quiet', '', 'none', { workspaceId: ws });
  return { owner, member, outsider, content, security, ws, linked, withGuest, quiet };
}

const ids = (r: { json: Record<string, unknown> }) => (r.json.boards as AdminBoardRow[]).map((b) => b.boardId).sort();

it('the inventory lists every board with its owner and how it is shared, filters the risky ones, and is the content admins’ alone', async () => {
  const { content, security, ws, linked, withGuest, quiet } = await setting();
  expect((await call(security, 'GET', `/workspaces/${ws}/admin/boards`)).status).toBe(403);

  const all = await call(content, 'GET', `/workspaces/${ws}/admin/boards?sort=title`);
  expect(all.json.total).toBe(3);
  const row = (id: string) => (all.json.boards as AdminBoardRow[]).find((b) => b.boardId === id)!;
  expect(row(linked.id)).toMatchObject({ ownerName: 'Owner', linkAccess: 'viewer', publicLink: true, members: 1, outsiders: 1, guests: 0 });
  expect(row(withGuest.id)).toMatchObject({ linkAccess: 'none', guests: 1, outsiders: 0 });
  expect(row(quiet.id)).toMatchObject({ ownerName: 'Member', members: 0 });

  expect(ids(await call(content, 'GET', `/workspaces/${ws}/admin/boards?filter=outside`))).toEqual([linked.id]);
  expect(ids(await call(content, 'GET', `/workspaces/${ws}/admin/boards?filter=guests`))).toEqual([withGuest.id]);
  expect(ids(await call(content, 'GET', `/workspaces/${ws}/admin/boards?filter=link,public`))).toEqual([linked.id]);
  expect(ids(await call(content, 'GET', `/workspaces/${ws}/admin/boards?filter=inactive&inactiveDays=30`))).toEqual([]);
});

it('a content admin turns a link off, removes people from outside and hands a board on from the inventory — each in the log — and reaches no other workspace’s board', async () => {
  const { owner, member, outsider, content, ws, linked, quiet } = await setting();
  expect((await call(content, 'POST', `/workspaces/${ws}/admin/boards/${linked.id}/link-off`)).status).toBe(200);
  expect((await getBoardAccess(linked.id, outsider.id)).role).toBe('editor'); // still invited
  expect((await call(content, 'POST', `/workspaces/${ws}/admin/boards/${linked.id}/remove-outsiders`)).json).toEqual({ removed: 1 });
  expect((await getBoardAccess(linked.id, outsider.id)).role).toBeNull();

  expect((await call(content, 'POST', `/workspaces/${ws}/admin/boards/${quiet.id}/transfer`, { userId: owner.id })).status).toBe(200);
  expect((await getBoardAccess(quiet.id, owner.id)).role).toBe('owner');
  expect((await getBoardAccess(quiet.id, member.id)).role).toBe('editor');

  const log = await listAuditEvents({ workspaceId: ws, actions: ['board.link_sharing_changed', 'board.member_removed', 'board.transferred'] }, 10);
  expect(log.map((e) => [e.action, e.actorId])).toEqual(
    expect.arrayContaining([
      ['board.link_sharing_changed', content.id],
      ['board.member_removed', content.id],
      ['board.transferred', content.id],
    ]),
  );

  const stranger = await person('Stranger');
  const theirs = (await createTeamWorkspace(stranger.id, `Theirs ${++n}`)).id;
  const foreign = await createBoard(stranger.id, 'Elsewhere', '', 'editor', { workspaceId: theirs });
  for (const action of ['link-off', 'remove-outsiders', 'transfer'])
    expect((await call(content, 'POST', `/workspaces/${ws}/admin/boards/${foreign.id}/${action}`, { userId: content.id })).status).toBe(404);
  expect((await getBoardAccess(foreign.id, outsider.id)).role).toBe('editor');
});
