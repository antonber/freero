// Classification labels (#158): a label's caps hold on every way in — the board's link, visitors
// without an account, the API / MCP read and share paths, the embed page — including for links and
// embeds turned on before the label; and a board can't shed its label by being copied, moved or
// cleared where a label is required.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { listAuditEvents } from '../audit/index';
import { createUser } from '../auth/index';
import { createLabel, createTeamWorkspace, inviteToWorkspace, setLabelPolicy, updateLabel, updateWorkspace } from '../workspaces/index';
import { boardEmbedding, getBoardAccess, requireBoardDownload } from './index';
import * as repo from './repo';
import { createBoard, duplicateBoard, guestRoleFor, moveToWorkspace, setBoardLabel, shareByLink } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@labels.test.freero.app`, password: 'password-123' }, { emailVerified: true });

async function openTeam(owner: Account) {
  const ws = await createTeamWorkspace(owner.id, `Labels ${++n}`);
  await updateWorkspace(ws.id, owner.id, { policies: { publicLinks: 'anyone', boardEmbeds: 'on', linkSharing: 'editor', externalSharing: 'anyone', downloads: 'anyone' } });
  return ws.id;
}
const fresh = async (id: string) => (await repo.getBoard(id))!;

it('a Confidential label caps every way in at once — the link, visitors, API/MCP exports and shares, the embed page — even for a link and an embed turned on before it', async () => {
  const owner = await user('Owner');
  const outsider = await user('Outsider');
  const ws = await openTeam(owner);
  const board = await createBoard(owner.id, 'Q4 forecast', '', 'none', { workspaceId: ws });
  await shareByLink(board.id, owner, 'editor');
  await repo.updateBoardFields(board.id, { embeddable: true }, Date.now());
  expect((await getBoardAccess(board.id, outsider.id)).role).toBe('editor');
  expect(await guestRoleFor(await fresh(board.id))).not.toBeNull();
  expect(await boardEmbedding(board.id)).not.toBeNull();

  const confidential = await createLabel(ws, owner.id, { name: 'Confidential', caps: { linkSharing: 'viewer', publicLinks: 'signedIn', boardEmbeds: 'off', viewerExports: 'off' } });
  await setBoardLabel(board.id, owner.id, confidential.id);

  expect((await getBoardAccess(board.id, outsider.id)).role).toBe('viewer'); // the stored editor link is capped
  expect(await guestRoleFor(await fresh(board.id))).toBeNull(); // no visitors without an account
  expect(await boardEmbedding(board.id)).toBeNull(); // the embed page, its sockets and oEmbed refuse it
  await expect(requireBoardDownload(board.id, outsider.id, 'api')).rejects.toMatchObject({ status: 403, code: 'downloads_restricted' });
  // An app's "Share with team" can't raise the link past the cap either.
  await repo.updateBoardFields(board.id, { linkAccess: 'none' }, Date.now());
  await expect(shareByLink(board.id, owner, 'editor')).rejects.toMatchObject({ status: 403 });
  expect((await fresh(board.id)).storedLinkAccess).toBe('none');

  // Loosening the label loosens every board carrying it; the owner's own settings were kept.
  await updateLabel(ws, confidential.id, owner.id, { caps: {} });
  await repo.updateBoardFields(board.id, { linkAccess: 'editor' }, Date.now());
  expect((await getBoardAccess(board.id, outsider.id)).role).toBe('editor');
  expect(await boardEmbedding(board.id)).not.toBeNull();
});

it('a board can’t shed its label: a copy keeps it, copying or moving it where the label doesn’t apply is refused, and a required label can’t be cleared', async () => {
  const owner = await user('Owner');
  const member = await user('Member');
  const ws = await openTeam(owner);
  await inviteToWorkspace(null, ws, owner, { email: member.email, role: 'member' });
  const elsewhere = await createTeamWorkspace(owner.id, `Elsewhere ${++n}`);
  const secret = await createLabel(ws, owner.id, { name: 'Secret', caps: { linkSharing: 'none' } });
  const board = await createBoard(owner.id, 'Merger', '', 'none', { workspaceId: ws });
  await setBoardLabel(board.id, owner.id, secret.id);
  const labelled = await fresh(board.id);

  expect((await duplicateBoard(labelled, owner.id, 'owner')).labelId).toBe(secret.id);
  await expect(duplicateBoard(labelled, owner.id, 'owner', { workspaceId: elsewhere.id })).rejects.toMatchObject({ status: 403, code: 'label_restricted' });
  await expect(moveToWorkspace(labelled, owner.id, { workspaceId: elsewhere.id })).rejects.toMatchObject({ status: 403, code: 'label_restricted' });
  expect((await fresh(board.id)).workspaceId).toBe(ws);

  // Only those who manage its sharing (or content admins) relabel it.
  await expect(setBoardLabel(board.id, member.id, null)).rejects.toMatchObject({ status: 403 });
  await setLabelPolicy(ws, owner.id, { required: true, defaultLabelId: secret.id });
  await expect(setBoardLabel(board.id, owner.id, null)).rejects.toMatchObject({ status: 400, code: 'label_required' });
  expect((await createBoard(member.id, 'New one', '', 'none', { workspaceId: ws })).labelId).toBe(secret.id);

  const changes = await listAuditEvents({ workspaceId: ws, actions: ['board.label_changed'], targetId: board.id }, 10);
  expect(changes.map((e) => e.metadata)).toEqual([expect.objectContaining({ from: null, to: 'Secret' })]);
});
