// eDiscovery cases and their legal holds (#157; docs/design/compliance.md §1). A case belongs to a
// team workspace or an organisation (its "place") and names custodians — every board a person owns
// in the case's workspaces, now and later — and boards. The hold itself lives in modules/boards
// (the only module that deletes boards), keyed by the case id; this module keeps the case, places,
// narrows and releases the hold, and builds the case's export. Managing a case takes an owner, or
// an admin with BOTH the security and the content scopes (a case reveals all of its boards).
import type { LegalCaseBoard, LegalCaseChange, LegalCaseDetail, LegalCaseExportInfo, LegalCaseInput, LegalCaseSummary } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log, logError } from '../../platform/log';
import { recordAudit } from '../audit/index';
import { getUsers } from '../auth/index';
import { boardRecords, boardsUnderLegalHold, legalHoldScope, narrowLegalHold, placeLegalHold, releaseLegalHold } from '../boards/index';
import { deletePrivateFile, newPrivateFileKey, openPrivateFile, savePrivateFile } from '../uploads/index';
import { attachedWorkspaceIds, getWorkspaceInfo, requireScope, requireWorkspace, workspaceRole } from '../workspaces/index';
import { buildCaseArchive } from './archive';
import * as repo from './repo';

const MAX_SUBJECTS = 500;
const STALE_MS = 30 * 60_000;
export const CASE_EXPORT_LOCK_KEY = 7_202_611_311; // arbitrary, constant across releases

export interface Place {
  id: string;
  name: string;
  kind: 'team' | 'organisation';
}

/** The place, if `userId` may manage its cases: 404 for no such team workspace / organisation, 403 without both scopes. */
export async function requireCaseManager(placeId: string, userId: string): Promise<Place> {
  const { workspace, scopes } = await requireWorkspace(placeId, userId, 'admin', { organisation: true, scope: 'security' });
  const what = workspace.kind === 'organisation' ? 'organisation' : 'workspace';
  requireScope(scopes, 'content', what);
  if (workspace.kind === 'personal') throw notFound('Workspace not found');
  return { id: workspace.id, name: workspace.name, kind: workspace.kind };
}

const caseTarget = (c: { id: string; name: string }) => ({ type: 'legal_case', id: c.id, label: c.name });

