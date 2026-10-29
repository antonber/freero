// Builds the ZIP of a data export from what each owning module exports (this module reads no
// other module's tables). Layout — personal:
//   README.txt, account.json, api.json, memberships.json, activity.json, comments.json, notifications.json,
//   templates/<name>-<id>.json, uploads/index.json + uploads/<file>,
//   boards/<title>-<id>/board.json (record + content + the layers you may read), board.yjs, files/<file>
//   (a doc, KAI-162: the same folder, plus doc.md — its document as Markdown)
// workspace: README.txt, workspace.json, templates/…, boards/… (the same board layout).
import { strToU8, zipSync, type Zippable } from 'fflate';
import { aiUsageExportOf, aiWorkspaceExportOf } from '../ai/index';
import { apiDataOf } from '../apiauth/index';
import { exportAccountData, getUser } from '../auth/index';
import { engageExportOf } from '../engage/index';
import { boardActivityOf, boardIdsInWorkspace, boardIdsOpenedBy, boardIdsOwnedByUser, boardRecords, type BoardRecord } from '../boards/index';
import { membershipsOf } from '../members/index';
import { notificationsExportOf } from '../notifications/index';
import { commentsWrittenBy, exportBoardContent } from '../realtime/index';
import { scimExportOf, scimRecordsOf } from '../scim/index';
import { ssoExportOf, ssoRolesOf } from '../sso/index';
import { templatesExportOf } from '../templates/index';
import { readUpload, uploadNamesIn, uploadsOwnedBy } from '../uploads/index';
import { exportMembershipsOf, exportWorkspaceDirectory, teamWorkspaceIdsFor } from '../workspaces/index';
import { exportsRequestedBy } from './repo';

/** Files (images, PDFs) embedded in one archive at most; the rest are listed, not included. */
export const MAX_EMBEDDED_BYTES = 200 * 1024 * 1024;

const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2));
const slug = (s: string) => s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40).toLowerCase() || 'untitled';

class Archive {
  files: Zippable = {};
  embedded = 0;
  skipped: Array<{ path: string; reason: string }> = [];
  add(path: string, data: Uint8Array, compress = true) {
    this.files[path] = compress ? data : [data, { level: 0 }];
  }
  addJson(path: string, v: unknown) {
    this.add(path, json(v));
  }
  /** An upload's bytes, within the size budget. */
  async addUpload(path: string, name: string): Promise<boolean> {
    const bytes = await readUpload(name);
    if (!bytes) {
      this.skipped.push({ path, reason: 'the file is no longer stored' });
      return false;
    }
    if (this.embedded + bytes.length > MAX_EMBEDDED_BYTES) {
      this.skipped.push({ path, reason: `over the ${MAX_EMBEDDED_BYTES / 1024 / 1024} MB of files one export carries` });
      return false;
    }
    this.embedded += bytes.length;
    this.add(path, bytes, false);
    return true;
  }
  zip(): Uint8Array {
    if (this.skipped.length) this.addJson('files-not-included.json', this.skipped);
    return zipSync(this.files, { level: 6 });
  }
}

/** One board: its record, content (+ layers the exporter may read) as JSON, its Yjs state and its images. */
async function addBoard(a: Archive, b: BoardRecord, appOrigin: string, layers: { editorsLayer: boolean; privateLayerOf: string | null }) {
  const dir = `boards/${slug(b.title)}-${b.id}`;
  const content = await exportBoardContent(b.id, layers);
  a.addJson(`${dir}/board.json`, {
    board: { ...b, url: `${appOrigin}/${b.kind === 'doc' ? 'doc' : 'board'}/${b.id}` },
    content: content.json,
    layers: Object.fromEntries(content.layers.map((l) => [l.name, l.json])),
  });
  if (content.state) a.add(`${dir}/board.yjs`, content.state);
  if (content.markdown) a.add(`${dir}/doc.md`, strToU8(content.markdown));
  const text = JSON.stringify(content.json) + JSON.stringify(content.layers.map((l) => l.json));
  for (const name of uploadNamesIn(text)) await a.addUpload(`${dir}/files/${name}`, name);
}

const README_USER = (name: string, at: string) => `Freero data export for ${name}, made ${at}.

account.json        your profile, sign-in methods and signed-in devices (no passwords or secrets)
api.json            your API tokens, the apps you authorised and the apps you registered (no secrets)
memberships.json    workspaces, projects and boards you are a member of; what workspaces' directories (SSO/SCIM) hold about you
activity.json       boards you starred and when you last opened boards; your AI usage (counts only)
comments.json       every comment you wrote, by board, with the thread and item it is attached to
notifications.json  your notifications and email settings
templates/          templates you saved (Freero's own JSON; insertable again)
uploads/            files you uploaded (images, PDFs), with index.json
boards/             boards you own: board.json (readable JSON of every item, comment and setting,
                    plus your private drafts and hidden frames' contents), board.yjs (the board's
                    complete Yjs document, lossless) and the images the board uses; docs the same,
                    plus doc.md (the document as Markdown)
files-not-included.json  (only if present) files that could not be included and why
`;

