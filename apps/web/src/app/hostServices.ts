// Thin wrappers over the REST client for building the engine's `Host`
// (see Host in engine/api.ts). Used from app/board/.
import type { ResolvedObject, SavedTemplateSummary } from '@freero/shared';
import type { ElementsSnapshot, Host, HostUser, LinkPreview, SavedTemplateInfo, VersionHistory } from '@engine';
import { api, wsBase } from './api/client';

/** Host.docs (KAI-162): docs made next to `boardId`, their sockets and Markdown downloads. */
export function docsFrom(boardId: string | null, navigate: (path: string) => void): NonNullable<Host['docs']> {
  return {
    syncUrl: `${wsBase()}/ws/docs`,
    async create({ title, markdown }) {
      const { doc } = await api.createDoc({ title, markdown, ...(boardId ? { fromBoard: boardId } : {}) });
      return { id: doc.id, title: doc.title };
    },
    async exportMarkdown(docId) {
      const md = await api.docMarkdown(docId);
      saveText(md, `${docFileName(md)}.md`, 'text/markdown;charset=utf-8');
    },
    requestAccess: (docId) => navigate(`/doc/${encodeURIComponent(docId)}`),
  };
}

/** A file name from a doc's first heading (characters file systems refuse dropped). */
export function docFileName(markdown: string, fallback = 'doc'): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(markdown)?.[1] ?? fallback;
  return heading.replace(/[\\/:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;
}

/** Saves text as a file on the person's computer. */
export function saveText(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  saveAs(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

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

/** Documents (PDF), video and audio go through the same upload endpoint, quota and checks as images. */
export function uploadFile(file: Blob): Promise<{ url: string }> {
  return api.uploadImage(file);
}

/** Any other file: stored as an attachment (never served inline). */
export function uploadAttachment(file: Blob): Promise<{ url: string }> {
  return api.uploadAttachment(file);
}

/** Hands a file to the browser's downloads under `name`. */
export function saveAs(href: string, name: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Host.downloadFile on a real board: through the server (downloads policy, audit log). */
export function downloadBoardFile(boardId: string): NonNullable<Host['downloadFile']> {
  return async ({ id, name }) => {
    const blob = await api.downloadBoardFile(boardId, id);
    const url = URL.createObjectURL(blob);
    saveAs(url, name);
    // The download has started from the object URL by now; give slow browsers a moment.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
}

export async function renameBoard(id: string, title: string): Promise<void> {
  await api.updateBoard(id, { title });
}

/** Reports a browser export to the server's audit log; a failure never bothers the person exporting. */
export function reportExport(boardId: string, format: string): void {
  api.reportBoardExport(boardId, format).catch(() => undefined);
}

export async function saveThumbnail(id: string, dataUrl: string): Promise<void> {
  await api.putThumbnail(id, dataUrl);
}

export function unfurl(url: string): Promise<LinkPreview> {
  return api.unfurl(url);
}

// Object addresses (smart links, KAI-149): every address asked for within one frame goes out as ONE
// request, and answers are kept briefly so a board full of chips doesn't ask again on every
// render — but a renamed target shows its new name on the next view.
const RESOLVE_TTL_MS = 15_000;
const resolvedCache = new Map<string, { at: number; value: ResolvedObject }>();
let waiting: Map<string, Array<{ resolve: (r: ResolvedObject) => void; reject: (e: unknown) => void }>> | null = null;

function flushResolve(): void {
  const batch = waiting;
  waiting = null;
  if (!batch) return;
  const uris = [...batch.keys()];
  api.resolveObjects(uris).then(
    ({ objects }) => {
      const at = Date.now();
      objects.forEach((r, i) => {
        resolvedCache.set(uris[i], { at, value: r });
        for (const w of batch.get(uris[i]) ?? []) w.resolve(r);
      });
    },
    (e) => {
      for (const ws of batch.values()) for (const w of ws) w.reject(e);
    },
  );
}

export function resolveObjects(uris: string[]): Promise<ResolvedObject[]> {
  const now = Date.now();
  return Promise.all(
    uris.map((uri) => {
      const hit = resolvedCache.get(uri);
      if (hit && now - hit.at < RESOLVE_TTL_MS) return Promise.resolve(hit.value);
      return new Promise<ResolvedObject>((resolve, reject) => {
        if (!waiting) {
          waiting = new Map();
          setTimeout(flushResolve, 16);
        }
        waiting.set(uri, [...(waiting.get(uri) ?? []), { resolve, reject }]);
      });
    }),
  );
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
