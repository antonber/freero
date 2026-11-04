// The export of an eDiscovery case (#157): every board the hold keeps, in full, with every version,
// and the audit events about them and the custodians. Built from what the owning modules export
// (this module reads no other module's tables). Layout:
//   README.txt, case.json, audit.json, manifest.json (sha256 of every other file),
//   boards/<id>/board.json (the board's record and state), content.json (the shared doc and EVERY
//   layer — hidden frames, everyone's drafts), versions/<snapshot id>.json, doc.md (a doc's text)
import { createHash } from 'node:crypto';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { listAuditEvents, type StoredAuditEvent } from '../audit/index';
import { getUsers } from '../auth/index';
import { boardRecords, boardsUnderLegalHold, type LegalHoldScope } from '../boards/index';
import { exportBoardForReview } from '../realtime/index';
import { getWorkspaceInfo } from '../workspaces/index';
import type { CaseRecord } from './repo';

const AUDIT_PAGE = 1000;
const AUDIT_MAX = 100_000;

const README = (name: string, at: string) => `Freero export of the legal case “${name}”, made ${at}.

case.json        the case: who opened it and when, its custodians, the boards it names, the
                 workspaces it covers, and whether it was released
boards/<id>/     every board the hold keeps (live, archived, in the trash, or deleted while held):
                 board.json   its record (title, owner, workspace, dates, state)
                 content.json the board as stored: every item, comment and setting, and every
                              layer — hidden frames' contents and everyone's private drafts
                 versions/    every version kept, one JSON file each (the board at that time)
                 doc.md       a doc's text as Markdown
audit.json       the events of the audit log about these boards and the custodians
manifest.json    the sha256 of every other file, to show the export was not altered
`;

export async function buildCaseArchive(c: CaseRecord, scope: LegalHoldScope, requestedBy: string | null): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, v: unknown) => (files[path] = typeof v === 'string' ? strToU8(v) : strToU8(JSON.stringify(v, null, 2)));
  const at = new Date().toISOString();
  add('README.txt', README(c.name, at));

  // What the hold keeps now; a released case exports the boards it named that still exist.
  const held = c.releasedAt === null ? await boardsUnderLegalHold(c.id) : [];
  const named = new Set(c.boardIds);
  const extra = c.releasedAt === null ? [] : await boardRecords(c.boardIds);
  const boards = [
    ...held.map((b) => ({ id: b.id, kind: b.kind, title: b.title, ownerId: b.ownerId, workspaceId: b.workspaceId, createdAt: new Date(b.createdAt).toISOString(), updatedAt: new Date(b.updatedAt).toISOString(), state: b.state })),
    ...extra.map((b) => ({ id: b.id, kind: b.kind, title: b.title, ownerId: b.ownerId, workspaceId: b.workspaceId, createdAt: b.createdAt, updatedAt: b.updatedAt, state: b.deletedAt ? 'trashed' : 'live' })),
  ];
  const people = await getUsers([...new Set([...c.custodianIds, ...boards.map((b) => b.ownerId), c.createdBy ?? '', requestedBy ?? ''].filter(Boolean))]);
  const nameOf = (id: string | null) => (id ? (people.get(id)?.name ?? 'Deleted user') : null);
  const workspaces = [];
  for (const id of c.workspaceIds) workspaces.push({ id, name: (await getWorkspaceInfo(id))?.name ?? 'Deleted workspace' });

  add('case.json', {
    case: { id: c.id, name: c.name, description: c.description, createdAt: new Date(c.createdAt).toISOString(), createdBy: nameOf(c.createdBy), releasedAt: c.releasedAt ? new Date(c.releasedAt).toISOString() : null },
    exportedAt: at,
    exportedBy: nameOf(requestedBy),
    workspaces,
    custodians: c.custodianIds.map((id) => ({ userId: id, name: nameOf(id), email: people.get(id)?.email ?? null })),
    namedBoards: c.boardIds,
    holdScope: scope,
    boards: boards.map((b) => ({ ...b, ownerName: nameOf(b.ownerId), named: named.has(b.id) })),
  });

  for (const b of boards) {
    const dir = `boards/${b.id}`;
    const review = await exportBoardForReview(b.id);
    add(`${dir}/board.json`, { ...b, ownerName: nameOf(b.ownerId) });
    add(`${dir}/content.json`, { content: review.content, layers: Object.fromEntries(review.layers.map((l) => [l.layer, l.json])) });
    if (review.markdown) add(`${dir}/doc.md`, review.markdown);
    for (const v of review.versions)
      add(`${dir}/versions/${v.info.id}.json`, { version: { ...v.info, createdAt: new Date(v.info.createdAt).toISOString(), createdBy: nameOf(v.info.createdBy) }, content: v.json });
  }

  // The audit events of the case's place about these boards and people (an organisation's chain holds its workspaces' events).
  const subjects = new Set([...boards.map((b) => b.id), ...c.custodianIds]);
  const events: StoredAuditEvent[] = [];
  for (const target of subjects) {
    for (const by of ['targetId', 'actorId'] as const) {
      if (by === 'actorId' && !c.custodianIds.includes(target)) continue;
      let beforeId: string | undefined;
      for (;;) {
        const page = await listAuditEvents({ workspaceId: c.placeId, [by]: target, beforeId }, AUDIT_PAGE);
        events.push(...page);
        if (page.length < AUDIT_PAGE || events.length >= AUDIT_MAX) break;
        beforeId = page[page.length - 1].id;
      }
    }
  }
  const seen = new Set<string>();
  const unique = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => Number(a.id) - Number(b.id));
  add('audit.json', unique);

  const manifest = Object.entries(files).map(([path, data]) => ({ path, bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') }));
  add('manifest.json', { algorithm: 'sha256', files: manifest });
  const zippable: Zippable = files;
  return zipSync(zippable, { level: 6 });
}
