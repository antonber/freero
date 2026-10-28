// The object registry against real stored boards, templates and workspaces (in-memory Postgres):
// one permission check must give exactly the answers each owning module gives on its own pages.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { formatObjectUri, type Account, type BoardElement, type ObjectAction, type ObjectRef, type Role } from '@freero/shared';
import { closeTestDb, openTestDb, queryCount } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, getBoardAccess, registerBoardObjectTypes, trashBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { initBoardDoc, initBoardLayer } from '../realtime/index';
import { registerTemplateObjectType, saveTemplate } from '../templates/index';
import { createProject, createTeamWorkspace, inviteToWorkspace, registerWorkspaceObjectTypes, updateWorkspace } from '../workspaces/index';
import { accessOf, resolveObjects } from './index';

beforeAll(async () => {
  await openTestDb();
  registerBoardObjectTypes();
  registerTemplateObjectType();
  registerWorkspaceObjectTypes();
});
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@objects.test.freero.app`, password: 'password-123' }, { emailVerified: true });
const ACTION: Record<Role, ObjectAction> = { viewer: 'view', commenter: 'comment', editor: 'edit', owner: 'manage' };
const board = (id: string): ObjectRef => ({ type: 'board', id });

let z = 0;
const sticky = (id: string, text: string, extra: Record<string, unknown> = {}): BoardElement =>
  ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: ++z, createdBy: 'x', createdAt: 1, updatedAt: 1, text, color: 'yellow', ...extra }) as BoardElement;

async function storeContent(boardId: string, shared: BoardElement[], editorsLayer: BoardElement[] = []) {
  const doc = new Y.Doc();
  for (const e of shared) doc.getMap('elements').set(e.id, e);
  await initBoardDoc(boardId, Y.encodeStateAsUpdate(doc));
  if (editorsLayer.length) {
    const l = new Y.Doc();
    for (const e of editorsLayer) l.getMap('elements').set(e.id, e);
    await initBoardLayer(boardId, 'editors', Y.encodeStateAsUpdate(l));
  }
}

it('a board resolves to exactly the role the board page gives, for owners, members, team members, link visitors and blocked outsiders', async () => {
  const [owner, invited, teamMate, visitor, outsider] = await Promise.all(['Owner', 'Invited', 'Mate', 'Visitor', 'Outsider'].map(user));
  const ws = await createTeamWorkspace(owner.id, 'Studio');
  await inviteToWorkspace(null, ws.id, owner, { email: teamMate.email, role: 'member' });
  const closedWs = await createTeamWorkspace(owner.id, 'Closed');
  const boards = [
    await createBoard(owner.id, 'Personal, link viewer', '', 'viewer'),
    await createBoard(owner.id, 'Personal, private', '', 'none'),
    await createBoard(owner.id, 'Team, link commenter', '', 'commenter', { workspaceId: ws.id }),
    await createBoard(owner.id, 'Closed team, link editor', '', 'editor', { workspaceId: closedWs.id }),
  ];
  for (const b of boards) await inviteBoardMember(null, b.id, owner, { email: invited.email, role: 'commenter' });
  // No outside access at all: the link and the direct invite stop counting for people outside it.
  await updateWorkspace(closedWs.id, owner.id, { policies: { externalSharing: 'none' } });

  for (const who of [owner, invited, teamMate, visitor, outsider]) {
    const got = await accessOf({ userId: who.id }, boards.map((b) => board(b.id)));
    for (const b of boards) {
      const expected = (await getBoardAccess(b.id, who.id)).role;
      expect([who.name, b.title, got.get(formatObjectUri(board(b.id)))]).toEqual([who.name, b.title, expected ? ACTION[expected] : null]);
    }
  }
  // And nobody without access learns the title.
  const [denied] = await resolveObjects({ userId: outsider.id }, [formatObjectUri(board(boards[1].id))]);
  expect(denied).toEqual({ uri: formatObjectUri(board(boards[1].id)), status: 'unavailable' });
});

it('an item in a hidden frame resolves for an editor but reads like a missing one for a viewer, and trashing the board closes every item at once', async () => {
  const [owner, viewer] = await Promise.all([user('Ed'), user('Vi')]);
  const b = await createBoard(owner.id, 'Plans', '', 'viewer');
  await storeContent(b.id, [sticky('open', '<p>Ship it</p>'), sticky('frame', '', { type: 'frame', title: 'Secret', hidden: true })], [sticky('inside', 'Salary bands')]);
  const uris = ['open', 'inside', 'nope'].map((id) => formatObjectUri({ type: 'element', boardId: b.id, id }));

  const asEditor = await resolveObjects({ userId: owner.id }, uris);
  expect(asEditor.map((r) => r.status)).toEqual(['ok', 'ok', 'unavailable']);
  expect(asEditor[0]).toMatchObject({ object: { title: 'Ship it', kind: 'sticky', board: { id: b.id, title: 'Plans' }, path: `/board/${b.id}?el=open` } });
  const asViewer = await resolveObjects({ userId: viewer.id }, uris);
  expect(asViewer.map((r) => r.status)).toEqual(['ok', 'unavailable', 'unavailable']);
  // A hidden item and no item at all are indistinguishable: nothing but the status comes back.
  expect(Object.keys(asViewer[1]).sort()).toEqual(['status', 'uri']);

  await trashBoard(b.id, owner.id);
  expect((await resolveObjects({ userId: owner.id }, uris)).map((r) => r.status)).toEqual(['unavailable', 'unavailable', 'unavailable']);
});

it('resolving 200 addresses costs no more queries than resolving 10 (one batch per type, never a check per address)', async () => {
  const owner = await user('Batch');
  const ws = await createTeamWorkspace(owner.id, 'Batch team');
  const ids: string[] = [];
  for (let i = 0; i < 40; i++) ids.push((await createBoard(owner.id, `B${i}`, '', 'none', { workspaceId: i % 2 ? ws.id : undefined })).id);
  const refs = (count: number) => Array.from({ length: count }, (_, i) => formatObjectUri(board(i < 40 ? ids[i] : `missing${i}`)));
  const cost = async (count: number) => {
    const before = queryCount();
    const out = await resolveObjects({ userId: owner.id }, refs(count));
    expect(out.filter((r) => r.status === 'ok')).toHaveLength(Math.min(count, 40));
    return queryCount() - before;
  };
  expect(await cost(200)).toBe(await cost(10));
});

it('templates, workspaces and projects answer as their own lists do: shared templates for full members only, private projects for their members', async () => {
  const [owner, member, guest] = await Promise.all([user('TOwner'), user('TMember'), user('TGuest')]);
  const ws = await createTeamWorkspace(owner.id, 'Guild');
  await inviteToWorkspace(null, ws.id, owner, { email: member.email, role: 'member' });
  await inviteToWorkspace(null, ws.id, owner, { email: guest.email, role: 'guest' });
  const content = { elements: [{ id: 's', type: 'sticky', x: 0, y: 0, w: 1, h: 1 }] } as never;
  const shared = await saveTemplate(owner.id, { name: 'Retro', content, workspaceId: ws.id });
  const mine = await saveTemplate(owner.id, { name: 'Mine', content });
  const secret = await createProject(ws.id, owner.id, { name: 'Secret', access: 'private' });
  const open = await createProject(ws.id, owner.id, { name: 'Open', access: 'workspace' });
  const refs: ObjectRef[] = [
    { type: 'template', id: shared.id },
    { type: 'template', id: mine.id },
    { type: 'workspace', id: ws.id },
    { type: 'project', id: secret.id },
    { type: 'project', id: open.id },
  ];
  const table = async (u: Account) => [...(await accessOf({ userId: u.id }, refs)).values()];
  expect(await table(owner)).toEqual(['manage', 'manage', 'manage', 'manage', 'manage']);
  expect(await table(member)).toEqual(['view', null, 'edit', null, 'view']);
  expect(await table(guest)).toEqual([null, null, 'view', null, null]);
});
