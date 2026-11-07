// The community template gallery (#162): submissions, the public catalogue, installs, and what
// modules/moderation needs to review them.
//
// - Submit: signed in with a verified address, on a board they can edit and may share outside its
//   workspace (publishing is the widest sharing there is) and copy out (the downloads policy). The
//   board's shared content is copied ONCE through content.ts — no comments, hidden frames, drafts,
//   names — with a preview drawn from that copy; the board itself is never linked again. Pending
//   until an operator approves it; operators are mailed about each submission.
// - Public: approved ones only, to anyone (the site's /gallery pages, the API), while their
//   submitter isn't suspended. Everything else — pending, rejected, removed, withdrawn, a suspended
//   submitter's, unknown — is the same 404.
// - Install: a new board from the template's copy in a workspace the person may create boards in
//   (board quota and permissions as any new board), with the credit and licence in its description.
// - Moderation decides the status (decideGalleryTemplate), records and audits it, notifies; this
//   module only applies it. It imports nothing from moderation, so the dependency goes one way.
import {
  GALLERY_CATEGORIES,
  GALLERY_LICENCES,
  GALLERY_LIMITS,
  MAX_GALLERY_PER_USER,
  type Account,
  type BoardElement,
  type GalleryCategory,
  type GalleryForReview,
  type GalleryLicence,
  type GalleryStatus,
  type GalleryTemplate,
  type ModeratedGalleryTemplate,
  type OwnGalleryTemplate,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log } from '../../platform/log';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';
import { recordAudit } from '../audit/index';
import { getUsers, suspendedUserIds } from '../auth/index';
import { createBoardWithState, requireBoardAccess, requireBoardDownload } from '../boards/index';
import { boardBackupContent, encodeBoardContent } from '../realtime/index';
import { renderContentSvg } from '../render/index';
import { UPLOAD_REF_PATTERN } from '../uploads/index';
import { ensurePersonalWorkspace } from '../workspaces/index';
import { contentForInstall, galleryContentOf } from './content';
import * as repo from './repo';

export const MAX_ITEMS = 5000;
export const MAX_CONTENT_BYTES = 1536 * 1024;
/** Pictures inlined into a preview; past this (or a preview over MAX_PREVIEW_CHARS) they are placeholders. */
const PREVIEW_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_CHARS = 3 * 1024 * 1024;
const LIST_LIMIT = 200;
const ID_RE = /^[A-Za-z0-9_-]{6,32}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

const isCategory = (v: unknown): v is GalleryCategory => GALLERY_CATEGORIES.some((c) => c.id === v);
const isLicence = (v: unknown): v is GalleryLicence => GALLERY_LICENCES.some((l) => l.id === v);
export const licenceName = (l: GalleryLicence) => GALLERY_LICENCES.find((x) => x.id === l)?.name ?? l;
export const validId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id);

/** Plain text within `max`: control and direction-override characters removed; `oneLine` folds whitespace. */
function clean(v: unknown, max: number, what: string, opts: { oneLine: boolean; required: boolean }): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw badRequest(`${what} must be text`, 'gallery_invalid');
  let t = v.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  t = (opts.oneLine ? t.replace(/\s+/g, ' ') : t.replace(/\n{3,}/g, '\n\n')).trim();
  if (opts.required && !t) throw badRequest(`Give the template ${what === 'title' ? 'a title' : `a ${what}`}`, `gallery_${what}`);
  if (t.length > max) throw badRequest(`The ${what} may be at most ${max} characters`, `gallery_${what}_long`, { max });
  return t;
}

function present(r: repo.GalleryRow): GalleryTemplate {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    licence: r.licence,
    author: r.author,
    items: r.items,
    publishedAt: r.publishedAt,
    url: `/gallery/${r.id}`,
    previewUrl: `/gallery/${r.id}/preview.svg`,
  };
}
// Not public (yet, or any more): its picture is the signed-in preview, for its submitter and operators.
const presentOwn = (r: repo.GalleryRow): OwnGalleryTemplate => ({
  ...present(r),
  previewUrl: `/api/gallery/${r.id}/preview.svg`,
  status: r.status,
  statusNote: r.statusNote,
  createdAt: r.createdAt,
});

// ---- public ----

/**
 * Whether a template is public: approved, and its submitter's account isn't suspended (#192). A
 * suspension hides everything the account published (pages, previews, installs, the sitemap) for
 * as long as it lasts and lifting it brings it all back, without writing anything here: the
 * operator's decisions stay as they were, and one taken while the account is suspended counts
 * once it isn't.
 */
async function isPublic(r: repo.GalleryRow): Promise<boolean> {
  return r.status === 'approved' && !(await suspendedUserIds([r.submittedBy])).size;
}

