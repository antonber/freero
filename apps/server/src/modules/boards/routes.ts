import { Router } from 'express';
import type { BoardSummary } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, forbidden, handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { isLinkAccess } from '../members/index';
import { refreshBoardAccess } from '../realtime/index';
import { deleteUpload, saveUpload } from '../uploads/index';
import * as repo from './repo';
import {
  BOARD_FILTERS,
  type BoardFilter,
  cleanDescription,
  cleanTitle,
  createBoard,
  deleteForever,
  duplicateBoard,
  listBoards,
  moveToTrash,
  requireAccess,
  restoreFromTrash,
  toSummary,
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
      res.json({ boards: await listBoards(currentUser(req).id, filter as BoardFilter, q) } satisfies Out);
    }),
  );

  r.post(
    '/boards',
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      const user = currentUser(req);
      const board = await createBoard(user.id, cleanTitle(req.body?.title), cleanDescription(req.body?.description));
      res.status(201).json({ board: await toSummary(board, user.id, 'owner', { starred: false, lastOpenedAt: null }) } satisfies Out);
    }),
  );

  r.get(
    '/boards/:id',
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board, role } = await requireAccess(req.params.id, user.id);
      await repo.recordOpen(board.id, user.id, Date.now());
      res.json({ board: await toSummary(board, user.id, role) } satisfies Out);
    }),
  );

  r.patch(
    '/boards/:id',
    handle(async (req, res) => {
      const user = currentUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { board, role } = await requireAccess(req.params.id, user.id);
      const patch: { title?: string; description?: string; linkAccess?: typeof board.linkAccess } = {};
      if (body.title !== undefined) patch.title = cleanTitle(body.title);
      if (body.description !== undefined) patch.description = cleanDescription(body.description);
      if (body.linkAccess !== undefined) {
        if (role !== 'owner') throw forbidden('Only the board owner can change link sharing');
        if (!isLinkAccess(body.linkAccess)) throw badRequest('linkAccess must be none, viewer, commenter or editor');
        if (body.linkAccess !== 'none' && !user.emailVerified) throw forbidden('Verify your email address before sharing by link');
        patch.linkAccess = body.linkAccess;
      }
      if ((patch.title !== undefined || patch.description !== undefined) && role !== 'owner' && role !== 'editor')
        throw forbidden('You need editor access to rename this board');
      if (Object.keys(patch).length > 0) await repo.updateBoardFields(board.id, patch, Date.now());
      if (patch.linkAccess !== undefined && patch.linkAccess !== board.linkAccess) await refreshBoardAccess(board.id);
      const { board: updated, role: newRole } = await requireAccess(board.id, user.id);
      res.json({ board: await toSummary(updated, user.id, newRole) } satisfies Out);
    }),
  );

  r.delete(
    '/boards/:id',
    handle(async (req, res) => {
      const { board } = await requireAccess(req.params.id, currentUser(req).id, 'owner');
      await moveToTrash(board);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/restore',
    handle(async (req, res) => {
      const user = currentUser(req);
      const board = await restoreFromTrash(req.params.id, user.id);
      res.json({ board: await toSummary(board, user.id, 'owner') } satisfies Out);
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
      const { board } = await requireAccess(req.params.id, user.id);
      const copy = await duplicateBoard(board, user.id);
      res.status(201).json({ board: await toSummary(copy, user.id, 'owner', { starred: false, lastOpenedAt: null }) } satisfies Out);
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
