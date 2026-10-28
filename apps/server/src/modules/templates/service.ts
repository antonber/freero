// Saved templates: validation, the per-user quota, and the thumbnail file.
// The content is opaque board data (the web engine's export of elements); the server only checks
// its shape and size. Inserting it later remaps every id on the client (the copy/paste path), so
// nothing here depends on the source board, which may be deleted meanwhile.
import type { SaveTemplateRequest, SavedTemplate, SavedTemplateSummary, TemplateContent } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { getUsers } from '../auth/index';
import { requireBoardDownload } from '../boards/index';
import { deleteUpload, saveUpload } from '../uploads/index';
import { isManager, teamWorkspaceIdsFor, workspaceRolesOf } from '../workspaces/index';
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

type ForReader = Pick<SavedTemplateSummary, 'ownerName' | 'canUnshare'>;

/** Adds who shared each template and whether `userId` may unshare it. */
async function forReader<T extends StoredSummary>(list: T[], userId: string): Promise<Array<T & ForReader>> {
  const [owners, roles] = await Promise.all([getUsers(list.map((t) => t.ownerId)), workspaceRolesOf(userId)]);
  return list.map((t) => ({
    ...t,
    ownerName: owners.get(t.ownerId)?.name ?? 'Someone',
    canUnshare: t.workspaceId !== null && (t.ownerId === userId || isManager(roles.get(t.workspaceId) ?? null)),
  }));
}

export async function listTemplates(userId: string): Promise<SavedTemplateSummary[]> {
  return forReader(await repo.listVisibleTo(userId, await teamWorkspaceIdsFor(userId)), userId);
}

export async function getTemplate(id: string, userId: string): Promise<SavedTemplate> {
  const t = await repo.getVisible(id, userId, await teamWorkspaceIdsFor(userId));
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
  if (body?.boardId !== undefined) {
    if (typeof body.boardId !== 'string') throw badRequest('boardId must be a board id');
    await requireBoardDownload(body.boardId, userId);
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
  };
  try {
    await repo.transaction(async () => {
      const max = getConfig().maxTemplatesPerUser;
      await repo.lockOwnerQuota(userId);
      if ((await repo.countOwnedBy(userId)) >= max)
        throw forbidden(`You have reached the limit of ${max} templates. Delete templates you no longer need to save new ones.`);
      await repo.insertTemplate(template);
    });
  } catch (e) {
    await deleteUpload(thumbnail);
    throw e;
  }
  const { content: _content, ...summary } = template;
  return (await forReader([summary], userId))[0];
}

/** null (personal), or a team workspace the user is a full member of. */
async function shareTarget(userId: string, v: unknown): Promise<string | null> {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !(await teamWorkspaceIdsFor(userId)).includes(v))
    throw forbidden('You can share templates only with a team workspace you are a member of');
  return v;
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

/** Deletes one of the user's own templates (someone else's answers 404, like a missing one). */
export async function deleteTemplate(id: string, userId: string): Promise<void> {
  const thumbnail = await repo.deleteOwned(id, userId);
  if (thumbnail === undefined) throw notFound('Template not found');
  await deleteUpload(thumbnail);
}