/** Public templates matching the words of `q` and `category` (both optional), newest first. */
export async function publicTemplates(q: unknown, category: unknown): Promise<GalleryTemplate[]> {
  const words = typeof q === 'string' ? q.slice(0, GALLERY_LIMITS.query).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8) : [];
  const suspended: string[] = [];
  for (;;) {
    const rows = await repo.published({ words, category: isCategory(category) ? category : null, limit: LIST_LIMIT, exceptSubmitters: suspended });
    const more = await suspendedUserIds([...new Set(rows.map((r) => r.submittedBy))]);
    if (!more.size) return rows.map(present);
    suspended.push(...more);
  }
}

/** A public template, or null for anything else (pending, decided against, withdrawn, its submitter suspended, unknown). */
export async function publicTemplate(id: unknown): Promise<GalleryTemplate | null> {
  if (!validId(id)) return null;
  const r = await repo.get(id);
  return r && (await isPublic(r)) ? present(r) : null;
}

/**
 * The preview picture of a template for `viewerId` (null: signed out): anyone's when it is public;
 * a pending or decided one only for its submitter (their own list) or an operator reviewing it.
 */
export async function previewFor(id: unknown, viewer: { userId: string | null; operator: boolean }): Promise<string | null> {
  if (!validId(id)) return null;
  const r = await repo.get(id);
  if (!r) return null;
  if (!viewer.operator && r.submittedBy !== viewer.userId && !(await isPublic(r))) return null;
  return repo.previewOf(id);
}

// ---- submitting ----

/** Files a board as a pending community template. */
export async function submitTemplate(user: Pick<Account, 'id' | 'emailVerified' | 'name'>, body: Record<string, unknown>): Promise<OwnGalleryTemplate> {
  if (!user.emailVerified) throw new HttpError(403, 'Confirm your email address first: a link to it is in your settings.', 'email_unverified');
  const boardId = typeof body.boardId === 'string' ? body.boardId : '';
  if (!boardId) throw badRequest('boardId is required');
  const title = clean(body.title, GALLERY_LIMITS.title, 'title', { oneLine: true, required: true });
  const description = clean(body.description, GALLERY_LIMITS.description, 'description', { oneLine: false, required: true });
  const author = clean(body.author ?? user.name, GALLERY_LIMITS.author, 'author', { oneLine: true, required: true });
  if (!isCategory(body.category)) throw badRequest(`category must be one of ${GALLERY_CATEGORIES.map((c) => c.id).join(', ')}`, 'gallery_category');
  if (!isLicence(body.licence)) throw badRequest(`licence must be one of ${GALLERY_LICENCES.map((l) => l.id).join(', ')}`, 'gallery_licence');

  // Someone who can edit the board, whose workspace lets them share outside it and take its content out.
  const access = await requireBoardAccess(boardId, user.id, 'editor');
  if (access.kind !== 'board') throw badRequest('Only a board can be a template', 'gallery_not_board');
  if (!access.canShareExternally) throw forbidden('This workspace doesn’t let you share its boards outside it', 'gallery_share_restricted');
  await requireBoardDownload(boardId, user.id, 'template');

  // The shared document only: private drafts and hidden frames' contents live in layers it never reads.
  const { doc } = await boardBackupContent(boardId, { editorsLayer: false });
  const { content, elements } = galleryContentOf(doc);
  if (!elements.length) throw badRequest('This board has nothing a template could carry', 'gallery_empty');
  if (elements.length > MAX_ITEMS) throw badRequest(`A template can hold at most ${MAX_ITEMS} items`, 'gallery_too_many', { max: MAX_ITEMS });
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_CONTENT_BYTES) throw new HttpError(413, 'This board is too large for a template', 'gallery_too_large');

  const collection = (name: string) => new Map(Object.entries(content[name] ?? {}));
  let preview = (await renderContentSvg(elements as unknown as BoardElement[], collection, { maxImageBytes: PREVIEW_IMAGE_BYTES })).svg;
  if (preview.length > MAX_PREVIEW_CHARS) preview = (await renderContentSvg(elements as unknown as BoardElement[], collection, { maxImageBytes: 0 })).svg;

  const row: repo.GalleryRow = {
    id: newId(12),
    submittedBy: user.id,
    sourceBoardId: boardId,
    status: 'pending',
    title,
    description,
    category: body.category,
    licence: body.licence,
    author,
    items: elements.length,
    statusNote: '',
    installs: 0,
    createdAt: Date.now(),
    decidedAt: null,
    publishedAt: null,
  };
  if (!(await repo.insertWithinLimit(row, content, preview, MAX_GALLERY_PER_USER)))
    throw new HttpError(403, `You can have up to ${MAX_GALLERY_PER_USER} templates waiting or public at once; withdraw one first`, 'gallery_limit', { max: MAX_GALLERY_PER_USER });
  // Content leaving the board for the public: in the board's workspace log, like saving a template.
  await recordAudit({
    action: 'gallery.submitted',
    workspaceId: access.workspaceId,
    actorId: user.id,
    target: { type: 'board', id: boardId, label: access.title },
    metadata: { template: row.id, title, licence: row.licence, items: row.items },
  });
  log(`gallery: template ${row.id} submitted`);
  alertOperators(title);
  return presentOwn(row);
}

export async function ownTemplates(userId: string): Promise<OwnGalleryTemplate[]> {
  return (await repo.ownedBy(userId)).map(presentOwn);
}

