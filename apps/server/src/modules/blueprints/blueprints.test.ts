// Blueprints (#161) against real stored boards, real quotas and real access rules.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { boardIdsOwnedByUser, createBoard } from '../boards/index';
import { initBoardDoc, snapshotBoardDoc } from '../realtime/index';
import { createProject, createTeamWorkspace, inviteToWorkspace, listProjects } from '../workspaces/index';
import { saveFromProject, useBlueprint } from './service';

// Three boards per person: enough for one copy of a two-board blueprint, not for two.
beforeAll(() => openTestDb({ MAX_BOARDS_PER_USER: '3' }));
afterAll(() => closeTestDb());

let n = 0;
const user = (name: string): Promise<Account> =>
  createUser({ name, email: `${name.toLowerCase()}-${++n}@blueprints.test.freero.app`, password: 'password-123' }, { emailVerified: true });

function state(collections: Record<string, Record<string, unknown>>): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const [name, entries] of Object.entries(collections)) for (const [k, v] of Object.entries(entries)) doc.getMap(name).set(k, v);
  });
  return Y.encodeStateAsUpdate(doc);
}
const sticky = (id: string, text: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 1, text, createdBy: 'x', createdAt: 1, updatedAt: 1 });

/** A team with a project of two boards (the plan links to the retro, and to a board outside the project). */
async function setup() {
  const [lead, member] = await Promise.all([user('Lead'), user('Member')]);
  const ws = await createTeamWorkspace(lead.id, `Team ${++n}`);
  await inviteToWorkspace(null, ws.id, lead, { email: member.email, role: 'member' });
  const project = await createProject(ws.id, lead.id, { name: 'Programme' });
  const outside = await createBoard(lead.id, 'Elsewhere', '', 'none', { workspaceId: ws.id });
  const retro = await createBoard(lead.id, 'Retro', '', 'none', { workspaceId: ws.id, projectId: project.id });
  const plan = await createBoard(lead.id, 'Plan', '', 'none', { workspaceId: ws.id, projectId: project.id });
  await initBoardDoc(
    plan.id,
    state({
      elements: { s1: sticky('s1', `Retro: <a href="/board/${retro.id}">open</a>, archive: freero://board/${outside.id}`) },
      comments: { 't:th1': { kind: 'thread', id: 'th1', x: 0, y: 0, createdBy: lead.id, createdAt: 1 } },
    }),
  );
  const blueprint = await saveFromProject(project.id, lead.id, { name: 'Quarterly programme', steps: ['Plan', 'Run the retro'], workspaceId: ws.id });
  return { ws: ws.id, lead, member, retro, plan, outside, blueprint };
}

it('using a blueprint makes the project and every copy — or, when one copy can’t be made, nothing at all', async () => {
  const { ws, member, blueprint } = await setup();
  const first = await useBlueprint(blueprint.id, member.id, { workspaceId: ws });
  expect(first.boards.map((b) => b.title).sort()).toEqual(['Plan', 'Retro']);
  const projectsBefore = (await listProjects(ws, member.id)).length;

  // A second copy would pass their board quota halfway through: no project, no stray board.
  await expect(useBlueprint(blueprint.id, member.id, { workspaceId: ws, name: 'Again' })).rejects.toMatchObject({ status: 403 });
  expect(await boardIdsOwnedByUser(member.id)).toHaveLength(2);
  expect((await listProjects(ws, member.id)).length).toBe(projectsBefore);
});

it('links between a blueprint’s boards lead to the copies, links elsewhere stay, and the originals’ comments don’t come along', async () => {
  const { ws, member, retro, outside, blueprint } = await setup();
  const { boards } = await useBlueprint(blueprint.id, member.id, { workspaceId: ws });
  const plan = boards.find((b) => b.title === 'Plan')!;
  const retroCopy = boards.find((b) => b.title === 'Retro')!;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await snapshotBoardDoc(plan.id))!);
  const text = (doc.getMap('elements').get('s1') as { text: string }).text;
  expect(text).toContain(`/board/${retroCopy.id}`);
  expect(text).not.toContain(retro.id);
  expect(text).toContain(`freero://board/${outside.id}`);
  expect(doc.getMap('comments').size).toBe(0);
});
