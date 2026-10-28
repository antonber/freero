// Thin wrappers over the REST client for building the engine's `Host`
// (see Host in engine/api.ts). Used from app/board/.
import type { SavedTemplateSummary } from '@freero/shared';
import type { ElementsSnapshot, Host, HostUser, LinkPreview, SavedTemplateInfo, VersionHistory } from '@engine';
import { api } from './api/client';

const toTemplateInfo = (t: SavedTemplateSummary): SavedTemplateInfo => ({
  id: t.id,
  name: t.name,
  description: t.description,
  thumbnail: t.thumbnail,
  ownerId: t.ownerId,
  shared: t.workspaceId !== null,
  ownerName: t.ownerName,
  canUnshare: t.canUnshare,
  elementCount: t.elementCount,
  createdAt: t.createdAt,
});

export async function listTemplates(): Promise<SavedTemplateInfo[]> {
  return (await api.listTemplates()).templates.map(toTemplateInfo);
}

export async function loadTemplate(id: string): Promise<ElementsSnapshot> {
  return (await api.getTemplate(id)).template.content;
}

/**
 * Saves a template from board `boardId` (its workspace's download policy applies), shared with
 * `teamId` when asked.
 */
export function saveTemplateFrom(boardId: string, teamId: string | null): Host['saveTemplate'] {
  return async ({ name, description, thumbnail, content, shareWithTeam }) =>
    toTemplateInfo(
      (
        await api.saveTemplate({
          name,
          description,
          content,
          boardId,
          ...(thumbnail ? { thumbnail } : {}),
          ...(shareWithTeam && teamId ? { workspaceId: teamId } : {}),
        })
      ).template,
    );
}

/** Shares one of the user's templates with `teamId` (null: no team to share with here), or unshares one. */
export function shareTemplateWith(teamId: string | null): Host['shareTemplate'] {
  return async (id, shared) => {
    if (shared && !teamId) throw new Error('This board isn’t in a team workspace.');
    return toTemplateInfo((await api.shareTemplate(id, shared ? teamId : null)).template);
  };
}

export async function deleteTemplate(id: string): Promise<void> {
  await api.deleteTemplate(id);
}

/** Host.versions for a real board. */
export function versionHistory(boardId: string): VersionHistory {
  return {
    list: async () => (await api.listVersions(boardId)).versions,
    load: (id) => api.versionState(boardId, id),
    nameCurrent: async (name) => (await api.nameVersion(boardId, name)).version,
    rename: async (id, name) => (await api.renameVersion(boardId, id, name)).version,
    restore: async (id) => (await api.restoreVersion(boardId, id)).before,
  };
}

export function uploadImage(file: Blob): Promise<{ url: string }> {
  return api.uploadImage(file);
}

/** Reports to Freero's moderators (anyone who can open the board). */
export function reportOn(boardId: string): Host['report'] {
  return async ({ target, reason, note }) => {
    await api.report({ boardId, target, reason, ...(note ? { note } : {}) });
  };
}

/** Documents (PDF) go through the same upload endpoint, quota and checks as images. */
export function uploadFile(file: Blob): Promise<{ url: string }> {
  return api.uploadImage(file);
}

export async function renameBoard(id: string, title: string): Promise<void> {
  await api.updateBoard(id, { title });
}

export async function saveThumbnail(id: string, dataUrl: string): Promise<void> {
  await api.putThumbnail(id, dataUrl);
}

export function unfurl(url: string): Promise<LinkPreview> {
  return api.unfurl(url);
}

export function importImage(url: string): Promise<{ url: string }> {
  return api.importImage(url);
}

export function fetchImage(url: string): Promise<Blob> {
  return api.fetchImage(url);
}

export async function listMembers(id: string): Promise<HostUser[]> {
  const { members } = await api.listMembers(id);
  return members.map((m) => ({ id: m.userId, name: m.name, color: m.color, avatarUrl: m.avatarUrl }));
}

const LOOKUP_CHUNK = 100; // the server's limit per request

export async function lookupUsers(boardId: string, ids: string[]): Promise<HostUser[]> {
  const unique = [...new Set(ids)];
  const out: HostUser[] = [];
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) out.push(...(await api.boardPeople(boardId, unique.slice(i, i + LOOKUP_CHUNK))).people);
  return out;
}

export async function inviteMember(boardId: string, email: string, role: 'editor' | 'commenter' | 'viewer'): ReturnType<Host['inviteMember']> {
  // Someone who already has access keeps their role (an owner's invite would otherwise set it).
  const { members } = await api.listMembers(boardId);
  const existing = members.find((m) => m.email?.toLowerCase() === email.trim().toLowerCase());
  if (existing) return { user: { id: existing.userId, name: existing.name, color: existing.color, avatarUrl: existing.avatarUrl } };
  const r = await api.invite(boardId, { email, role });
  if (r.member) return { user: { id: r.member.userId, name: r.member.name, color: r.member.color, avatarUrl: r.member.avatarUrl } };
  return { pendingEmail: r.invite.email };
}