/** Withdraws one of the person's own submissions, whatever its status (it is gone everywhere). */
export async function withdrawTemplate(userId: string, id: string): Promise<void> {
  if (!validId(id) || !(await repo.deleteOwn(id, userId))) throw notFound('No such template');
  log(`gallery: template ${id} withdrawn by its submitter`);
}

/** Operators are mailed when a submission waits for review (the moderation console lists it). */
function alertOperators(title: string): void {
  const subject = `New community template to review: “${title}”`;
  for (const to of getConfig().operatorEmails)
    sendMailLater({
      to,
      ...renderMail({
        subject,
        title: subject,
        paragraphs: ['Someone submitted a board to the community template gallery. It stays hidden until you approve it.'],
        action: { label: 'Review templates', url: appUrl(null, '/operator?view=gallery') },
      }),
    });
}

// ---- installing ----

/** A new board from an approved template in `workspaceId` (default: the person's personal workspace). */
export async function installTemplate(userId: string, id: string, body: Record<string, unknown>): Promise<{ boardId: string }> {
  const t = validId(id) ? await repo.get(id) : null;
  if (!t || !(await isPublic(t))) throw notFound('No such template');
  const content = await repo.contentOf(t.id);
  if (!content) throw notFound('No such template');
  const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : await ensurePersonalWorkspace(userId);
  const credit = `From the Freero community gallery: “${t.title}” by ${t.author}, ${licenceName(t.licence)}.`;
  const copy = await createBoardWithState(
    userId,
    { title: t.title, description: `${t.description}\n\n${credit}`.slice(0, 2000), kind: 'board' },
    { workspaceId, projectId: null },
    encodeBoardContent(contentForInstall(content, userId, Date.now())),
  );
  await copy.announce();
  await repo.countInstall(t.id);
  return { boardId: copy.id };
}

// ---- for modules/moderation (its operators decide; it records and audits) ----

/** A template anyone signed in may report: public ones only. */
export async function reportableGalleryTemplate(id: string): Promise<{ id: string; title: string } | null> {
  const r = validId(id) ? await repo.get(id) : null;
  return r && (await isPublic(r)) ? { id: r.id, title: r.title } : null;
}

/** The facts a moderation decision needs. */
export async function galleryForModeration(id: string): Promise<{ id: string; title: string; submitterId: string; status: GalleryStatus } | null> {
  const r = validId(id) ? await repo.get(id) : null;
  return r ? { id: r.id, title: r.title, submitterId: r.submittedBy, status: r.status } : null;
}

export async function moderatedGalleryTemplates(ids: readonly string[]): Promise<Map<string, ModeratedGalleryTemplate>> {
  const rows = await repo.getMany([...new Set(ids)].filter(validId));
  const [users, suspended] = await Promise.all([getUsers(rows.map((r) => r.submittedBy)), suspendedUserIds(rows.map((r) => r.submittedBy))]);
  return new Map(
    rows.map((r) => {
      const u = users.get(r.submittedBy);
      return [r.id, { id: r.id, title: r.title, status: r.status, submitter: u ? { id: u.id, name: u.name, email: u.email, suspended: suspended.has(u.id) } : null }];
    }),
  );
}

export async function galleryForReview(status: GalleryStatus, openReports: (ids: string[]) => Promise<Map<string, number>>): Promise<GalleryForReview[]> {
  const rows = await repo.byStatus(status, LIST_LIMIT);
  const [users, reports] = await Promise.all([getUsers(rows.map((r) => r.submittedBy)), openReports(rows.map((r) => r.id))]);
  return rows.map((r) => {
    const u = users.get(r.submittedBy);
    return { ...presentOwn(r), submitter: u ? { id: u.id, name: u.name, email: u.email } : null, sourceBoardId: r.sourceBoardId, openReports: reports.get(r.id) ?? 0 };
  });
}

export type GalleryDecision = 'approve' | 'reject' | 'remove' | 'restore';

/** Applies an operator's decision; whether anything changed. `note` is what the submitter reads with it. */
export async function decideGalleryTemplate(id: string, decision: GalleryDecision, note: string): Promise<boolean> {
  const now = Date.now();
  switch (decision) {
    case 'approve':
      return repo.transition(id, ['pending', 'rejected'], 'approved', note, now);
    case 'reject':
      return repo.transition(id, ['pending'], 'rejected', note, now);
    case 'remove':
      return repo.transition(id, ['approved'], 'removed', note, now);
    case 'restore':
      return repo.transition(id, ['removed'], 'approved', note, now);
  }
}

/** The person's submissions for their data export (modules/privacy). */
export async function galleryExportOf(userId: string): Promise<OwnGalleryTemplate[]> {
  return ownTemplates(userId);
}

/** Upload names the templates' content uses (the uploads sweep keeps those files). */
export function galleryUploadReferences(among?: readonly string[]): Promise<string[]> {
  return repo.uploadMatches(UPLOAD_REF_PATTERN, among ?? null);
}
