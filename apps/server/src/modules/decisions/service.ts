// Decision snapshots (KAI-161; contract: @freero/shared decisions.ts). A decision is a board, or
// one frame of it, frozen under a name: realtime keeps the content as a 'decision' version, this
// module keeps what the decision is (title, note, frame, who) and serves it to whoever may open
// the board — including viewers who joined later: it is what was decided, published on purpose by
// someone with edit access, and holds only the shared board (never hidden frames' contents or
// anyone's drafts). Ordinary versions stay editors-only (realtime/history.ts).
import {
  diffOutlines,
  MAX_DECISION_NOTE,
  MAX_DECISION_TITLE,
  type Decision,
  type DecisionChanges,
  type DecisionResponse,
} from '@freero/shared';
import { badRequest, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { recordAuditQuietly } from '../audit/index';
import { getUsers } from '../auth/index';
import { requireBoardAccess } from '../boards/index';
import { atLeast } from '../members/index';
import { outlineOfView } from '../outline/index';
import { decisionVersion, frameOnlyState, freezeBoard, liveSharedState, releaseDecisionVersion, viewOfState } from '../realtime/index';
import * as repo from './repo';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function clean(v: unknown, max: number, what: string, required: boolean): string {
  if (v === undefined || v === null) {
    if (required) throw badRequest(`Give the decision a ${what}`);
    return '';
  }
  if (typeof v !== 'string') throw badRequest(`${what} must be text`);
  const t = (what === 'title' ? v.replace(/\s+/g, ' ') : v).trim().slice(0, max);
  if (required && !t) throw badRequest(`Give the decision a ${what}`);
  return t;
}

async function toDecisions(rows: repo.DecisionRow[]): Promise<Decision[]> {
  const users = await getUsers(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])));
  return rows.map((r) => {
    const u = r.createdBy ? users.get(r.createdBy) : undefined;
    return {
      id: r.id,
      boardId: r.boardId,
      title: r.title,
      note: r.note,
      frameId: r.frameId,
      frameTitle: r.frameTitle,
      createdAt: r.createdAt,
      createdBy: u ? { id: u.id, name: u.name } : null,
      versionId: r.versionId,
    };
  });
}

/** Freezes the board (or `frameId`) as it is right now, for everyone, under `title`. Editors and owners. */
export async function createDecision(boardId: string, userId: string, body: unknown): Promise<Decision> {
  const b = (body ?? {}) as Record<string, unknown>;
  const board = await requireBoardAccess(boardId, userId, 'editor');
  const title = clean(b.title, MAX_DECISION_TITLE, 'title', true);
  const note = clean(b.note, MAX_DECISION_NOTE, 'note', false);
  const frameId = b.frameId === undefined || b.frameId === null || b.frameId === '' ? null : String(b.frameId);
  if (frameId !== null && !ID.test(frameId)) throw badRequest('frameId must be an element id');
  const { version, accepted } = await freezeBoard(boardId, userId, title, (state) => {
    if (!frameId) return { frameTitle: null };
    const cut = frameOnlyState(state, frameId);
    // A hidden frame's contents and drafts are in no version: only a frame everyone sees can be frozen.
    if (!cut) throw badRequest('That frame isn’t on the board for everyone (a hidden frame can’t be frozen as a decision)');
    return { frameTitle: cut.frameTitle };
  });
  const row: repo.DecisionRow = {
    id: newId(12),
    boardId,
    versionId: version.id,
    title,
    note,
    frameId,
    frameTitle: accepted.frameTitle,
    createdBy: userId,
    createdAt: version.createdAt,
  };
  await repo.insert(row);
  await recordAuditQuietly({
    action: 'decision.created',
    actorId: userId,
    workspaceId: board.workspaceId,
    target: { type: 'board', id: boardId, label: board.title },
    metadata: { decision: row.id, title, frame: frameId ?? undefined },
  });
  return (await toDecisions([row]))[0];
}

export async function listDecisions(boardId: string, userId: string): Promise<Decision[]> {
  await requireBoardAccess(boardId, userId);
  return toDecisions(await repo.ofBoard(boardId));
}

/** The decision, if `userId` may open its board (404 otherwise, like a board they can't open). */
async function readable(id: string, userId: string) {
  const row = ID.test(id) ? await repo.get(id) : null;
  if (!row) throw notFound('Decision not found');
  const board = await requireBoardAccess(row.boardId, userId);
  return { row, board };
}

export async function getDecision(id: string, userId: string): Promise<DecisionResponse> {
  const { row, board } = await readable(id, userId);
  return { decision: (await toDecisions([row]))[0], board: { id: row.boardId, title: board.title }, canManage: atLeast(board.role, 'editor') };
}

/** What a decision shows: the frozen board, or only its frame. */
async function frozenState(row: repo.DecisionRow): Promise<Uint8Array> {
  const state = await decisionVersion(row.boardId, row.versionId);
  if (!state) throw notFound('Decision not found');
  if (!row.frameId) return state;
  return frameOnlyState(state, row.frameId)?.state ?? new Uint8Array([0, 0]);
}

export async function decisionState(id: string, userId: string): Promise<Uint8Array> {
  const { row } = await readable(id, userId);
  return frozenState(row);
}

/** "What changed since this decision": the outline of the decision against the board now, as everyone sees both. */
export async function decisionChanges(id: string, userId: string): Promise<DecisionChanges> {
  const { row, board } = await readable(id, userId);
  const meta = { id: row.boardId, title: board.title };
  const before = await outlineOfView(meta, viewOfState(await frozenState(row)));
  const live = await liveSharedState(row.boardId);
  const cut = row.frameId ? frameOnlyState(live, row.frameId) : { state: live };
  const after = await outlineOfView(meta, viewOfState(cut?.state ?? new Uint8Array([0, 0])));
  return { ...diffOutlines(before, after, row.createdAt), frameGone: !cut };
}

/** Removes the decision (editors and owners); its version stays in the board's history as a named one. */
export async function deleteDecision(id: string, userId: string): Promise<void> {
  const { row } = await readable(id, userId);
  const board = await requireBoardAccess(row.boardId, userId, 'editor');
  const gone = await repo.remove(row.id);
  if (!gone) return;
  await releaseDecisionVersion(row.boardId, row.versionId);
  await recordAuditQuietly({
    action: 'decision.deleted',
    actorId: userId,
    workspaceId: board.workspaceId,
    target: { type: 'board', id: row.boardId, label: board.title },
    metadata: { decision: row.id, title: row.title },
  });
}

/** The decisions a person made (their data export). */
export async function decisionsExportOf(userId: string) {
  return (await repo.madeBy(userId)).map((d) => ({
    id: d.id,
    boardId: d.boardId,
    title: d.title,
    note: d.note,
    frame: d.frameTitle,
    createdAt: new Date(d.createdAt).toISOString(),
  }));
}
