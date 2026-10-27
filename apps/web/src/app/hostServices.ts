// Thin wrappers over the REST client for building the engine's `Host`
// (see Host in engine/api.ts). Used from app/board/.
import type { HostUser, LinkPreview } from '@engine';
import { api } from './api/client';

export function uploadImage(file: Blob): Promise<{ url: string }> {
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
