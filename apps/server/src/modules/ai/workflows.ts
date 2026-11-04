// Saved AI workflows (#1): a named instruction for the board assistant, run again from any board.
//
// - Keep: anyone signed in who can open the board (up to AI_WORKFLOW_LIMITS.perUser). The prompt is
//   the person's own words, not board content.
// - Share: with the team workspace of the board it is saved or edited on, when its owner is a full
//   member there (not a guest); it is then listed on every board of that workspace for whoever can
//   open them. It stops being shared when its owner leaves or becomes a guest (outbox consumer), or
//   when an owner / admin of that workspace unshares it. Only its owner changes or deletes it.
// - Run: assistant.ts `runWorkflowTurn` — the assistant's own checks (who may use AI here, budgets,
//   rate limits, downloads policy, audit as task `workflow`), editors only, and its result is ALWAYS
//   a group of pending suggestions: nothing on the board changes until someone accepts them.
import {
  AI_WORKFLOW_LIMITS,
  type AiWorkflow,
  type AiWorkflowList,
  type AiWorkflowResult,
  type AiWorkflowScope,
} from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import type { OutboxConsumer } from '../../platform/outbox';
import { getUsers } from '../auth/index';
import { boardWorkspaceId, requireBoardAccess } from '../boards/index';
import { getWorkspaceInfo, isFullMember, isManager, WORKSPACE_MEMBERSHIP_TOPIC, workspaceRole } from '../workspaces/index';
import { runWorkflowTurn } from './assistant';
import * as repo from './repo';

const SCOPES: readonly AiWorkflowScope[] = ['board', 'selection'];
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

function cleanText(v: unknown, max: number, what: 'name' | 'prompt'): string {
  if (typeof v !== 'string') throw badRequest(what === 'name' ? 'Give the workflow a name' : 'Say what the workflow should do', `ai_workflow_${what}`);
  const t = (what === 'name' ? v.replace(/\s+/g, ' ') : v.replace(/\r\n?/g, '\n')).replace(CONTROL, '').trim();
  if (!t) throw badRequest(what === 'name' ? 'Give the workflow a name' : 'Say what the workflow should do', `ai_workflow_${what}`);
  if (t.length > max) throw badRequest(`A workflow’s ${what} may be at most ${max} characters`, `ai_workflow_${what}_long`, { max });
  return t;
}
function cleanScope(v: unknown): AiWorkflowScope {
  if (!SCOPES.includes(v as AiWorkflowScope)) throw badRequest('scope must be board or selection', 'ai_workflow_scope');
  return v as AiWorkflowScope;
}

/** The board's team workspace when `userId` is a full member of it (where a workflow can be shared), else null. */
async function shareTargetOf(boardId: string, userId: string): Promise<{ id: string; name: string } | null> {
  await requireBoardAccess(boardId, userId, 'viewer');
  const workspaceId = await boardWorkspaceId(boardId);
  const ws = workspaceId ? await getWorkspaceInfo(workspaceId) : null;
  if (!ws || ws.kind !== 'team' || !isFullMember(await workspaceRole(ws.id, userId))) return null;
  return { id: ws.id, name: ws.name };
}

async function present(list: repo.StoredWorkflow[], userId: string): Promise<AiWorkflow[]> {
  const owners = await getUsers([...new Set(list.map((w) => w.ownerId))]);
  const managed = new Map<string, boolean>();
  for (const id of new Set(list.flatMap((w) => (w.workspaceId ? [w.workspaceId] : [])))) managed.set(id, isManager(await workspaceRole(id, userId)));
  return list.map((w) => ({
    id: w.id,
    name: w.name,
    prompt: w.prompt,
    scope: w.scope,
    workspaceId: w.workspaceId,
    ownerName: owners.get(w.ownerId)?.name ?? 'Someone',
    mine: w.ownerId === userId,
    canUnshare: !!w.workspaceId && (w.ownerId === userId || (managed.get(w.workspaceId) ?? false)),
    updatedAt: w.updatedAt,
  }));
}

/** Yours, and those shared with the board's workspace (when you are in it), newest first. */
export async function listWorkflows(boardId: string, userId: string): Promise<AiWorkflowList> {
  await requireBoardAccess(boardId, userId, 'viewer');
  const workspaceId = await boardWorkspaceId(boardId);
  // Shared ones are the workspace's members' (guests too: they run them on boards they edit); not
  // someone on the board through a board invite only.
  const inWorkspace = workspaceId ? (await workspaceRole(workspaceId, userId)) !== null : false;
  const list = await repo.workflowsFor(userId, inWorkspace ? workspaceId : null);
  return { workflows: await present(list, userId), shareWith: await shareTargetOf(boardId, userId) };
}

/** A workflow `userId` may see on this board, or 404. */
async function visibleOn(boardId: string, workflowId: string, userId: string): Promise<repo.StoredWorkflow> {
  await requireBoardAccess(boardId, userId, 'viewer');
  const w = await repo.getWorkflow(workflowId);
  if (w && w.ownerId === userId) return w;
  if (w?.workspaceId && w.workspaceId === (await boardWorkspaceId(boardId)) && (await workspaceRole(w.workspaceId, userId)) !== null) return w;
  throw notFound('Workflow not found');
}

