// Saved templates: validation, the per-user quota, and the thumbnail file.
// The content is opaque board data (the web engine's export of elements); the server only checks
// its shape and size. Inserting it later remaps every id on the client (the copy/paste path), so
// nothing here depends on the source board, which may be deleted meanwhile.
import type { SaveTemplateRequest, SavedTemplate, SavedTemplateSummary, TemplateContent } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import type { OutboxConsumer } from '../../platform/outbox';
import { recordAudit } from '../audit/index';
import { getUsers } from '../auth/index';
import { boardWorkspaceId, getBoardTitle, requireBoardDownload } from '../boards/index';
import { deleteUpload, saveUpload } from '../uploads/index';
import { getWorkspaceInfo, isManager, requireWorkspace, teamWorkspaceIdsFor, templatePublishingOf, WORKSPACE_MEMBERSHIP_TOPIC, workspaceRole, workspaceRolesOf } from '../workspaces/index';
import { audienceOf } from './audience';
import * as repo from './repo';
import type { StoredSummary, StoredTemplate } from './repo';

export const MAX_ELEMENTS = 5000;
export const MAX_CONTENT_BYTES = 1536 * 1024;
const MAX_THUMBNAIL_BYTES = 512 * 1024;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('name is required');
  const t = v.trim().slice(0, 80);
  if (!t) throw badRequest('Give the template a name');
  return t;
}

function cleanDescription(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest('description must be a string');
  return v.trim().slice(0, 500);
}

/** Checks the shape the web engine needs to insert it (and that it is not huge). */
export function cleanContent(v: unknown): TemplateContent {
  if (!isObject(v) || !Array.isArray(v.elements)) throw badRequest('content.elements must be an array');
  if (v.elements.length === 0) throw badRequest('A template needs at least one item');
  if (v.elements.length > MAX_ELEMENTS) throw badRequest(`A template can hold at most ${MAX_ELEMENTS} items`);
  const ids = new Set<string>();
  for (const el of v.elements) {
    if (!isObject(el) || typeof el.id !== 'string' || !el.id || el.id.length > 64 || typeof el.type !== 'string')
      throw badRequest('Every element needs a string id and type');
    for (const k of ['x', 'y', 'w', 'h']) if (typeof el[k] !== 'number' || !Number.isFinite(el[k])) throw badRequest(`element ${k} must be a number`);
    if (ids.has(el.id)) throw badRequest('Element ids must be unique');
    ids.add(el.id);
  }
  if (v.content !== undefined && !isObject(v.content)) throw badRequest('content.content must be an object');
  const content: TemplateContent = { elements: v.elements as TemplateContent['elements'], ...(v.content ? { content: v.content } : {}) };
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_CONTENT_BYTES)
    throw badRequest(`This is too much content for one template (max ${Math.round(MAX_CONTENT_BYTES / 1024 / 1024 * 10) / 10}MB)`);
  return content;
}

function thumbnailBytes(v: unknown): { bytes: Buffer; type: string } | null {
  if (v === undefined || v === null) return null;
  const m = typeof v === 'string' ? DATA_URL_RE.exec(v) : null;
  if (!m) throw badRequest('thumbnail must be a base64 PNG, JPEG or WebP data URL');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) throw badRequest('Thumbnail is too large (max 512KB)');
  return { bytes, type: m[1] };
}

type ForReader = Pick<SavedTemplateSummary, 'ownerName' | 'canUnshare' | 'organisationName' | 'canManage'>;

/**
 * Is `userId` an owner or content admin (#151) of the workspace or organisation `placeId` — who
 * locks, retires and withdraws what is shared or published there (#155)?
 */
async function administers(placeId: string, userId: string): Promise<boolean> {
  try {
    await requireWorkspace(placeId, userId, 'admin', { organisation: true, scope: 'content' });
    return true;
  } catch {
    return false;
  }
}

