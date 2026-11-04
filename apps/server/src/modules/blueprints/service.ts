// Blueprints (#161): a project's boards and docs saved as a reusable setup, with a description and
// the steps to follow, personal or shared with a team like a team template. Using one makes a new
// project holding a copy of every item, in ONE transaction (all of it or nothing), with the links
// between the items pointed at the copies.
//
// What is saved is what the saver may take out of each board: the shared content (never hidden
// frames' contents, drafts or ballots — nobody's layers), without comments or session state, and
// only where the boards' downloads policy lets them copy (like saving a template). Using one is
// creating boards: where the person may create them, under their board quota.
import { BLUEPRINT_MAX_ITEMS, type BlueprintSummary, type ObjectKind, type ProjectSummary } from '@freero/shared';
import type { OutboxConsumer } from '../../platform/outbox';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { recordAudit } from '../audit/index';
import { getUsers } from '../auth/index';
import { createBoardWithState, listBoardsIn, requireBoardDownload } from '../boards/index';
import { blueprintState, initBoardDoc, rewriteObjectLinks, snapshotBoardDoc } from '../realtime/index';
import {
  createProject,
  getWorkspaceInfo,
  isManager,
  projectFor,
  requireWorkspace,
  teamWorkspaceIdsFor,
  templatePublishingOf,
  WORKSPACE_MEMBERSHIP_TOPIC,
  workspaceRole,
  workspaceRolesOf,
} from '../workspaces/index';
import * as repo from './repo';
import type { Blueprint, BlueprintItem } from './repo';

/** What one item may weigh, and all of them together. */
const MAX_ITEM_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_STEPS = 20;

const cleanName = (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest('Give the blueprint a name');
  return v.trim().slice(0, 80);
};
const cleanText = (v: unknown, what: string): string => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest(`${what} must be text`);
  return v.slice(0, 4000);
};
const cleanSteps = (v: unknown): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) throw badRequest('steps must be a list of text');
  return (v as string[]).map((s) => s.trim().slice(0, 500)).filter(Boolean).slice(0, MAX_STEPS);
};

/** May they share with this team? A full member, as the workspace's template publishing policy allows. */
async function shareTarget(userId: string, v: unknown): Promise<string | null> {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !(await teamWorkspaceIdsFor(userId)).includes(v)) throw forbidden('You can share blueprints only with a team workspace you are a member of');
  if ((await templatePublishingOf(v)) === 'admins' && !(await administers(v, userId)))
    throw forbidden(`In ${(await getWorkspaceInfo(v))?.name ?? 'this workspace'} only admins share blueprints and templates with the team`);
  return v;
}

async function administers(workspaceId: string, userId: string): Promise<boolean> {
  try {
    await requireWorkspace(workspaceId, userId, 'admin', { scope: 'content' });
    return true;
  } catch {
    return false;
  }
}

async function summaries(list: Blueprint[], userId: string): Promise<BlueprintSummary[]> {
  const [owners, roles] = await Promise.all([getUsers([...new Set(list.map((b) => b.ownerId))]), workspaceRolesOf(userId)]);
  return list.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    steps: b.steps,
    items: b.items,
    ownerId: b.ownerId,
    ownerName: owners.get(b.ownerId)?.name ?? 'Someone',
    workspaceId: b.workspaceId,
    mine: b.ownerId === userId,
    canUnshare: !!b.workspaceId && (b.ownerId === userId || isManager(roles.get(b.workspaceId) ?? null)),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }));
}

/** Yours and those shared with the teams you are a full member of. */
export async function listBlueprints(userId: string): Promise<BlueprintSummary[]> {
  return summaries(await repo.visibleTo(userId, await teamWorkspaceIdsFor(userId)), userId);
}

/** A blueprint the user may see and use (404 otherwise: invisible = absent). */
async function visibleBlueprint(id: string, userId: string): Promise<Blueprint> {
  const b = await repo.getBlueprint(id);
  if (!b) throw notFound('Blueprint not found');
  if (b.ownerId === userId) return b;
  if (b.workspaceId && (await teamWorkspaceIdsFor(userId)).includes(b.workspaceId)) return b;
  throw notFound('Blueprint not found');
}

/** Saves a project's boards and docs (those the person can open and copy) as a blueprint. */
export async function saveFromProject(projectId: string, userId: string, body: Record<string, unknown>): Promise<BlueprintSummary> {
  const project = await projectFor(projectId, userId);
  const name = cleanName(body.name ?? project.name);
  const description = body.description === undefined ? project.description : cleanText(body.description, 'description');
  const steps = cleanSteps(body.steps);
  const workspaceId = await shareTarget(userId, body.workspaceId);
  const boards = (await listBoardsIn(userId, project.workspaceId, '', projectId)).filter((b) => b.projectId === projectId);
  if (boards.length === 0) throw badRequest('This project has no boards or docs to save');
  if (boards.length > BLUEPRINT_MAX_ITEMS) throw badRequest(`A blueprint holds at most ${BLUEPRINT_MAX_ITEMS} boards and docs`);
  // Like saving a template: each board's downloads policy must let them copy its content.
  for (const b of boards) await requireBoardDownload(b.id, userId, 'template');
  const items: BlueprintItem[] = [];
  let total = 0;
  for (const [position, b] of boards.entries()) {
    const raw = await snapshotBoardDoc(b.id);
    const state = raw ? blueprintState(raw) : null;
    const bytes = state?.byteLength ?? 0;
    if (bytes > MAX_ITEM_BYTES) throw new HttpError(413, `“${b.title}” is too large for a blueprint`);
    total += bytes;
    items.push({ position, sourceId: b.id, kind: b.kind, title: b.title, description: b.description ?? '', state });
  }
  if (total > MAX_TOTAL_BYTES) throw new HttpError(413, 'These boards together are too large for one blueprint');
  const now = Date.now();
  const bp = { id: newId(12), ownerId: userId, workspaceId, name, description, steps, createdAt: now, updatedAt: now };
  await repo.transaction(async () => {
    await repo.insertBlueprint(bp, items);
    if (workspaceId)
      await recordAudit({ action: 'blueprint.shared', workspaceId, actorId: userId, target: { type: 'blueprint', id: bp.id, label: name }, metadata: { items: items.length } });
  });
  return (await summaries([{ ...bp, items: items.map((i) => ({ kind: i.kind, title: i.title })) }], userId))[0];
}

