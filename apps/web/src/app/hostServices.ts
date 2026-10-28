// Thin wrappers over the REST client for building the engine's `Host`
// (see Host in engine/api.ts). Used from app/board/.
import type { SavedTemplateSummary } from '@freero/shared';
import type { ElementsSnapshot, Host, HostUser, LinkPreview, SavedTemplateInfo } from '@engine';
import { api } from './api/client';

const toTemplateInfo = (t: SavedTemplateSummary): SavedTemplateInfo => ({
  id: t.id,
  name: t.name,
  description: t.description,
  thumbnail: t.thumbnail,
  ownerId: t.ownerId,
  elementCount: t.elementCount,
  createdAt: t.createdAt,
});

export async function listTemplates(): Promise<SavedTemplateInfo[]> {
  return (await api.listTemplates()).templates.map(toTemplateInfo);
}

export async function loadTemplate(id: string): Promise<ElementsSnapshot> {
  return (await api.getTemplate(id)).template.content;
}

export const saveTemplate: Host['saveTemplate'] = async ({ name, description, thumbnail, content }) =>
  toTemplateInfo((await api.saveTemplate({ name, description, content, ...(thumbnail ? { thumbnail } : {}) })).template);

export async function deleteTemplate(id: string): Promise<void> {
  await api.deleteTemplate(id);
}

export function uploadImage(file: Blob): Promise<{ url: string }> {
  return api.uploadImage(file);
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

export async function listMembers(id: string): Promise<HostUser[]> {
  const { members } = await api.listMembers(id);
  return members.map((m) => ({ id: m.userId, name: m.name, color: m.color, avatarUrl: m.avatarUrl }));
}