/** Where a template is shared or published, for its admins: the organisation first (#155). */
const placeOf = (t: StoredSummary): string | null => t.organisationId ?? t.workspaceId;

/** Adds who shared each template, its company's name, and what `userId` may do with it. */
async function forReader<T extends StoredSummary>(list: T[], userId: string): Promise<Array<T & ForReader>> {
  const places = [...new Set(list.flatMap((t) => [t.organisationId, t.workspaceId].filter((x): x is string => !!x)))];
  const orgIds = [...new Set(list.flatMap((t) => (t.organisationId ? [t.organisationId] : [])))];
  const [owners, roles, admin, orgNames] = await Promise.all([
    getUsers(list.map((t) => t.ownerId)),
    workspaceRolesOf(userId),
    Promise.all(places.map(async (p) => [p, await administers(p, userId)] as const)).then((e) => new Map(e)),
    Promise.all(orgIds.map(async (o) => [o, (await getWorkspaceInfo(o))?.name ?? null] as const)).then((e) => new Map(e)),
  ]);
  return list.map((t) => {
    const place = placeOf(t);
    return {
      ...t,
      ownerName: owners.get(t.ownerId)?.name ?? 'Someone',
      // A locked template stays where admins put it: its owner can't take it back (#155).
      canUnshare: t.workspaceId !== null && ((t.ownerId === userId && !t.locked) || isManager(roles.get(t.workspaceId) ?? null)),
      organisationName: t.organisationId ? (orgNames.get(t.organisationId) ?? null) : null,
      canManage: place !== null && (admin.get(place) ?? false),
    };
  });
}

export async function listTemplates(userId: string): Promise<SavedTemplateSummary[]> {
  return forReader(await repo.listVisibleTo(userId, await audienceOf(userId)), userId);
}

export async function getTemplate(id: string, userId: string): Promise<SavedTemplate> {
  const t = await repo.getVisible(id, userId, await audienceOf(userId));
  if (!t) throw notFound('Template not found');
  return (await forReader([t], userId))[0];
}

/**
 * Saves a template owned by `userId`. The quota count and the insert share a transaction under
 * the owner's lock, so parallel saves can't overshoot MAX_TEMPLATES_PER_USER.
 */
export async function saveTemplate(userId: string, body: Partial<SaveTemplateRequest> | undefined, now = Date.now()): Promise<SavedTemplateSummary> {
  const name = cleanName(body?.name);
  const description = cleanDescription(body?.description);
  const content = cleanContent(body?.content);
  const thumb = thumbnailBytes(body?.thumbnail);
  // The source board's workspace may not allow taking its content out ("downloads" policy).
  let source: { id: string; workspaceId: string; title: string } | null = null;
  if (body?.boardId !== undefined) {
    if (typeof body.boardId !== 'string') throw badRequest('boardId must be a board id');
    await requireBoardDownload(body.boardId, userId, 'template');
    source = { id: body.boardId, workspaceId: (await boardWorkspaceId(body.boardId))!, title: (await getBoardTitle(body.boardId)) ?? '' };
  }
  const workspaceId = await shareTarget(userId, body?.workspaceId);
  // Store the file first (not a db write), and drop it again if the row doesn't make it.
  const thumbnail = thumb ? await saveUpload(thumb.bytes, thumb.type) : null;
  const template: StoredTemplate = {
    id: newId(12),
    ownerId: userId,
    workspaceId,
    name,
    description,
    thumbnail,
    elementCount: content.elements.length,
    content,
    createdAt: now,
    updatedAt: now,
    organisationId: null,
    locked: false,
    retiredAt: null,
  };
  try {
    await repo.transaction(async () => {
      const max = getConfig().maxTemplatesPerUser;
      await repo.lockOwnerQuota(userId);
      if ((await repo.countOwnedBy(userId)) >= max)
        throw forbidden(`You have reached the limit of ${max} templates. Delete templates you no longer need to save new ones.`);
      await repo.insertTemplate(template);
      // Content leaving a board (into the template library) is a download: audited in the board's workspace.
      if (source)
        await recordAudit({
          action: 'template.saved',
          workspaceId: source.workspaceId,
          actorId: userId,
          target: { type: 'board', id: source.id, label: source.title },
          metadata: { template: template.id, name, sharedWith: workspaceId },
        });
    });
  } catch (e) {
    await deleteUpload(thumbnail);
    throw e;
  }
  const { content: _content, ...summary } = template;
  return (await forReader([summary], userId))[0];
}

