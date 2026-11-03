// Who manages a board's sharing, and what follows a board across workspaces — through the real
// board routes, with real sessions: co-owners (#122), a board's own sharing settings (#123), the
// workspace's link policy (#39) and moving a board to another workspace (#124).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { BOARD_SHARING_RESTRICTED, DOWNLOADS_RESTRICTED, LINK_POLICY_REQUIRED, type Account, type BoardSummary, type MoveBoardResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { listAuditEvents } from '../audit/index';
import { completeSignIn, createUser, getAccount } from '../auth/index';
import { inviteBoardMember, removeBoardMember, setBoardMemberRole } from '../members/index';
import { createProject, createTeamWorkspace, inviteToWorkspace, updateWorkspace } from '../workspaces/index';
import { createBoard, getBoardAccess, linksOutOfPolicy, requireBoardDownload, shareBoardByLink } from './index';
import boardRoutes from './routes';

let server: http.Server;
let base = '';

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
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
  const email = `${label.toLowerCase()}-${++n}@sharing.test.freero.app`;
  const { id } = await createUser({ name: label, email, password: 'password-123' }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  expect(res.status).toBe(200);
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
const boardOf = (r: { json: Record<string, unknown> }) => r.json.board as BoardSummary;
const share = (owner: Person, boardId: string, who: Person, role: 'editor' | 'commenter' | 'viewer') => inviteBoardMember(null, boardId, owner, { email: who.email, role });

it('a co-owner manages sharing like the owner — roles, other co-owners, the link and its password — but can never delete, transfer the board or touch the owner’s access', async () => {
  const [owner, co, editor, viewer] = [await person('Owner'), await person('Co'), await person('Editor'), await person('Viewer')];
  const board = await createBoard(owner.id, 'Launch', '', 'none');
  for (const [p, role] of [[co, 'editor'], [editor, 'editor'], [viewer, 'viewer']] as const) await share(owner, board.id, p, role);

  // A plain editor manages nothing.
  expect((await call(editor, 'PATCH', `/boards/${board.id}`, { linkAccess: 'viewer' })).status).toBe(403);
  await expect(setBoardMemberRole(board.id, editor.id, viewer.id, 'editor')).rejects.toMatchObject({ status: 403 });

  await setBoardMemberRole(board.id, owner.id, co.id, 'coowner');
  // What a client that doesn't know co-owners reads: an editor, never an owner.
  const seen = boardOf(await call(co, 'GET', `/boards/${board.id}`));
  expect(seen).toMatchObject({ role: 'editor', coOwner: true, permissions: { manageSharing: true } });
  expect(seen.linkProtection).toBeDefined();

  expect((await call(co, 'PATCH', `/boards/${board.id}`, { linkAccess: 'commenter', linkPassword: 'team secret' })).status).toBe(200);
  expect(boardOf(await call(owner, 'GET', `/boards/${board.id}`))).toMatchObject({ linkAccess: 'commenter', linkProtection: { password: true } });
  await setBoardMemberRole(board.id, co.id, editor.id, 'coowner');
  await setBoardMemberRole(board.id, co.id, viewer.id, 'commenter');
  expect((await getBoardAccess(board.id, viewer.id)).role).toBe('commenter');

  // Never the board itself, nor the owner's place on it.
  expect((await call(co, 'DELETE', `/boards/${board.id}`)).status).toBe(403);
  expect((await call(co, 'POST', `/boards/${board.id}/transfer`, { userId: co.id })).status).toBe(403);
  await expect(setBoardMemberRole(board.id, co.id, owner.id, 'viewer')).rejects.toMatchObject({ status: 404 });
  await expect(removeBoardMember(board.id, co.id, owner.id)).rejects.toMatchObject({ status: 404 });
  expect((await getBoardAccess(board.id, owner.id)).role).toBe('owner');

  // Back to editor: the powers end with it; every co-owner change is in the log.
  await setBoardMemberRole(board.id, owner.id, co.id, 'editor');
  expect((await call(co, 'PATCH', `/boards/${board.id}`, { linkAccess: 'none' })).status).toBe(403);
  const changes = await listAuditEvents({ workspaceId: board.workspaceId, actions: ['board.member_role_changed'], targetId: board.id }, 50);
  expect(changes.map((e) => `${e.metadata.from}→${e.metadata.to}`).sort()).toEqual(['coowner→editor', 'editor→coowner', 'editor→coowner', 'viewer→commenter'].sort());
});

it('with “Editors can share” off an editor’s invite is refused and co-owners still invite; with “Viewers and commenters can copy and export” off they can’t export, duplicate or read it out, editors can', async () => {
  const [owner, co, editor, viewer, commenter, newcomer] = [await person('O'), await person('C'), await person('E'), await person('V'), await person('Cm'), await person('N')];
  const board = await createBoard(owner.id, 'Pricing', '', 'none');
  for (const [p, role] of [[co, 'editor'], [editor, 'editor'], [viewer, 'viewer'], [commenter, 'commenter']] as const) await share(owner, board.id, p, role);
  await setBoardMemberRole(board.id, owner.id, co.id, 'coowner');

  expect((await call(editor, 'PATCH', `/boards/${board.id}`, { sharing: { editorsCanShare: false } })).status).toBe(403);
  expect((await call(co, 'PATCH', `/boards/${board.id}`, { sharing: { editorsCanShare: false, viewersCanExport: false } })).status).toBe(200);

  await expect(inviteBoardMember(null, board.id, editor, { email: newcomer.email, role: 'viewer' })).rejects.toMatchObject({ status: 403, code: BOARD_SHARING_RESTRICTED });
  await expect(inviteBoardMember(null, board.id, co, { email: newcomer.email, role: 'viewer' })).resolves.toMatchObject({ member: { userId: newcomer.id } });

  for (const p of [viewer, commenter]) {
    expect(await call(p, 'POST', `/boards/${board.id}/exported`, { format: 'pdf' })).toMatchObject({ status: 403, json: { code: DOWNLOADS_RESTRICTED } });
    expect((await call(p, 'POST', `/boards/${board.id}/duplicate`)).status).toBe(403);
    await expect(requireBoardDownload(board.id, p.id, 'api')).rejects.toMatchObject({ code: DOWNLOADS_RESTRICTED });
    expect(boardOf(await call(p, 'GET', `/boards/${board.id}`)).permissions).toMatchObject({ canExport: false, canCopy: false });
  }
  expect((await call(editor, 'POST', `/boards/${board.id}/exported`, { format: 'pdf' })).status).toBe(200);
  expect((await call(editor, 'POST', `/boards/${board.id}/duplicate`)).status).toBe(201);
  expect(await listAuditEvents({ workspaceId: board.workspaceId, actions: ['board.sharing_settings_changed'], targetId: board.id }, 10)).toHaveLength(1);
});

it('a board can be stricter than its workspace, never looser: its own copy setting on doesn’t let a guest past a members-only downloads policy', async () => {
  const [owner, guest] = [await person('Admin'), await person('Guest')];
  const ws = await createTeamWorkspace(owner.id, 'Finance');
  await inviteToWorkspace(null, ws.id, owner, { email: guest.email, role: 'guest' });
  await updateWorkspace(ws.id, owner.id, { policies: { downloads: 'members' } });
  const board = await createBoard(owner.id, 'Budget', '', 'none', { workspaceId: ws.id });
  await share(owner, board.id, guest, 'editor');
  expect(boardOf(await call(guest, 'GET', `/boards/${board.id}`)).sharing).toEqual({ editorsCanShare: true, viewersCanExport: true });
  expect((await call(guest, 'POST', `/boards/${board.id}/duplicate`)).status).toBe(403);
});

it('a workspace that requires a password and an expiry refuses a bare link, takes one with both in the same request, and never breaks the links that were on before — it lists them', async () => {
  const [admin, visitor] = [await person('Lead'), await person('Visitor')];
  const ws = await createTeamWorkspace(admin.id, 'Studio');
  const before = await createBoard(admin.id, 'Old link', '', 'viewer', { workspaceId: ws.id });
  await updateWorkspace(ws.id, admin.id, { policies: { linkPassword: 'required', linkMaxDays: 30 } });

  // The link from before keeps working, and the admin console names it.
  expect((await getBoardAccess(before.id, visitor.id)).role).toBe('viewer');
  expect((await linksOutOfPolicy(ws.id)).map((b) => [b.id, b.problems])).toEqual([[before.id, ['no_password', 'no_expiry']]]);
  // Changing it now means meeting the policy; making it no weaker step by step is fine.
  expect(await call(admin, 'PATCH', `/boards/${before.id}`, { linkAccess: 'commenter' })).toMatchObject({ status: 403, json: { code: LINK_POLICY_REQUIRED } });
  expect((await call(admin, 'PATCH', `/boards/${before.id}`, { linkPassword: 'first step' })).status).toBe(200);

  const fresh = await createBoard(admin.id, 'New link', '', 'none', { workspaceId: ws.id });
  expect((await call(admin, 'PATCH', `/boards/${fresh.id}`, { linkAccess: 'viewer' })).status).toBe(403);
  expect((await call(admin, 'PATCH', `/boards/${fresh.id}`, { linkAccess: 'viewer', linkPassword: 'only' })).status).toBe(403); // no expiry yet
  expect((await call(admin, 'PATCH', `/boards/${fresh.id}`, { linkAccess: 'viewer', linkPassword: 'only', linkExpiresAt: Date.now() + 60 * 86_400_000 })).status).toBe(403);
  const ok = await call(admin, 'PATCH', `/boards/${fresh.id}`, { linkAccess: 'viewer', linkPassword: 'only', linkExpiresAt: Date.now() + 7 * 86_400_000 });
  expect(boardOf(ok)).toMatchObject({ linkAccess: 'viewer', linkProtection: { password: true } });
  // …and it can't be weakened afterwards, nor turned on by an app's "Share with team".
  expect((await call(admin, 'PATCH', `/boards/${fresh.id}`, { linkPassword: null })).status).toBe(403);
  expect((await call(admin, 'PATCH', `/boards/${fresh.id}`, { linkExpiresAt: null })).status).toBe(403);
  const third = await createBoard(admin.id, 'From an app', '', 'none', { workspaceId: ws.id });
  await expect(shareBoardByLink(third.id, admin, 'viewer')).rejects.toMatchObject({ code: LINK_POLICY_REQUIRED });
});

it('moving a board to another workspace keeps it whole, ends the old team’s access, turns off what the new one forbids, and its policies apply to the very next request', async () => {
  const [owner, teammate, outsider, other] = [await person('Mover'), await person('Teammate'), await person('Outsider'), await person('Other')];
  const from = await createTeamWorkspace(owner.id, 'Old team');
  await inviteToWorkspace(null, from.id, owner, { email: teammate.email, role: 'member' });
  const to = await createTeamWorkspace(other.id, 'Company');
  await inviteToWorkspace(null, to.id, other, { email: owner.email, role: 'member' });
  const project = await createProject(to.id, owner.id, { name: 'Imported' });
  await updateWorkspace(to.id, other.id, { policies: { linkSharing: 'viewer', boardEmbeds: 'off', downloads: 'members' } });

  const board = await createBoard(owner.id, 'Roadmap', '', 'editor', { workspaceId: from.id });
  await share(owner, board.id, outsider, 'viewer');
  await call(owner, 'PATCH', `/boards/${board.id}`, { embeddable: true });
  expect((await getBoardAccess(board.id, teammate.id)).role).toBe('editor');
  expect((await call(outsider, 'POST', `/boards/${board.id}/exported`, { format: 'png' })).status).toBe(200);

  // Only its owner, and only into a workspace where they may create boards.
  expect((await call(teammate, 'POST', `/boards/${board.id}/move`, { workspaceId: to.id })).status).toBe(403);
  const moved = await call(owner, 'POST', `/boards/${board.id}/move`, { workspaceId: to.id, projectId: project.id });
  expect(moved.status).toBe(200);
  const out = moved.json as unknown as MoveBoardResponse;
  expect(out.board).toMatchObject({ id: board.id, workspaceId: to.id, projectId: project.id, linkAccess: 'viewer', embeddable: false });
  expect(out.adjusted.map((a) => a.kind).sort()).toEqual(['embedding_off', 'link_lowered']);

  expect((await getBoardAccess(board.id, teammate.id)).role).toBe('viewer'); // only the (lowered) link is left of their access
  expect((await getBoardAccess(board.id, outsider.id)).role).toBe('viewer'); // a direct invite moves with the board
  expect(await call(outsider, 'POST', `/boards/${board.id}/exported`, { format: 'png' })).toMatchObject({ status: 403, json: { code: DOWNLOADS_RESTRICTED } });
  for (const ws of [from.id, to.id])
    expect(await listAuditEvents({ workspaceId: ws, actions: ['board.moved_workspace'], targetId: board.id }, 10)).toHaveLength(1);
});

it('a duplicate goes to the workspace and project chosen for it, never into one where its maker may not create boards', async () => {
  const [maker, admin] = [await person('Maker'), await person('TeamAdmin')];
  const team = await createTeamWorkspace(admin.id, 'Design');
  await inviteToWorkspace(null, team.id, admin, { email: maker.email, role: 'member' });
  const project = await createProject(team.id, maker.id, { name: 'Copies' });
  const source = await createBoard(maker.id, 'Sketch', '', 'none');
  const copy = await call(maker, 'POST', `/boards/${source.id}/duplicate`, { workspaceId: team.id, projectId: project.id });
  expect(copy.status).toBe(201);
  expect(boardOf(copy)).toMatchObject({ workspaceId: team.id, projectId: project.id, role: 'owner' });

  const elsewhere = await createTeamWorkspace(admin.id, 'Private team');
  await inviteToWorkspace(null, elsewhere.id, admin, { email: maker.email, role: 'guest' });
  expect((await call(maker, 'POST', `/boards/${source.id}/duplicate`, { workspaceId: elsewhere.id })).status).toBe(403);
});
