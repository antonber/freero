// The sensitive-data scan (#158; docs/design/compliance.md §2). Off until a team workspace's content
// admins turn it on; then every saved change of a board's shared content (and a board moving in)
// re-scans that board through the outbox, like search: the text is what every reader of the board
// sees (search's rows: items, comments, the title — never private drafts or hidden frames), and
// what is kept is per item and kind, how many — never the text that matched. Nothing leaves the
// instance; no matched text is logged, audited or put in a notification.
//
// What a finding does, by the workspace's action:
//   notify   its owners and content admins get a notification (once per board and set of kinds)
//            and the console lists it;
//   suggest  also, the board's managers see the label the workspace suggests for it;
//   require  also, Freero gives the board that label (audited, reason sensitive_data), and while it
//            holds findings nobody can relabel it to something less strict.
import {
  DEFAULT_SENSITIVE_DATA_KINDS,
  looserPolicy,
  SENSITIVE_DATA_KINDS,
  type BoardLabelSummary,
  type BoardSensitiveData,
  type LabelCaps,
  type OrganisationPolicyKey,
  type SensitiveDataAction,
  type SensitiveDataFinding,
  type SensitiveDataKind,
  type SensitiveDataSettings,
  type SensitiveDataStatus,
  type WorkspacePolicies,
} from '@freero/shared';
import { badRequest, HttpError } from '../../platform/http';
import { log, logError } from '../../platform/log';
import { nextDeriveVersion, type OutboxConsumer, type OutboxEvent } from '../../platform/outbox';
import { requireAdmin } from '../admin/index';
import { recordAudit } from '../audit/index';
import {
  applyLabelByPolicy,
  BOARD_EVENTS_TOPIC,
  boardIdsInWorkspace,
  boardLabelId,
  boardRecords,
  requireBoardAccess,
  type BoardEventRecord,
  type LabelChange,
} from '../boards/index';
import { notify } from '../notifications/index';
import { BOARD_CONTENT_TOPIC } from '../realtime/index';
import { searchRowsOf } from '../search/index';
import { labelsAvailableIn, workspaceAdminFacts } from '../workspaces/index';
import { detectSensitiveData } from './detect';
import * as repo from './repo';

export const DLP_CONSUMER = 'dlp';
const LOCK_KEY = 7_202_612_042; // arbitrary, constant across releases
const MAX_FINDINGS_LISTED = 500;

const OFF: SensitiveDataSettings = { enabled: false, kinds: [...DEFAULT_SENSITIVE_DATA_KINDS], action: 'notify', labelId: null };

export async function settingsOf(workspaceId: string): Promise<SensitiveDataSettings> {
  return (await repo.getSettings(workspaceId)) ?? OFF;
}

// ---- scanning ----

/** Re-derives one board's findings at `version` (an older derivation never replaces a newer one). Idempotent. */
export async function scanBoard(boardId: string, version: number): Promise<void> {
  const [record] = await boardRecords([boardId]);
  if (!record || record.deletedAt) return repo.forgetBoard(boardId);
  const settings = await settingsOf(record.workspaceId);
  if (!settings.enabled) return repo.forgetBoard(boardId);
  const findings: repo.FindingRow[] = [];
  for (const row of await searchRowsOf(boardId)) {
    const found = detectSensitiveData(row.body, settings.kinds);
    for (const kind of Object.keys(found) as SensitiveDataKind[]) findings.push({ itemKey: row.key, elementId: row.elementId, kind, count: found[kind]! });
  }
  const added = await repo.replaceFindings(boardId, record.workspaceId, version, findings, Date.now());
  if (added === null || !findings.length) return;
  if (settings.action === 'require' && settings.labelId) await requireLabel(boardId, record.workspaceId, settings.labelId);
  if (added.length) await tellAdmins(record.workspaceId, boardId, record.title, [...new Set(findings.map((f) => f.kind))].sort());
}

/** The workspace's owners and content admins (not deactivated). */
async function contentAdminsOf(workspaceId: string): Promise<string[]> {
  const { members } = await workspaceAdminFacts(workspaceId);
  return members.filter((m) => !m.deactivated && (m.role === 'owner' || (m.role === 'admin' && (m.adminScopes === null || m.adminScopes.includes('content'))))).map((m) => m.userId);
}

