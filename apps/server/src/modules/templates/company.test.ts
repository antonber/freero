// Company templates (#155): published to an organisation they reach every attached workspace and no
// other; who may publish is the organisation's choice; a locked one can't be removed or withdrawn by
// its owner; a retired one leaves every picker.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account, TemplateContent } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { listAuditEvents } from '../audit/index';
import { createUser } from '../auth/index';
import { addOrganisationMember, attachWorkspace, changeWorkspaceRole, createOrganisation, createTeamWorkspace, inviteToWorkspace, updateWorkspace } from '../workspaces/index';
import { deleteTemplate, listTemplates, publishTemplate, saveTemplate, setTemplateAdminState } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@company.test.freero.app`, password: 'password-123' }, { emailVerified: true });
const content: TemplateContent = { elements: [{ id: 'a', type: 'sticky', x: 0, y: 0, w: 100, h: 100 } as TemplateContent['elements'][number]] };

async function company() {
  const [owner, maker, colleague, stranger, security] = await Promise.all(['Owner', 'Maker', 'Colleague', 'Stranger', 'Security'].map(user));
  const org = await createOrganisation(owner.id, `Acme ${++n}`);
  const design = (await createTeamWorkspace(owner.id, `Design ${n}`)).id;
  const sales = (await createTeamWorkspace(owner.id, `Sales ${n}`)).id;
  for (const ws of [design, sales]) await attachWorkspace(org.id, ws, owner.id);
  await inviteToWorkspace(null, design, owner, { email: maker.email, role: 'member' });
  await inviteToWorkspace(null, sales, owner, { email: colleague.email, role: 'member' });
  const elsewhere = (await createTeamWorkspace(stranger.id, `Elsewhere ${n}`)).id;
  await addOrganisationMember(org.id, owner.id, { email: security.email, role: 'admin' });
  await changeWorkspaceRole(org.id, owner.id, security.id, 'admin', ['security']);
  return { owner, maker, colleague, stranger, security, org, elsewhere };
}
const names = async (u: Account) => (await listTemplates(u.id)).map((t) => t.name);

it('a template published to the organisation reaches every attached workspace under the company’s name and no other workspace; the organisation decides who may publish', async () => {
  const { owner, maker, colleague, stranger, org } = await company();
  const t = await saveTemplate(maker.id, { name: 'Retro', description: '', content });
  await publishTemplate(t.id, maker.id, org.id);
  expect((await listTemplates(colleague.id)).find((x) => x.id === t.id)).toMatchObject({ organisationId: org.id, organisationName: org.name });
  expect(await names(stranger)).not.toContain('Retro');

  await updateWorkspace(org.id, owner.id, { policies: { templatePublishing: 'admins' } });
  const second = await saveTemplate(maker.id, { name: 'Kickoff', description: '', content });
  await expect(publishTemplate(second.id, maker.id, org.id)).rejects.toMatchObject({ status: 403 });
  expect(await names(colleague)).not.toContain('Kickoff');
  // Not to an organisation they aren't in through a workspace, either.
  const other = await createOrganisation(stranger.id, `Other ${++n}`);
  await expect(publishTemplate(second.id, maker.id, other.id)).rejects.toMatchObject({ status: 403 });
});

it('a locked company template is everyone’s to use but its owner can’t delete or withdraw it; retiring takes it out of every picker; both in the organisation’s log', async () => {
  const { owner, maker, colleague, security, org } = await company();
  const t = await saveTemplate(maker.id, { name: 'Brand kit', description: '', content });
  await publishTemplate(t.id, maker.id, org.id);

  await expect(setTemplateAdminState(t.id, security.id, { locked: true })).rejects.toMatchObject({ status: 404 }); // not a content admin
  await expect(setTemplateAdminState(t.id, maker.id, { locked: true })).rejects.toMatchObject({ status: 404 });
  await setTemplateAdminState(t.id, owner.id, { locked: true });
  await expect(deleteTemplate(t.id, maker.id)).rejects.toMatchObject({ status: 409 });
  await expect(publishTemplate(t.id, maker.id, null)).rejects.toMatchObject({ status: 409 });
  expect(await names(colleague)).toContain('Brand kit');

  await setTemplateAdminState(t.id, owner.id, { retired: true });
  expect(await names(colleague)).not.toContain('Brand kit');
  expect(await names(maker)).toContain('Brand kit'); // its owner still has it

  const log = await listAuditEvents({ workspaceId: org.id, actions: ['template.'] }, 10);
  expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['template.published', 'template.locked', 'template.retired']));
});