/** Rename / describe / re-step / share or unshare (its owner); the team's owners and content admins may unshare it. */
export async function updateBlueprint(id: string, userId: string, body: Record<string, unknown>): Promise<BlueprintSummary> {
  const b = await visibleBlueprint(id, userId);
  if (b.ownerId !== userId) {
    const onlyUnshare = Object.keys(body).length === 1 && body.workspaceId === null;
    if (!onlyUnshare || !b.workspaceId || !(await administers(b.workspaceId, userId))) throw forbidden('Only its owner can change this blueprint');
  }
  const patch = {
    ...(body.name !== undefined ? { name: cleanName(body.name) } : {}),
    ...(body.description !== undefined ? { description: cleanText(body.description, 'description') } : {}),
    ...(body.steps !== undefined ? { steps: cleanSteps(body.steps) } : {}),
    ...(body.workspaceId !== undefined ? { workspaceId: b.ownerId === userId ? await shareTarget(userId, body.workspaceId) : null } : {}),
  };
  if (!(await repo.updateBlueprint(id, patch, Date.now()))) throw notFound('Blueprint not found');
  return (await summaries([(await repo.getBlueprint(id))!], userId))[0];
}

export async function deleteBlueprint(id: string, userId: string): Promise<void> {
  const b = await visibleBlueprint(id, userId);
  if (b.ownerId !== userId) throw forbidden('Only its owner can delete this blueprint');
  await repo.deleteBlueprint(id);
}

/** The new project's page: the blueprint's description, then its steps. */
function projectDescription(b: Blueprint): string {
  const steps = b.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [b.description.trim(), steps ? `Steps:\n${steps}` : ''].filter(Boolean).join('\n\n').slice(0, 2000);
}

/**
 * Makes a project from a blueprint in `workspaceId` (optionally inside `parentId`): the project
 * and a copy of every board and doc, in ONE transaction — if any part fails (the board quota, a
 * project the person can't use, storage), nothing of it is left. Links from one item to another
 * lead to the copies.
 */
export async function useBlueprint(
  id: string,
  userId: string,
  body: { workspaceId?: unknown; name?: unknown; parentId?: unknown },
): Promise<{ project: ProjectSummary; boards: Array<{ id: string; kind: ObjectKind; title: string }> }> {
  const b = await visibleBlueprint(id, userId);
  if (typeof body.workspaceId !== 'string' || !body.workspaceId) throw badRequest('workspaceId is required');
  const workspaceId = body.workspaceId;
  const name = body.name === undefined || body.name === null || body.name === '' ? b.name : cleanName(body.name);
  // Read before the transaction (a large blueprint shouldn't hold locks while it loads).
  const items = await repo.itemsOf(b.id);
  const made = await repo.transaction(async () => {
    const project = await createProject(workspaceId, userId, { name, description: projectDescription(b), ...(body.parentId ? { parentId: body.parentId } : {}) });
    const place = { workspaceId, projectId: project.id };
    const copies: Array<{ item: BlueprintItem; copy: Awaited<ReturnType<typeof createBoardWithState>> }> = [];
    for (const item of items) copies.push({ item, copy: await createBoardWithState(userId, { title: item.title, description: item.description, kind: item.kind }, place, null) });
    // Every copy has its id now: point the links between them at the copies, then store the content.
    const ids = new Map(copies.map(({ item, copy }) => [item.sourceId, copy.id]));
    for (const { item, copy } of copies) if (item.state) await initBoardDoc(copy.id, rewriteObjectLinks(item.state, ids));
    await recordAudit({ action: 'blueprint.used', workspaceId, actorId: userId, target: { type: 'project', id: project.id, label: project.name }, metadata: { blueprint: b.id, blueprintName: b.name, items: copies.length } });
    return { project, copies };
  });
  for (const { copy } of made.copies) await copy.announce();
  return { project: made.project, boards: made.copies.map(({ copy }) => ({ id: copy.id, kind: copy.kind, title: copy.title })) };
}

/** Someone left a workspace or became a guest there: what they shared with it is theirs alone again. */
export const unshareOnLeaveConsumer: OutboxConsumer = {
  name: 'blueprints:unshare-on-leave',
  topics: [WORKSPACE_MEMBERSHIP_TOPIC],
  lockKey: 7_202_611_301, // arbitrary, constant across releases
  async handle(events) {
    for (const e of events) {
      const p = e.payload as { workspaceId?: unknown; userId?: unknown } | null;
      if (typeof p?.workspaceId !== 'string' || typeof p.userId !== 'string') continue;
      const role = await workspaceRole(p.workspaceId, p.userId);
      if (role === null || role === 'guest') await repo.unshareAllOf(p.userId, p.workspaceId, Date.now());
    }
  },
};