export async function createWorkflow(boardId: string, userId: string, body: unknown): Promise<AiWorkflow> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = cleanText(b.name, AI_WORKFLOW_LIMITS.name, 'name');
  const prompt = cleanText(b.prompt, AI_WORKFLOW_LIMITS.prompt, 'prompt');
  const scope = cleanScope(b.scope ?? 'board');
  let workspaceId: string | null = null;
  if (b.shared === true) {
    const target = await shareTargetOf(boardId, userId);
    if (!target) throw forbidden('You can share a workflow only with a team workspace you are a member of', 'ai_workflow_share');
    workspaceId = target.id;
  } else await requireBoardAccess(boardId, userId, 'viewer');
  const now = Date.now();
  const w: repo.StoredWorkflow = { id: newId(12), ownerId: userId, workspaceId, name, prompt, scope, createdAt: now, updatedAt: now };
  await repo.transaction(async () => {
    await repo.lockWorkflowOwner(userId);
    if ((await repo.countWorkflowsOf(userId)) >= AI_WORKFLOW_LIMITS.perUser)
      throw new HttpError(403, `You can keep at most ${AI_WORKFLOW_LIMITS.perUser} workflows. Delete one you no longer use first.`, 'ai_workflow_limit', { max: AI_WORKFLOW_LIMITS.perUser });
    await repo.insertWorkflow(w);
  });
  return (await present([w], userId))[0];
}

export async function updateWorkflow(boardId: string, workflowId: string, userId: string, body: unknown): Promise<AiWorkflow> {
  const b = (body ?? {}) as Record<string, unknown>;
  const w = await visibleOn(boardId, workflowId, userId);
  if (w.ownerId !== userId) {
    // The workspace's owners and admins may take a shared workflow back out of it, nothing else.
    const onlyUnshare = Object.keys(b).length === 1 && b.shared === false;
    if (!onlyUnshare || !w.workspaceId || !isManager(await workspaceRole(w.workspaceId, userId))) throw forbidden('Only its owner can change this workflow', 'ai_workflow_owner_only');
  }
  const next = { ...w, updatedAt: Date.now() };
  if (b.name !== undefined) next.name = cleanText(b.name, AI_WORKFLOW_LIMITS.name, 'name');
  if (b.prompt !== undefined) next.prompt = cleanText(b.prompt, AI_WORKFLOW_LIMITS.prompt, 'prompt');
  if (b.scope !== undefined) next.scope = cleanScope(b.scope);
  if (b.shared === false) next.workspaceId = null;
  else if (b.shared === true) {
    const target = await shareTargetOf(boardId, userId);
    if (!target) throw forbidden('You can share a workflow only with a team workspace you are a member of', 'ai_workflow_share');
    next.workspaceId = target.id;
  }
  await repo.updateWorkflow(next);
  return (await present([next], userId))[0];
}

export async function deleteWorkflow(boardId: string, workflowId: string, userId: string): Promise<void> {
  const w = await visibleOn(boardId, workflowId, userId);
  if (w.ownerId !== userId) throw forbidden('Only its owner can delete this workflow', 'ai_workflow_owner_only');
  await repo.deleteWorkflow(w.id);
}

/** Runs a workflow on the board: at most a group of pending suggestions (see assistant.ts). */
export async function runWorkflow(boardId: string, workflowId: string, userId: string, body: unknown): Promise<AiWorkflowResult> {
  const w = await visibleOn(boardId, workflowId, userId);
  const raw = (body ?? {}) as { ids?: unknown };
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200).slice(0, 200) : [];
  return runWorkflowTurn(boardId, userId, { id: w.id, name: w.name, scope: w.scope, prompt: w.prompt }, w.scope === 'selection' ? ids : []);
}

/** Data exports: a person's own workflows, or those shared with a workspace. */
export async function workflowsExportOf(by: { ownerId: string } | { workspaceId: string }) {
  const list = 'ownerId' in by ? await repo.workflowsOwnedBy(by.ownerId) : await repo.workflowsSharedWith(by.workspaceId);
  return list.map((w) => ({
    id: w.id,
    name: w.name,
    prompt: w.prompt,
    scope: w.scope,
    ...('workspaceId' in by ? { ownerId: w.ownerId } : { sharedWith: w.workspaceId }),
    createdAt: new Date(w.createdAt).toISOString(),
    updatedAt: new Date(w.updatedAt).toISOString(),
  }));
}

/** Someone left a workspace or became a guest there: what they shared with it is theirs alone again. */
export const unshareWorkflowsOnLeave: OutboxConsumer = {
  name: 'ai:workflows-unshare-on-leave',
  topics: [WORKSPACE_MEMBERSHIP_TOPIC],
  lockKey: 7_202_612_031, // arbitrary, constant across releases
  async handle(events) {
    for (const e of events) {
      const p = e.payload as { workspaceId?: unknown; userId?: unknown } | null;
      if (typeof p?.workspaceId !== 'string' || typeof p.userId !== 'string') continue;
      const role = await workspaceRole(p.workspaceId, p.userId);
      if (role === null || role === 'guest') await repo.unshareWorkflowsOf(p.userId, p.workspaceId, Date.now());
    }
  },
};