async function tellAdmins(workspaceId: string, boardId: string, boardTitle: string, kinds: SensitiveDataKind[]): Promise<void> {
  for (const userId of await contentAdminsOf(workspaceId))
    await notify({
      userId,
      type: 'sensitive_data.found',
      actorId: null,
      // Not about the board as such (an admin may not be on it): the console lists it.
      boardId: null,
      data: { boardTitle, workspaceId, sensitiveKinds: kinds },
      dedupeKey: `sensitive_data:${boardId}:${kinds.join(',')}`,
    });
}

async function requireLabel(boardId: string, workspaceId: string, labelId: string): Promise<void> {
  const labels = await labelsAvailableIn(workspaceId);
  const required = labels.find((l) => l.id === labelId);
  if (!required) return; // the label is gone: nothing to require
  const current = await boardLabelId(boardId);
  const has = current ? labels.find((l) => l.id === current) : undefined;
  if (has && atLeastAsStrict(has.caps, required.caps)) return;
  await applyLabelByPolicy(boardId, labelId, 'sensitive_data');
}

/** Whether a label with `caps` caps everything `floor` does, at least as much. */
export function atLeastAsStrict(caps: LabelCaps, floor: LabelCaps): boolean {
  for (const [k, v] of Object.entries(floor)) {
    if (v === undefined) continue;
    const mine = (caps as Record<string, unknown>)[k];
    if (mine === undefined) return false;
    if (k === 'viewerExports') continue; // its only value is 'off'
    if (looserPolicy(k as OrganisationPolicyKey, mine as WorkspacePolicies[OrganisationPolicyKey], v as WorkspacePolicies[OrganisationPolicyKey])) return false;
  }
  return true;
}

function boardOfEvent(e: OutboxEvent): string | null {
  if (e.topic === BOARD_CONTENT_TOPIC) return e.key.startsWith('board:') ? e.key.slice('board:'.length) : null;
  const p = e.payload as Partial<BoardEventRecord> | null;
  // A board moving in (another workspace's scan, or none), restored or trashed.
  return typeof p?.boardId === 'string' && p.type !== 'board.renamed' && p.type !== 'board.created' ? p.boardId : null;
}

/** The outbox consumer: each batch re-scans the boards whose content was saved or that moved. */
export const dlpConsumer: OutboxConsumer = {
  name: DLP_CONSUMER,
  topics: [BOARD_CONTENT_TOPIC, BOARD_EVENTS_TOPIC],
  lockKey: LOCK_KEY,
  batchSize: 200,
  wakeDelayMs: 1500,
  async handle(events, { version }) {
    const boards = new Set<string>();
    for (const e of events) {
      const id = boardOfEvent(e);
      if (id) boards.add(id);
    }
    for (const id of boards) await scanBoard(id, version);
  },
};

/** Scans every board of the workspace now (the scan turned on, or what it looks for changed). */
async function scanWorkspace(workspaceId: string): Promise<number> {
  const version = await nextDeriveVersion();
  const ids = await boardIdsInWorkspace(workspaceId);
  for (const id of ids) await scanBoard(id, version);
  return ids.length;
}

// ---- the label guard (boards' onLabelChange) ----

/** While a board holds findings and its workspace requires a label for them, people can't relabel it to something less strict. */
export async function guardLabelChange(c: LabelChange): Promise<void> {
  const s = await settingsOf(c.workspaceId);
  if (!s.enabled || s.action !== 'require' || !s.labelId) return;
  if (!(await repo.kindsOn(c.boardId)).length) return;
  const labels = await labelsAvailableIn(c.workspaceId);
  const required = labels.find((l) => l.id === s.labelId);
  if (!required) return;
  const to = c.toLabelId ? labels.find((l) => l.id === c.toLabelId) : undefined;
  if (to && atLeastAsStrict(to.caps, required.caps)) return;
  throw new HttpError(409, `Sensitive data was found on this board: it must stay labelled ${required.name} (or something at least as strict).`, 'label_required_by_scan', { label: required.name });
}

// ---- the admin console (content admins) ----

function cleanSettings(body: Record<string, unknown>, now: SensitiveDataSettings): SensitiveDataSettings {
  const next = { ...now };
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw badRequest('enabled must be true or false', 'invalid_request');
    next.enabled = body.enabled;
  }
  if (body.kinds !== undefined) {
    if (!Array.isArray(body.kinds) || !body.kinds.every((k) => (SENSITIVE_DATA_KINDS as readonly unknown[]).includes(k)))
      throw badRequest(`kinds must be a list of ${SENSITIVE_DATA_KINDS.join(', ')}`, 'invalid_request');
    next.kinds = SENSITIVE_DATA_KINDS.filter((k) => (body.kinds as unknown[]).includes(k));
  }
  if (body.action !== undefined) {
    if (!['notify', 'suggest', 'require'].includes(body.action as string)) throw badRequest('action must be notify, suggest or require', 'invalid_request');
    next.action = body.action as SensitiveDataAction;
  }
  if (body.labelId !== undefined) {
    if (body.labelId !== null && (typeof body.labelId !== 'string' || !body.labelId)) throw badRequest('labelId must be a label id or null', 'invalid_request');
    next.labelId = body.labelId as string | null;
  }
  if (next.enabled && !next.kinds.length) throw badRequest('Choose at least one kind of data to look for', 'sensitive_kinds_needed');
  if (next.action !== 'notify' && !next.labelId) throw new HttpError(400, 'Choose the label to suggest or require', 'label_needed');
  return next;
}

