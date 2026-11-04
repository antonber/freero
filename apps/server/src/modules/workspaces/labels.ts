// Classification labels (#158; docs/design/compliance.md §2). A team workspace or an organisation
// defines labels; an organisation's are available to every workspace attached to it. Each label's
// `caps` are floors on the board's effective policies, applied in the one place every access
// decision reads them (service.boardAccessLoader), so the app, the public API, MCP, embeds, guests
// and links all see them. Content admins (and owners) edit labels; any member lists them.
import { LABEL_CAP_KEYS, looserPolicy, POLICY_STRICTNESS, type BoardLabel, type BoardLabelInput, type BoardLabelSummary, type LabelCapKey, type LabelCaps, type WorkspacePolicies } from '@freero/shared';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { recordAudit } from '../audit/index';
import * as repo from './repo';
import { requireWorkspace } from './service';

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_LABELS = 30;

/**
 * What a label the board points at but its workspace can no longer see (an organisation's label after
 * the workspace was detached) caps: everything, until someone relabels it. Fail closed.
 */
export const UNKNOWN_LABEL_CAPS: LabelCaps = {
  linkSharing: 'none',
  publicLinks: 'signedIn',
  externalSharing: 'none',
  downloads: 'admins',
  boardEmbeds: 'off',
  liveEmbeds: 'off',
  linkPassword: 'required',
  linkMaxDays: 1,
  viewerExports: 'off',
};

/** `policies` raised by a label's caps, key by key (the stricter wins), like an organisation's floors. */
export function withLabelCaps(policies: WorkspacePolicies, caps: LabelCaps): WorkspacePolicies {
  const out: Record<string, unknown> = { ...policies };
  for (const k of LABEL_CAP_KEYS) {
    const cap = caps[k];
    if (cap === undefined) continue;
    if (looserPolicy(k, policies[k] as never, cap as never)) out[k] = cap;
  }
  return out as unknown as WorkspacePolicies;
}

/** Validates caps from a request: known keys, known values; 400 otherwise. */
export function cleanCaps(v: unknown): LabelCaps {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw badRequest('caps must be an object');
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (k === 'viewerExports') {
      if (value !== 'off') throw badRequest('viewerExports can only be off');
      out[k] = value;
    } else if (k === 'linkMaxDays') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 365) throw badRequest('linkMaxDays must be 1–365');
      out[k] = value;
    } else if ((LABEL_CAP_KEYS as readonly string[]).includes(k)) {
      const allowed = POLICY_STRICTNESS[k as Exclude<LabelCapKey, 'linkMaxDays'>] as readonly unknown[];
      if (!allowed.includes(value)) throw badRequest(`${k} must be one of ${allowed.join(', ')}`);
      out[k] = value;
    } else throw badRequest(`A label can’t cap ${k}`);
  }
  return out as LabelCaps;
}

const summary = (l: repo.LabelRow): BoardLabelSummary => ({ id: l.id, name: l.name, color: l.color, caps: l.caps });

/** Labels a board in `workspaceId` may carry: the workspace's own, then its organisation's. */
export async function availableLabels(workspaceId: string): Promise<repo.LabelRow[]> {
  const ws = await repo.getWorkspace(workspaceId);
  if (!ws || ws.kind !== 'team') return [];
  const rows = await repo.labelsOf([ws.id, ...(ws.organisation ? [ws.organisation.id] : [])]);
  return [...rows.filter((l) => l.workspaceId === ws.id), ...rows.filter((l) => l.workspaceId !== ws.id)];
}

/** Whether boards there must carry a label (the workspace's own or its organisation's floor) and the label new ones get. */
export async function labelRequirement(workspaceId: string): Promise<{ required: boolean; defaultLabelId: string | null }> {
  const ws = await repo.getWorkspace(workspaceId);
  if (!ws || ws.kind !== 'team') return { required: false, defaultLabelId: null };
  const s = await repo.labelSettingsOf([ws.id, ...(ws.organisation ? [ws.organisation.id] : [])]);
  const own = s.get(ws.id);
  const org = ws.organisation ? s.get(ws.organisation.id) : undefined;
  return { required: !!own?.required || !!org?.required, defaultLabelId: own?.defaultLabelId ?? org?.defaultLabelId ?? null };
}