const README_WORKSPACE = (name: string, at: string) => `Freero export of the workspace ${name}, made ${at}.

workspace.json  the workspace, its sharing policies, members (with email addresses), invitations,
                projects, single sign-on settings (no secrets), provisioned directory data and
                AI settings (no key) with AI usage per person and month
templates/      templates shared with the workspace
boards/         every board in the workspace (trash included): board.json (readable JSON of every
                item, comment and setting, and hidden frames' contents — never anyone's private
                drafts), board.yjs (the complete Yjs document) and the images each board uses;
                docs too, with doc.md (the document as Markdown)
files-not-included.json  (only if present) files that could not be included and why
`;

export async function buildUserArchive(userId: string, appOrigin: string): Promise<Uint8Array> {
  const a = new Archive();
  const account = await exportAccountData(userId);
  if (!account) throw new Error('the account is gone');
  a.add('README.txt', strToU8(README_USER(account.profile.name, new Date().toISOString())));
  a.addJson('account.json', account);
  a.addJson('api.json', await apiDataOf(userId));

  const [workspaces, boardRoles, sso, scim] = await Promise.all([exportMembershipsOf(userId), membershipsOf(userId), ssoRolesOf(userId), scimRecordsOf(userId)]);
  const invited = await boardRecords([...boardRoles.keys()]);
  a.addJson('memberships.json', {
    workspaces,
    boards: invited.map((b) => ({ boardId: b.id, title: b.title, role: boardRoles.get(b.id) })),
    singleSignOn: sso,
    directoryRecords: scim,
  });
  a.addJson('activity.json', {
    ...(await boardActivityOf(userId)),
    dataExports: (await exportsRequestedBy(userId)).map((e) => ({ kind: e.kind, status: e.status, createdAt: new Date(e.createdAt).toISOString() })),
    aiUsage: await aiUsageExportOf(userId),
  });

  // Comments: on every board they could have written on (owned, invited, opened, their teams').
  const owned = await boardIdsOwnedByUser(userId);
  const teamBoards = (await Promise.all((await teamWorkspaceIdsFor(userId)).map((w) => boardIdsInWorkspace(w)))).flat();
  const candidates = [...new Set([...owned, ...boardRoles.keys(), ...(await boardIdsOpenedBy(userId)), ...teamBoards])];
  const records = new Map((await boardRecords(candidates)).map((b) => [b.id, b]));
  const comments = [];
  for (const id of candidates) {
    const b = records.get(id);
    if (!b) continue;
    const threads = await commentsWrittenBy(id, userId);
    if (threads.length) comments.push({ board: { id, title: b.title, url: `${appOrigin}/board/${id}` }, threads });
  }
  a.addJson('comments.json', comments);
  a.addJson('notifications.json', await notificationsExportOf(userId));
  // Answers and questions in live activities (KAI-132), anonymous ones included: they are theirs.
  a.addJson('activities.json', await engageExportOf(userId));

  for (const t of await templatesExportOf({ ownerId: userId })) a.addJson(`templates/${slug(t.name)}-${t.id}.json`, t);

  const uploads = await uploadsOwnedBy(userId);
  a.addJson('uploads/index.json', uploads.map((u) => ({ ...u, createdAt: new Date(u.createdAt).toISOString(), url: `${appOrigin}/uploads/${u.name}` })));
  for (const u of uploads) await a.addUpload(`uploads/${u.name}`, u.name);

  for (const b of await boardRecords(owned)) await addBoard(a, b, appOrigin, { editorsLayer: true, privateLayerOf: userId });
  return a.zip();
}

export async function buildWorkspaceArchive(workspaceId: string, appOrigin: string): Promise<Uint8Array> {
  const a = new Archive();
  const directory = await exportWorkspaceDirectory(workspaceId);
  if (!directory) throw new Error('the workspace is gone');
  a.add('README.txt', strToU8(README_WORKSPACE(directory.workspace.name, new Date().toISOString())));
  a.addJson('workspace.json', {
    ...directory,
    singleSignOn: await ssoExportOf(workspaceId),
    provisioning: await scimExportOf(workspaceId),
    ai: await aiWorkspaceExportOf(workspaceId),
  });
  for (const t of await templatesExportOf({ workspaceId })) a.addJson(`templates/${slug(t.name)}-${t.id}.json`, t);
  for (const b of await boardRecords(await boardIdsInWorkspace(workspaceId))) await addBoard(a, b, appOrigin, { editorsLayer: true, privateLayerOf: null });
  return a.zip();
}

/** The person's display name (for mails). */
export async function nameOf(userId: string): Promise<string | null> {
  return (await getUser(userId))?.name ?? null;
}
