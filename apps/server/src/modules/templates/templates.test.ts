import { afterAll, beforeAll, expect, it } from 'vitest';
import type { TemplateContent } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { changeWorkspaceRole, createTeamWorkspace, inviteToWorkspace, removeWorkspaceMember, updateWorkspace } from '../workspaces/index';
import { deleteTemplate, getTemplate, listTemplates, saveTemplate, shareTemplate, unshareOnLeaveConsumer } from './service';

const LIMIT = 2;
beforeAll(() => openTestDb({ MAX_TEMPLATES_PER_USER: String(LIMIT) }));
afterAll(() => closeTestDb());

let n = 0;
const user = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@test.freero.app`, password: 'password-123' });

// A frame with a sticky inside and table cells kept outside the elements map, keyed by element id.
const content = {
  elements: [
    { id: 'f1', type: 'frame', x: 0, y: 0, w: 400, h: 300, title: 'Retro', index: 3 },
    { id: 's1', type: 'sticky', x: 20, y: 40, w: 100, h: 100, frameId: 'f1', text: '<p>Went well</p>' },
  ],
  content: { s1: { cells: { 'r0:c0': 'Ä' } } },
} as unknown as TemplateContent;

it('a saved template comes back intact for its owner and stays invisible to everyone else', async () => {
  const owner = await user('Owner');
  const other = await user('Other');
  const saved = await saveTemplate(owner.id, { name: '  Weekly retro ', description: 'Ours', content });
  expect(saved).toMatchObject({ name: 'Weekly retro', elementCount: 2 });

  expect((await getTemplate(saved.id, owner.id)).content).toEqual(content);
  expect(await listTemplates(other.id)).toEqual([]);
  await expect(getTemplate(saved.id, other.id)).rejects.toMatchObject({ status: 404 });
  await expect(deleteTemplate(saved.id, other.id)).rejects.toMatchObject({ status: 404 });
  expect((await listTemplates(owner.id)).map((t) => t.id)).toEqual([saved.id]);
});

it('parallel saves by one user never land over the template limit', async () => {
  const u = await user('Saver');
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => saveTemplate(u.id, { name: `T${i}`, content })));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(LIMIT);
  expect(await listTemplates(u.id)).toHaveLength(LIMIT);
});

it('refuses content the board could not insert (no elements, duplicate ids)', async () => {
  const u = await user('Sloppy');
  await expect(saveTemplate(u.id, { name: 'Empty', content: { elements: [] } })).rejects.toMatchObject({ status: 400 });
  const dup = { elements: [content.elements[1], content.elements[1]] } as TemplateContent;
  await expect(saveTemplate(u.id, { name: 'Dup', content: dup })).rejects.toMatchObject({ status: 400 });
  expect(await listTemplates(u.id)).toEqual([]);
});

it('a template shared with a team reaches its members — not its guests, not outsiders — until its owner makes it personal again', async () => {
  const verified = (name: string) =>
    createUser({ name, email: `${name.toLowerCase()}${++n}@test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const [owner, member, guest, outsider] = await Promise.all(['TOwner', 'TMember', 'TGuest', 'TOutsider'].map(verified));
  const ws = await createTeamWorkspace(owner.id, 'Design');
  await inviteToWorkspace(null, ws.id, owner, { email: member.email, role: 'member' });
  await inviteToWorkspace(null, ws.id, owner, { email: guest.email, role: 'guest' });

  const t = await saveTemplate(owner.id, { name: 'Kickoff', content, workspaceId: ws.id });
  const sees = async (u: { id: string }) => (await listTemplates(u.id)).some((x) => x.id === t.id);
  expect([await sees(member), await sees(guest), await sees(outsider)]).toEqual([true, false, false]);
  expect((await getTemplate(t.id, member.id)).content).toEqual(content);
  await expect(deleteTemplate(t.id, member.id)).rejects.toMatchObject({ status: 404 }); // only its owner deletes
  await expect(shareTemplate(t.id, outsider.id, ws.id)).rejects.toMatchObject({ status: 403 });

  await shareTemplate(t.id, owner.id, null);
  expect(await sees(member)).toBe(false);
});

it('a team that doesn’t allow downloads keeps its boards from being saved as templates by guests', async () => {
  const owner = await createUser({ name: 'DOwner', email: `downer${++n}@test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const guest = await createUser({ name: 'DGuest', email: `dguest${++n}@test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(owner.id, 'Locked');
  await inviteToWorkspace(null, ws.id, owner, { email: guest.email, role: 'guest' });
  const board = await createBoard(owner.id, 'Confidential', '', 'viewer', { workspaceId: ws.id });
  await updateWorkspace(ws.id, owner.id, { policies: { downloads: 'members' } });
  await expect(saveTemplate(guest.id, { name: 'Copy', content, boardId: board.id })).rejects.toMatchObject({ status: 403 });
  expect(await listTemplates(guest.id)).toEqual([]);
});

it('a workspace admin can take down a member’s team template (a member can’t), and leaving the team stops sharing what one shared there', async () => {
  const verified = (name: string) =>
    createUser({ name, email: `${name.toLowerCase()}${++n}@test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const [owner, admin, author, colleague] = await Promise.all(['UOwner', 'UAdmin', 'UAuthor', 'UColleague'].map(verified));
  const ws = await createTeamWorkspace(owner.id, 'Studio');
  for (const [u, role] of [
    [admin, 'admin'],
    [author, 'member'],
    [colleague, 'member'],
  ] as const)
    await inviteToWorkspace(null, ws.id, owner, { email: u.email, role });
  registerOutboxConsumer(unshareOnLeaveConsumer);

  const stale = await saveTemplate(author.id, { name: 'Stale', content, workspaceId: ws.id });
  expect((await listTemplates(colleague.id)).find((t) => t.id === stale.id)).toMatchObject({ ownerName: 'UAuthor', canUnshare: false });
  await expect(shareTemplate(stale.id, colleague.id, null)).rejects.toMatchObject({ status: 404 });
  expect((await listTemplates(admin.id)).find((t) => t.id === stale.id)?.canUnshare).toBe(true);
  await shareTemplate(stale.id, admin.id, null);
  expect((await listTemplates(colleague.id)).some((t) => t.id === stale.id)).toBe(false);
  expect((await listTemplates(author.id)).some((t) => t.id === stale.id)).toBe(true); // still theirs

  // The membership change is an outbox event of its own transaction; the consumer re-reads the role
  // when it runs, so a demotion that was undone before it ran unshares nothing.
  const kept = await saveTemplate(author.id, { name: 'Kept', content, workspaceId: ws.id });
  await changeWorkspaceRole(ws.id, owner.id, author.id, 'guest');
  await changeWorkspaceRole(ws.id, owner.id, author.id, 'member');
  await drainOutbox(unshareOnLeaveConsumer.name);
  expect((await listTemplates(colleague.id)).some((t) => t.id === kept.id)).toBe(true);
  await removeWorkspaceMember(ws.id, author.id, author.id);
  await drainOutbox(unshareOnLeaveConsumer.name);
  expect((await listTemplates(colleague.id)).some((t) => t.id === kept.id)).toBe(false);
});