/** For boardAccessLoader: every label of these workspaces and their organisations, by id. */
export async function labelsForPlaces(placeIds: string[]): Promise<Map<string, BoardLabelSummary>> {
  return new Map((await repo.labelsOf(placeIds)).map((l) => [l.id, summary(l)]));
}

/** A label the board points at that isn't among `known` (stale): looked up so it still caps, or the unknown caps. */
export async function labelsByIdFailClosed(ids: string[]): Promise<Map<string, BoardLabelSummary>> {
  const found = new Map((await repo.labelsById(ids)).map((l) => [l.id, summary(l)]));
  for (const id of ids) if (!found.has(id)) found.set(id, { id, name: 'Unknown label', color: '#868e96', caps: UNKNOWN_LABEL_CAPS });
  return found;
}

// ---- managing labels ----

async function requireLabelAdmin(placeId: string, userId: string) {
  const { workspace } = await requireWorkspace(placeId, userId, 'admin', { organisation: true, scope: 'content' });
  if (workspace.kind === 'personal') throw badRequest('Your personal workspace has no labels. Create a team workspace to classify boards.');
  return workspace;
}

const asLabel = (l: repo.LabelRow, placeId: string, boards?: number): BoardLabel => ({
  id: l.id,
  placeId: l.workspaceId,
  inherited: l.workspaceId !== placeId,
  name: l.name,
  color: l.color,
  description: l.description,
  caps: l.caps,
  ...(boards !== undefined ? { boards } : {}),
});

/** Any member: the labels boards here may carry, whether one is required, and the default. */
export async function listLabels(placeId: string, userId: string): Promise<{ labels: BoardLabel[]; required: boolean; defaultLabelId: string | null }> {
  const { workspace } = await requireWorkspace(placeId, userId, 'member', { organisation: true });
  if (workspace.kind === 'personal') return { labels: [], required: false, defaultLabelId: null };
  if (workspace.kind === 'organisation') {
    const [rows, s] = await Promise.all([repo.labelsOf([workspace.id]), repo.labelSettingsOf([workspace.id])]);
    return { labels: rows.map((l) => asLabel(l, workspace.id)), required: !!s.get(workspace.id)?.required, defaultLabelId: s.get(workspace.id)?.defaultLabelId ?? null };
  }
  const [labels, req] = await Promise.all([availableLabels(workspace.id), labelRequirement(workspace.id)]);
  return { labels: labels.map((l) => asLabel(l, workspace.id)), ...req };
}

function cleanInput(input: Partial<BoardLabelInput> | undefined, partial: boolean) {
  const name = input?.name === undefined ? undefined : typeof input.name === 'string' ? input.name.trim() : null;
  if ((!partial || name !== undefined) && !name) throw badRequest('A label needs a name');
  if (name && name.length > 40) throw badRequest('A label’s name is at most 40 characters');
  const color = input?.color === undefined ? undefined : String(input.color);
  if (color !== undefined && !COLOR_RE.test(color)) throw badRequest('color must be #rrggbb');
  const description = input?.description === undefined ? undefined : String(input.description).trim();
  if (description && description.length > 300) throw badRequest('A label’s description is at most 300 characters');
  const caps = input?.caps === undefined ? undefined : cleanCaps(input.caps);
  return { name: name ?? undefined, color, description, caps };
}

export async function createLabel(placeId: string, userId: string, input: BoardLabelInput): Promise<BoardLabel> {
  const place = await requireLabelAdmin(placeId, userId);
  const v = cleanInput(input, false);
  if ((await repo.labelsOf([place.id])).length >= MAX_LABELS) throw badRequest(`At most ${MAX_LABELS} labels`);
  const label = { id: newId(12), workspaceId: place.id, name: v.name!, color: v.color ?? '#5b3ff0', description: v.description ?? '', caps: v.caps ?? {} };
  await repo.transaction(async () => {
    if (!(await repo.insertLabel(label, Date.now()))) throw new HttpError(409, 'There is already a label with that name');
    await recordAudit({ action: 'label.created', workspaceId: place.id, actorId: userId, target: { type: 'label', id: label.id, label: label.name }, metadata: capsMetadata(label.caps) });
  });
  return asLabel({ ...label, position: 0 }, place.id, 0);
}

