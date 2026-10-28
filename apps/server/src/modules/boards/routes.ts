import { Router } from 'express';
import type { BoardSummary, LinkAccess } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, forbidden, handle, HttpError } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { recordAuditQuietly } from '../audit/index';
import { currentUser, requireUser } from '../auth/index';
import { isLinkAccess, ROLE_RANK } from '../members/index';
import { mayShareExternally } from '../workspaces/index';
import { refreshBoardAccess } from '../realtime/index';
import { deleteUpload, saveUpload } from '../uploads/index';
import * as repo from './repo';
import {
  BOARD_FILTERS,
  boardTarget,
  recordExport,
  type BoardFilter,
  cleanDescription,
  cleanTitle,
  createBoard,
  deleteForever,
  duplicateBoard,
  listBoards,
  moveToProject,
  moveToTrash,
  requireAccess,
  requireDownload,
  restoreFromTrash,
  summarize,
  toSummary,
  transferBoard,
} from './service';

const MAX_THUMBNAIL_BYTES = 1024 * 1024;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/;

type Out = { board: BoardSummary } | { boards: BoardSummary[] } | { ok: true };

export default function boardRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.use('/boards', requireUser);

  r.get(
    '/boards',
    handle(async (req, res) => {
      const filter = (typeof req.query.filter === 'string' && req.query.filter) || 'all';
      if (!BOARD_FILTERS.includes(filter as BoardFilter)) throw badRequest(`filter must be one of ${BOARD_FILTERS.join(', ')}`);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const workspaceId = typeof req.query.workspace === 'string' ? req.query.workspace : undefined;
      const projectId = typeof req.query.project === 'string' && req.query.project ? req.query.project : undefined;
      res.json({ boards: await listBoards(currentUser(req).id, filter as BoardFilter, q, { workspaceId, projectId }) } satisfies Out);
    }),
  );

  r.post(
    '/boards',
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      const user = currentUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const place = {
        workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
        projectId: typeof body.projectId === 'string' ? body.projectId : null,
      };
      const board = await createBoard(user.id, cleanTitle(body.title), cleanDescription(body.description), 'none', place);
      res.status(201).json({ board: await summarize(board, user.id, { starred: false, lastOpenedAt: null }) } satisfies Out);
    }),
  );

  r.get(
    '/boards/:id',
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board, role, access } = await requireAccess(req.params.id, user.id);
      await repo.recordOpen(board.id, user.id, Date.now());
      res.json({ board: await toSummary(board, user.id, role, access) } satisfies Out);
    }),
  );

  r.patch(
    '/boards/:id',
    handle(async (req, res) => {
      const user = currentUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { board, role, access } = await requireAccess(req.params.id, user.id);
      const patch: { title?: string; description?: string; linkAccess?: typeof board.linkAccess } = {};
      if (body.title !== undefined) patch.title = cleanTitle(body.title);
      if (body.description !== undefined) patch.description = cleanDescription(body.description);
      if (body.linkAccess !== undefined) {
        if (role !== 'owner') throw forbidden('Only the board owner can change link sharing');
        if (!isLinkAccess(body.linkAccess)) throw badRequest('linkAccess must be none, viewer, commenter or editor');
        if (board.linkBlocked) throw new HttpError(403, 'Freero’s moderators turned link sharing off for this board. Use the appeal link in the email we sent you.', 'link_blocked');
        if (body.linkAccess !== 'none' && !user.emailVerified) throw forbidden('Verify your email address before sharing by link');
        if (body.linkAccess !== 'none' && body.linkAccess !== board.linkAccess) {
          // Workspace policies: links reach people outside the workspace, and only up to a maximum role.
          if (access.maxLink === 'none') throw forbidden('This workspace doesn’t allow sharing boards by link');
          if (ROLE_RANK[body.linkAccess] > ROLE_RANK[access.maxLink as Exclude<LinkAccess, 'none'>])
            throw forbidden(`This workspace allows links up to “can ${access.maxLink === 'viewer' ? 'view' : 'comment'}”`);
          if (!mayShareExternally(access.workspaceRole, access.policies)) throw forbidden('This workspace doesn’t let you share its boards outside it');
        }
        patch.linkAccess = body.linkAccess;
      }
      if ((patch.title !== undefined || patch.description !== undefined) && role !== 'owner' && role !== 'editor')
        throw forbidden('You need editor access to rename this board');
      if (body.projectId !== undefined) {
        if (body.projectId !== null && typeof body.projectId !== 'string') throw badRequest('projectId must be a project id or null');
        if ((body.projectId || null) !== board.projectId) await moveToProject(board, user.id, (body.projectId as string | null) || null);
      }
      if (Object.keys(patch).length > 0) await repo.updateBoardFields(board.id, patch, Date.now());
      if (patch.linkAccess !== undefined && patch.linkAccess !== board.linkAccess) {
        await recordAuditQuietly({
          action: 'board.link_sharing_changed',
          workspaceId: board.workspaceId,
          actorId: user.id,
          target: boardTarget(board),
          metadata: { from: board.linkAccess, to: patch.linkAccess },
        });
        await refreshBoardAccess(board.id);
      }
      const { board: updated, role: newRole, access: newAccess } = await requireAccess(board.id, user.id);
      res.json({ board: await toSummary(updated, user.id, newRole, newAccess) } satisfies Out);
    }),
  );

  r.delete(
    '/boards/:id',
    handle(async (req, res) => {
      const { board } = await requireAccess(req.params.id, currentUser(req).id, 'owner');
      await moveToTrash(board, currentUser(req).id);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/restore',
    handle(async (req, res) => {
      const user = currentUser(req);
      const board = await restoreFromTrash(req.params.id, user.id);
      res.json({ board: await summarize(board, user.id) } satisfies Out);
    }),
  );

  r.delete(
    '/boards/:id/permanent',
    handle(async (req, res) => {
      await deleteForever(req.params.id, currentUser(req).id);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/duplicate',
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board, role, access } = await requireAccess(req.params.id, user.id);
      requireDownload(access); // a copy takes the content out of the workspace's control
      const copy = await duplicateBoard(board, user.id, role);
      res.status(201).json({ board: await summarize(copy, user.id, { starred: false, lastOpenedAt: null }) } satisfies Out);
    }),
  );

  // The web app reports exports it made in the browser (image, PDF), so they are audited.
  r.post(
    '/boards/:id/exported',
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      await recordExport(req.params.id, currentUser(req).id, req.body?.format);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/transfer',
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board } = await requireAccess(req.params.id, user.id);
      const moved = await transferBoard(board, user.id, req.body?.userId);
      res.json({ board: await summarize(moved, user.id) } satisfies Out);
    }),
  );

  r.put(
    '/boards/:id/star',
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board } = await requireAccess(req.params.id, user.id);
      await repo.star(board.id, user.id, Date.now());
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.delete(
    '/boards/:id/star',
    handle(async (req, res) => {
      const user = currentUser(req);
      await repo.unstar(req.params.id, user.id); // unstarring works even if access was lost
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.put(
    '/boards/:id/thumbnail',
    handle(async (req, res) => {
      const { board } = await requireAccess(req.params.id, currentUser(req).id, 'editor');
      const dataUrl = req.body?.dataUrl;
      const m = typeof dataUrl === 'string' ? DATA_URL_RE.exec(dataUrl) : null;
      if (!m) throw badRequest('dataUrl must be a base64 PNG, JPEG or WebP data URL');
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.byteLength > MAX_THUMBNAIL_BYTES) throw badRequest('Thumbnail is too large (max 1MB)');
      const url = await saveUpload(bytes, m[1]);
      // The previous thumbnail as of THIS write (a concurrent save may have replaced the one we read).
      const previous = await repo.setThumbnail(board.id, url);
      await deleteUpload(previous === undefined ? url : previous); // board deleted meanwhile: drop ours
      res.json({ ok: true } satisfies Out);
    }),
  );

  return r;
}