function cleanText(v: unknown, what: string, max: number, required: boolean): string | undefined {
  if (v === undefined || v === null) {
    if (required) throw badRequest(`${what} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw badRequest(`${what} must be text`);
  const s = v.trim();
  if (required && !s) throw badRequest(`${what} is required`);
  if (s.length > max) throw badRequest(`${what} is longer than ${max} characters`);
  return s;
}

function ids(v: unknown, what: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) throw badRequest(`${what} must be a list of ids`);
  const out = [...new Set(v as string[])];
  if (out.length > MAX_SUBJECTS) throw badRequest(`At most ${MAX_SUBJECTS} ${what} per change`);
  return out;
}

/** The workspaces a new case at `place` covers: its own, or the organisation's attached ones. */
async function workspacesOf(place: Place): Promise<string[]> {
  return place.kind === 'team' ? [place.id] : attachedWorkspaceIds(place.id);
}

/** Each custodian with the covered workspaces they're a member of; 400 for anyone in none of them. */
async function custodianRows(people: string[], workspaceIds: string[]): Promise<Array<{ workspaceId: string; ownerId: string }>> {
  const rows = await membershipRows(people, workspaceIds);
  for (const userId of people) if (!rows.some((r) => r.ownerId === userId)) throw badRequest('A custodian must be a member of a workspace the case covers');
  return rows;
}

async function membershipRows(people: string[], workspaceIds: string[]): Promise<Array<{ workspaceId: string; ownerId: string }>> {
  const rows: Array<{ workspaceId: string; ownerId: string }> = [];
  for (const userId of people) for (const workspaceId of workspaceIds) if ((await workspaceRole(workspaceId, userId)) !== null) rows.push({ workspaceId, ownerId: userId });
  return rows;
}

/** 400 unless every board is in a workspace the case covers (any state: trashed boards are evidence too). */
async function checkBoards(boardIds: string[], workspaceIds: string[]): Promise<void> {
  if (!boardIds.length) return;
  const found = await boardRecords(boardIds);
  const covered = new Set(workspaceIds);
  if (found.length !== boardIds.length || found.some((b) => !covered.has(b.workspaceId))) throw badRequest('Every board must be in a workspace the case covers');
}

export async function createCase(placeId: string, userId: string, input: LegalCaseInput): Promise<LegalCaseDetail> {
  const place = await requireCaseManager(placeId, userId);
  const name = cleanText(input?.name, 'A name', 120, true)!;
  const description = cleanText(input?.description, 'The description', 2000, false) ?? '';
  const custodianIds = ids(input?.custodianIds, 'custodians');
  const boardIds = ids(input?.boardIds, 'boards');
  const workspaceIds = await workspacesOf(place);
  const custodians = await custodianRows(custodianIds, workspaceIds);
  await checkBoards(boardIds, workspaceIds);
  const id = newId(16);
  const now = Date.now();
  await repo.transaction(async () => {
    await repo.insertCase({ id, placeId: place.id, placeKind: place.kind, name, description, createdBy: userId, workspaceIds }, now);
    await repo.addSubjects(id, 'custodian', custodianIds, now);
    await repo.addSubjects(id, 'board', boardIds, now);
    await placeLegalHold(id, { boardIds, custodians }, now);
    await recordAudit({
      action: 'legal_hold.created',
      workspaceId: place.id,
      actorId: userId,
      target: caseTarget({ id, name }),
      metadata: { custodians: custodianIds, boards: boardIds, workspaces: workspaceIds.length },
    });
  });
  log(`ediscovery: legal hold ${id} placed in ${place.id}`);
  return caseDetail(place, id);
}

export async function changeCase(placeId: string, caseId: string, userId: string, change: LegalCaseChange): Promise<LegalCaseDetail> {
  const place = await requireCaseManager(placeId, userId);
  const name = cleanText(change?.name, 'A name', 120, change?.name !== undefined);
  const description = cleanText(change?.description, 'The description', 2000, false);
  const addPeople = ids(change?.addCustodianIds, 'custodians');
  const removePeople = ids(change?.removeCustodianIds, 'custodians');
  const addBoards = ids(change?.addBoardIds, 'boards');
  const removeBoards = ids(change?.removeBoardIds, 'boards');
  const now = Date.now();
  // Validate against what the case covers before taking its lock (reads first, then the transaction).
  const before = await repo.getCase(caseId, place.id);
  if (!before || before.releasedAt !== null) throw notFound('No open case with that id here');
  const newWorkspaces = change?.refreshWorkspaces && place.kind === 'organisation' ? (await attachedWorkspaceIds(place.id)).filter((w) => !before.workspaceIds.includes(w)) : [];
  const covered = [...before.workspaceIds, ...newWorkspaces];
  const added = await custodianRows(addPeople, covered);
  // Custodians already named reach the newly covered workspaces too.
  const extended = await membershipRows(
    before.custodianIds.filter((p) => !removePeople.includes(p)),
    newWorkspaces,
  );
  await checkBoards(addBoards, covered);
  await repo.transaction(async () => {
    const c = await repo.lockOpenCase(caseId, place.id);
    if (!c) throw notFound('No open case with that id here');
    if (name !== undefined || description !== undefined) await repo.renameCase(caseId, { name, description });
    await repo.addWorkspaces(caseId, newWorkspaces);
    await repo.removeSubjects(caseId, 'custodian', removePeople);
    await repo.removeSubjects(caseId, 'board', removeBoards);
    await narrowLegalHold(caseId, { boardIds: removeBoards, ownerIds: removePeople });
    await repo.addSubjects(caseId, 'custodian', addPeople, now);
    await repo.addSubjects(caseId, 'board', addBoards, now);
    await placeLegalHold(caseId, { boardIds: addBoards, custodians: [...added, ...extended] }, now);
    await recordAudit({
      action: 'legal_hold.scope_changed',
      workspaceId: place.id,
      actorId: userId,
      target: caseTarget({ id: caseId, name: name ?? c.name }),
      metadata: {
        addedCustodians: addPeople,
        removedCustodians: removePeople,
        addedBoards: addBoards,
        removedBoards: removeBoards,
        addedWorkspaces: newWorkspaces,
        ...(name !== undefined && name !== c.name ? { renamed: true } : {}),
      },
    });
  });
  return caseDetail(place, caseId);
}

/** Ends the hold: boards no other case keeps follow their normal retention again. The case stays listed. */
export async function releaseCase(placeId: string, caseId: string, userId: string): Promise<LegalCaseDetail> {
  const place = await requireCaseManager(placeId, userId);
  await repo.transaction(async () => {
    const c = await repo.lockOpenCase(caseId, place.id);
    if (!c) throw notFound('No open case with that id here');
    const held = (await boardsUnderLegalHold(caseId)).length;
    await releaseLegalHold(caseId);
    await repo.markReleased(caseId, userId, Date.now());
    await recordAudit({ action: 'legal_hold.released', workspaceId: place.id, actorId: userId, target: caseTarget(c), metadata: { boards: held } });
  });
  log(`ediscovery: legal hold ${caseId} released in ${place.id}`);
  return caseDetail(place, caseId);
}

export async function listCases(placeId: string, userId: string): Promise<LegalCaseSummary[]> {
  const place = await requireCaseManager(placeId, userId);
  const cases = await repo.casesOf(place.id);
  const people = await getUsers([...new Set(cases.flatMap((c) => [...c.custodianIds, c.createdBy ?? '', c.releasedBy ?? '']).filter(Boolean))]);
  const out: LegalCaseSummary[] = [];
  for (const c of cases) out.push(summaryOf(c, people, c.releasedAt === null ? (await boardsUnderLegalHold(c.id)).length : 0));
  return out;
}

export async function getCaseDetail(placeId: string, caseId: string, userId: string): Promise<LegalCaseDetail> {
  return caseDetail(await requireCaseManager(placeId, userId), caseId);
}

type People = Awaited<ReturnType<typeof getUsers>>;
const person = (people: People, id: string | null) => (id ? { id, name: people.get(id)?.name ?? 'Deleted user' } : null);

function summaryOf(c: repo.CaseRecord, people: People, heldBoards: number): LegalCaseSummary {
  return {
    id: c.id,
    placeId: c.placeId,
    name: c.name,
    description: c.description,
    createdAt: c.createdAt,
    createdBy: person(people, c.createdBy),
    releasedAt: c.releasedAt,
    releasedBy: person(people, c.releasedBy),
    custodians: c.custodianIds.map((id) => ({ userId: id, name: people.get(id)?.name ?? 'Deleted user', email: people.get(id)?.email ?? null })),
    boardIds: c.boardIds,
    heldBoards,
  };
}

async function caseDetail(place: Place, caseId: string): Promise<LegalCaseDetail> {
  const c = await repo.getCase(caseId, place.id);
  if (!c) throw notFound('No case with that id here');
  const held = c.releasedAt === null ? await boardsUnderLegalHold(c.id) : [];
  const exports = await repo.exportsOf(c.id);
  const people = await getUsers([
    ...new Set([...c.custodianIds, c.createdBy ?? '', c.releasedBy ?? '', ...held.map((b) => b.ownerId), ...exports.map((e) => e.requestedBy ?? '')].filter(Boolean)),
  ]);
  const names = new Map<string, string>();
  for (const id of new Set([...c.workspaceIds, ...held.map((b) => b.workspaceId)])) names.set(id, (await getWorkspaceInfo(id))?.name ?? 'Deleted workspace');
  const named = new Set(c.boardIds);
  const boards: LegalCaseBoard[] = held.map((b) => ({
    id: b.id,
    kind: b.kind,
    title: b.title,
    ownerName: people.get(b.ownerId)?.name ?? 'Deleted user',
    workspaceId: b.workspaceId,
    workspaceName: names.get(b.workspaceId) ?? '',
    state: b.state,
    named: named.has(b.id),
  }));
  return {
    ...summaryOf(c, people, held.length),
    boards,
    workspaces: c.workspaceIds.map((id) => ({ id, name: names.get(id) ?? 'Deleted workspace' })),
    exports: exports.map((e) => exportInfo(e, people)),
  };
}

const exportInfo = (e: repo.ExportRecord, people: People): LegalCaseExportInfo => ({
  id: e.id,
  status: e.status,
  createdAt: e.createdAt,
  readyAt: e.readyAt,
  expiresAt: e.expiresAt,
  bytes: e.bytes,
  requestedBy: person(people, e.requestedBy),
});

// ---- retention holds: what the audit log and organisations must keep ----

/**
 * Of these audit chains, the ones an open case keeps whole: its place's ('w:<place>'), each workspace
 * it covers, and each custodian's own account log ('u:<id>').
 */
export async function heldAuditChains(chains: string[]): Promise<Set<string>> {
  const keep = new Set<string>();
  for (const c of await repo.openCases()) {
    keep.add(`w:${c.placeId}`);
    for (const w of c.workspaceIds) keep.add(`w:${w}`);
    for (const p of c.custodianIds) keep.add(`u:${p}`);
  }
  return new Set(chains.filter((ch) => keep.has(ch)));
}

/** An organisation with an open case can't be deleted (a team workspace is refused by boards' own hold check). */
export async function organisationDeletionHold(workspaceId: string): Promise<string | null> {
  return (await repo.hasOpenCaseAt(workspaceId, 'organisation')) ? 'a legal hold is in place' : null;
}

// ---- exports ----

export async function requestCaseExport(placeId: string, caseId: string, userId: string): Promise<LegalCaseExportInfo> {
  const place = await requireCaseManager(placeId, userId);
  const c = await repo.getCase(caseId, place.id);
  if (!c) throw notFound('No case with that id here');
  const id = newId(20);
  await repo.transaction(async () => {
    if (!(await repo.insertExport({ id, caseId, requestedBy: userId }, Date.now()))) throw new HttpError(409, 'An export of this case is already being prepared.');
    await recordAudit({ action: 'legal_hold.export_requested', workspaceId: place.id, actorId: userId, target: caseTarget(c), metadata: { exportId: id } });
  });
  const e = (await repo.getExport(id))!;
  return exportInfo(e, await getUsers([userId]));
}

/** The archive for someone who may manage the case, or 404. Audited. */
export async function openCaseExport(placeId: string, caseId: string, exportId: string, userId: string) {
  const place = await requireCaseManager(placeId, userId);
  const c = await repo.getCase(caseId, place.id);
  const e = await repo.getExport(exportId);
  if (!c || !e || e.caseId !== c.id || e.status !== 'ready' || !e.fileKey || (e.expiresAt ?? 0) <= Date.now()) throw notFound('That export is not available (it may have expired)');
  const file = await openPrivateFile(e.fileKey);
  if (!file) throw notFound('That export is not available (it may have expired)');
  await recordAudit({ action: 'legal_hold.export_downloaded', workspaceId: place.id, actorId: userId, target: caseTarget(c), metadata: { exportId } });
  return { ...file, filename: `freero-case-${c.id}-${new Date(e.readyAt ?? Date.now()).toISOString().slice(0, 10)}.zip` };
}

/**
 * Deletes expired and failed exports' files, retries (or fails) stale builds, builds every pending
 * export. Claim-based: safe on many instances.
 */
export async function processCaseExports(): Promise<number> {
  const now = Date.now();
  for (const f of await repo.filesToDrop(now)) {
    await deletePrivateFile(f.fileKey);
    await repo.fileDropped(f.id);
  }
  await repo.requeueStale(now - STALE_MS);
  let built = 0;
  for (;;) {
    const e = await repo.claimNext(Date.now(), newPrivateFileKey());
    if (!e) return built;
    try {
      const c = await repo.getCaseById(e.caseId);
      if (!c) throw new Error('the case is gone');
      const zip = await buildCaseArchive(c, await legalHoldScope(c.id), e.requestedBy);
      const key = e.fileKey!; // recorded by the claim, so whatever happens next the row still names the file
      await savePrivateFile(key, zip);
      const at = Date.now();
      if (await repo.markReady(e.id, e.attempts, zip.byteLength, at, at + getConfig().dataExportTtlMs)) log(`ediscovery: case export ${e.id} ready (${zip.byteLength} bytes)`);
      // This attempt lost the row (taken for stale meanwhile). While the row names the file, the
      // newer attempt or filesToDrop deals with it; a row that no longer does never will.
      else if (!(await repo.namesFile(e.id, key))) await deletePrivateFile(key);
      built++;
    } catch (err) {
      logError(`ediscovery: case export ${e.id} failed (attempt ${e.attempts})`, err);
      await repo.markFailed(e.id, e.attempts, err instanceof Error ? err.message : String(err));
    }
  }
}