const publishingRefusal = (where: string) => new HttpError(403, `In ${where} only owners and content admins share templates`, 'template_publishing');

/**
 * null (personal), or a team workspace the user is a full member of — and (#155) whose
 * `templatePublishing` lets them share with it (admins only: its owners and content admins).
 */
async function shareTarget(userId: string, v: unknown): Promise<string | null> {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !(await teamWorkspaceIdsFor(userId)).includes(v))
    throw forbidden('You can share templates only with a team workspace you are a member of');
  if ((await templatePublishingOf(v)) === 'admins' && !(await administers(v, userId))) throw publishingRefusal((await getWorkspaceInfo(v))?.name ?? 'this workspace');
  return v;
}

/**
 * Publishes the owner's template to an organisation one of their workspaces belongs to (#155), as
 * the organisation's `templatePublishing` allows, or takes it back (null) — not while an admin
 * locked it. The organisation's content admins may also withdraw it. Audited in the organisation's log.
 */
export async function publishTemplate(id: string, userId: string, organisationId: unknown): Promise<SavedTemplateSummary> {
  const t = await repo.getSummary(id);
  if (!t || (t.ownerId !== userId && !(t.organisationId && (await administers(t.organisationId, userId))))) throw notFound('Template not found');
  const now = Date.now();
  if (organisationId === null) {
    if (!t.organisationId) return (await forReader([t], userId))[0];
    const was = t.organisationId;
    const out = (await administers(was, userId)) ? await repo.unpublishFrom(id, was, now) : await repo.setOrganisation(id, userId, null, now);
    if (!out) throw new HttpError(409, 'An admin locked this template: only admins can withdraw it', 'template_locked');
    await recordAudit({ action: 'template.unpublished', workspaceId: was, actorId: userId, target: templateTarget(t), metadata: { owner: t.ownerId } });
    return (await forReader([out], userId))[0];
  }
  if (typeof organisationId !== 'string' || t.ownerId !== userId) throw badRequest('organisationId must be an organisation id, or null');
  if (!(await audienceOf(userId)).organisationIds.includes(organisationId)) throw forbidden('You can publish only to the organisation of a workspace you are a member of');
  if ((await templatePublishingOf(organisationId)) === 'admins' && !(await administers(organisationId, userId)))
    throw publishingRefusal((await getWorkspaceInfo(organisationId))?.name ?? 'this organisation');
  const out = await repo.setOrganisation(id, userId, organisationId, now);
  if (!out) throw new HttpError(409, 'An admin locked this template: only admins can move it', 'template_locked');
  if (t.organisationId !== organisationId)
    await recordAudit({ action: 'template.published', workspaceId: organisationId, actorId: userId, target: templateTarget(t), metadata: { owner: t.ownerId } });
  return (await forReader([out], userId))[0];
}

const templateTarget = (t: { id: string; name: string }) => ({ type: 'template', id: t.id, label: t.name });

/**
 * Locks (everyone uses it, only admins change or remove it) or retires (out of every picker, kept)
 * a template shared with a workspace or published to an organisation: that place's owners and
 * content admins (#155). Audited in its log.
 */