/** Changes a label; its new caps apply at once to every board carrying it (their live sockets are re-resolved by the caller). */
export async function updateLabel(placeId: string, labelId: string, userId: string, input: Partial<BoardLabelInput>): Promise<BoardLabel> {
  const place = await requireLabelAdmin(placeId, userId);
  const v = cleanInput(input, true);
  const updated = await repo.transaction(async () => {
    const r = await repo.updateLabel(place.id, labelId, v);
    if (r === false) throw new HttpError(409, 'There is already a label with that name');
    if (!r) throw notFound('No such label here');
    await recordAudit({ action: 'label.updated', workspaceId: place.id, actorId: userId, target: { type: 'label', id: r.id, label: r.name }, metadata: capsMetadata(r.caps) });
    return r;
  });
  return asLabel(updated, place.id);
}

export async function deleteLabel(placeId: string, labelId: string, userId: string): Promise<void> {
  const place = await requireLabelAdmin(placeId, userId);
  const [label] = (await repo.labelsOf([place.id])).filter((l) => l.id === labelId);
  if (!label) throw notFound('No such label here');
  if ((await repo.labelSettingsOf([place.id])).get(place.id)?.defaultLabelId === labelId)
    throw new HttpError(409, 'New boards get this label. Choose another default first.', 'label_in_use');
  await repo.transaction(async () => {
    const r = await repo.deleteLabel(place.id, labelId);
    if (r === 'in_use') throw new HttpError(409, 'Boards carry this label. Give them another label first.', 'label_in_use');
    if (r === 'missing') throw notFound('No such label here');
    await recordAudit({ action: 'label.deleted', workspaceId: place.id, actorId: userId, target: { type: 'label', id: label.id, label: label.name } });
  });
}

/** Whether boards here must carry a label, and the label new ones get (it must be one boards here may carry). */
export async function setLabelPolicy(placeId: string, userId: string, input: { required?: unknown; defaultLabelId?: unknown }): Promise<{ required: boolean; defaultLabelId: string | null }> {
  const place = await requireLabelAdmin(placeId, userId);
  const required = input?.required === undefined ? undefined : input.required === true;
  const defaultLabelId = input?.defaultLabelId === undefined ? undefined : input.defaultLabelId === null ? null : String(input.defaultLabelId);
  const usable = place.kind === 'organisation' ? await repo.labelsOf([place.id]) : await availableLabels(place.id);
  if (defaultLabelId && !usable.some((l) => l.id === defaultLabelId)) throw badRequest('The default must be one of the labels here');
  const current = (await repo.labelSettingsOf([place.id])).get(place.id);
  const nextDefault = defaultLabelId !== undefined ? defaultLabelId : (current?.defaultLabelId ?? null);
  if ((required ?? current?.required) && !nextDefault) throw badRequest('Choose the label new boards get before requiring one');
  await repo.transaction(async () => {
    await repo.setLabelSettings(place.id, { required, defaultLabelId });
    await recordAudit({
      action: 'workspace.settings_changed',
      workspaceId: place.id,
      actorId: userId,
      target: { type: 'workspace', id: place.id, label: place.name },
      metadata: { ...(required !== undefined ? { requireLabel: required } : {}), ...(defaultLabelId !== undefined ? { defaultLabel: defaultLabelId } : {}) },
    });
  });
  const s = (await repo.labelSettingsOf([place.id])).get(place.id);
  return { required: !!s?.required, defaultLabelId: s?.defaultLabelId ?? null };
}

const capsMetadata = (caps: LabelCaps) => Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, v === null ? null : String(v)]));