async function findingsOf(workspaceId: string): Promise<SensitiveDataFinding[]> {
  const rows = await repo.findingsIn(workspaceId, MAX_FINDINGS_LISTED);
  const titles = new Map((await boardRecords(rows.map((r) => r.boardId))).map((b) => [b.id, b.title]));
  return rows.map((r) => ({
    boardId: r.boardId,
    boardTitle: titles.get(r.boardId) ?? '',
    elementId: r.elementId,
    where: r.itemKey === '' ? 'board' : r.itemKey.startsWith('c:') ? 'comment' : 'item',
    kind: r.kind,
    count: r.count,
    foundAt: r.foundAt,
  }));
}

export async function sensitiveDataStatus(workspaceId: string, userId: string): Promise<SensitiveDataStatus> {
  await requireAdmin(workspaceId, userId, { scope: 'content' });
  return { settings: await settingsOf(workspaceId), findings: await findingsOf(workspaceId) };
}

export async function updateSensitiveDataSettings(workspaceId: string, userId: string, body: Record<string, unknown>): Promise<SensitiveDataStatus> {
  await requireAdmin(workspaceId, userId, { scope: 'content' });
  const before = await settingsOf(workspaceId);
  const next = cleanSettings(body, before);
  if (next.labelId && !(await labelsAvailableIn(workspaceId)).some((l) => l.id === next.labelId)) throw badRequest('That label isn’t available in this workspace', 'label_unavailable');
  await repo.transaction(async () => {
    await repo.putSettings(workspaceId, next, userId, Date.now());
    await recordAudit({
      action: 'sensitive_data.settings_changed',
      workspaceId,
      actorId: userId,
      target: { type: 'workspace', id: workspaceId, label: null },
      metadata: { enabled: next.enabled, kinds: next.kinds.join(','), action: next.action, labelId: next.labelId },
    });
  });
  if (!next.enabled) await repo.forgetWorkspace(workspaceId);
  else if (!before.enabled || before.kinds.join() !== next.kinds.join() || before.action !== next.action || before.labelId !== next.labelId)
    // Every board is scanned again in the background (findings appear as they are found).
    void scanWorkspace(workspaceId)
      .then((n) => log(`dlp: scanned ${n} board(s) of workspace ${workspaceId}`))
      .catch((e) => logError(`dlp: scanning the boards of workspace ${workspaceId} failed; their next change scans them`, e));
  return { settings: next, findings: next.enabled ? await findingsOf(workspaceId) : [] };
}

// ---- on the board (its managers) ----

/** What the board's managers (owner, co-owners, content admins) see about the scan's findings on it. */
export async function boardSensitiveData(boardId: string, userId: string): Promise<BoardSensitiveData> {
  const none: BoardSensitiveData = { kinds: [], action: null, label: null };
  const access = await requireBoardAccess(boardId, userId);
  let manager = access.manages;
  if (!manager)
    manager = await requireAdmin(access.workspaceId, userId, { scope: 'content' }).then(
      () => true,
      () => false,
    );
  if (!manager) return none;
  const s = await settingsOf(access.workspaceId);
  if (!s.enabled) return none;
  const kinds = await repo.kindsOn(boardId);
  if (!kinds.length) return { kinds, action: s.action, label: null };
  let label: BoardLabelSummary | null = null;
  if (s.action !== 'notify' && s.labelId) {
    const labels = await labelsAvailableIn(access.workspaceId);
    const wanted = labels.find((l) => l.id === s.labelId);
    const current = await boardLabelId(boardId);
    const has = current ? labels.find((l) => l.id === current) : undefined;
    if (wanted && !(has && atLeastAsStrict(has.caps, wanted.caps))) label = { id: wanted.id, name: wanted.name, color: wanted.color, caps: wanted.caps };
  }
  return { kinds, action: s.action, label };
}