export async function setTemplateAdminState(id: string, userId: string, patch: { locked?: unknown; retired?: unknown }): Promise<SavedTemplateSummary> {
  const t = await repo.getSummary(id);
  const place = t ? placeOf(t) : null;
  if (!t || !place || !(await administers(place, userId))) throw notFound('Template not found');
  if (patch.locked !== undefined && typeof patch.locked !== 'boolean') throw badRequest('locked must be true or false');
  if (patch.retired !== undefined && typeof patch.retired !== 'boolean') throw badRequest('retired must be true or false');
  const now = Date.now();
  const out = await repo.setAdminState(id, { locked: patch.locked as boolean | undefined, ...(patch.retired === undefined ? {} : { retiredAt: patch.retired ? now : null }) }, now);
  if (!out) throw notFound('Template not found');
  if (patch.locked !== undefined && patch.locked !== t.locked)
    await recordAudit({ action: patch.locked ? 'template.locked' : 'template.unlocked', workspaceId: place, actorId: userId, target: templateTarget(t), metadata: { owner: t.ownerId } });
  if (patch.retired !== undefined && patch.retired !== (t.retiredAt !== null))
    await recordAudit({ action: patch.retired ? 'template.retired' : 'template.unretired', workspaceId: place, actorId: userId, target: templateTarget(t), metadata: { owner: t.ownerId } });
  return (await forReader([out], userId))[0];
}

/** What is shared with a workspace or published to an organisation, retired ones included, for its content admins. */
export async function placeTemplates(placeId: string, userId: string): Promise<SavedTemplateSummary[]> {
  if (!(await administers(placeId, userId))) throw forbidden('Only owners and content admins can manage its templates');
  return forReader(await repo.sharedWithPlace(placeId), userId);
}

/**
 * The owner shares a template with one of their team workspaces, or makes it personal again
 * (null). An owner/admin of the workspace it is shared with may also make it personal again
 * (a stale or unsuitable team template); anyone else gets 404, as for a missing template.
 */
export async function shareTemplate(id: string, userId: string, workspaceId: unknown): Promise<SavedTemplateSummary> {
  const now = Date.now();
  const mine = await repo.setWorkspace(id, userId, await shareTarget(userId, workspaceId), now);
  if (mine) return (await forReader([mine], userId))[0];
  if (workspaceId === null) {
    const sharedWith = await repo.sharedWith(id);
    if (sharedWith && isManager((await workspaceRolesOf(userId)).get(sharedWith) ?? null)) {
      const t = await repo.unshareFrom(id, sharedWith, now);
      if (t) return (await forReader([t], userId))[0];
    }
  }
  throw notFound('Template not found');
}

/** Someone left a workspace or became a guest there: what they shared with it is theirs alone again. */
export async function unshareOnLeave(workspaceId: string, userId: string, role: string | null): Promise<void> {
  if (role === null || role === 'guest') await repo.unshareAllOf(userId, workspaceId, Date.now());
}

/**
 * Outbox consumer of workspace membership changes: looks at the person's role NOW (the event only
 * says "look again"), so a late or repeated event never unshares for someone who came back.
 */
export const unshareOnLeaveConsumer: OutboxConsumer = {
  name: 'templates:unshare-on-leave',
  topics: [WORKSPACE_MEMBERSHIP_TOPIC],
  lockKey: 7_202_611_032, // arbitrary, constant across releases
  async handle(events) {
    for (const e of events) {
      const p = e.payload as { workspaceId?: unknown; userId?: unknown } | null;
      if (typeof p?.workspaceId !== 'string' || typeof p.userId !== 'string') continue;
      await unshareOnLeave(p.workspaceId, p.userId, await workspaceRole(p.workspaceId, p.userId));
    }
  },
};

/** Deletes one of the user's own templates (someone else's answers 404, like a missing one; #155: not while locked). */
export async function deleteTemplate(id: string, userId: string): Promise<void> {
  const thumbnail = await repo.deleteOwned(id, userId);
  if (thumbnail === undefined) {
    const t = await repo.getSummary(id);
    if (t && t.ownerId === userId && t.locked) throw new HttpError(409, 'An admin locked this template: only admins can remove it', 'template_locked');
    throw notFound('Template not found');
  }
  await deleteUpload(thumbnail);
}
