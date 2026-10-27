import { Router } from 'express';
import type { BoardSummary } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, forbidden, handle } from '../../platform/http';
import { currentUser, requireUser } from '../auth/index';
import { deleteBoardMembers, isLinkAccess } from '../members/index';
import { copyBoardDoc, deleteBoardDoc, refreshBoardAccess } from '../realtime/index';
import { deleteUpload, saveUpload } from '../uploads/index';
import * as repo from './repo';
import {
  BOARD_FILTERS,
  type BoardFilter,
  cleanDescription,
  cleanTitle,
  createBoard,
  listBoards,
  requireAccess,
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
    handle((req, res) => {
      const filter = (typeof req.query.filter === 'string' && req.query.filter) || 'all';
      if (!BOARD_FILTERS.includes(filter as BoardFilter)) throw badRequest(`filter must be one of ${BOARD_FILTERS.join(', ')}`);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      res.json({ boards: listBoards(currentUser(req).id, filter as BoardFilter, q) } satisfies Out);
    }),
  );

  r.post(
    '/boards',
    handle((req, res) => {
      const user = currentUser(req);
      const board = createBoard(user.id, cleanTitle(req.body?.title), cleanDescription(req.body?.description));
      res.status(201).json({ board: toSummary(board, user.id, 'owner') } satisfies Out);
    }),
  );

  r.get(
    '/boards/:id',
    handle((req, res) => {
      const user = currentUser(req);
      const { board, role } = requireAccess(req.params.id, user.id);
      repo.recordOpen(board.id, user.id, Date.now());
      res.json({ board: toSummary(board, user.id, role) } satisfies Out);
    }),
  );

  r.patch(
    '/boards/:id',
    handle((req, res) => {
      const user = currentUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { board, role } = requireAccess(req.params.id, user.id);
      const patch: { title?: string; description?: string; linkAccess?: typeof board.linkAccess } = {};
      if (body.title !== undefined) patch.title = cleanTitle(body.title);
      if (body.description !== undefined) patch.description = cleanDescription(body.description);
      if (body.linkAccess !== undefined) {
        if (role !== 'owner') throw forbidden('Only the board owner can change link sharing');
        if (!isLinkAccess(body.linkAccess)) throw badRequest('linkAccess must be none, viewer, commenter or editor');
        patch.linkAccess = body.linkAccess;
      }
      if ((patch.title !== undefined || patch.description !== undefined) && role !== 'owner' && role !== 'editor')
        throw forbidden('You need editor access to rename this board');
      if (Object.keys(patch).length > 0) repo.updateBoardFields(board.id, patch, Date.now());
      if (patch.linkAccess !== undefined && patch.linkAccess !== board.linkAccess) refreshBoardAccess(board.id);
      const { board: updated, role: newRole } = requireAccess(board.id, user.id);
      res.json({ board: toSummary(updated, user.id, newRole) } satisfies Out);
    }),
  );

  r.delete(
    '/boards/:id',
    handle((req, res) => {
      const { board } = requireAccess(req.params.id, currentUser(req).id, 'owner');
      deleteBoardDoc(board.id);
      deleteBoardMembers(board.id);
      deleteUpload(board.thumbnail);
      repo.deleteBoardRows(board.id);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/duplicate',
    handle((req, res) => {
      const user = currentUser(req);
      const { board } = requireAccess(req.params.id, user.id);
      const copy = createBoard(user.id, `Copy of ${board.title}`.slice(0, 200), board.description);
      copyBoardDoc(board.id, copy.id);
      res.status(201).json({ board: toSummary(copy, user.id, 'owner') } satisfies Out);
    }),
  );

  r.put(
    '/boards/:id/star',
    handle((req, res) => {
      const user = currentUser(req);
      const { board } = requireAccess(req.params.id, user.id);
      repo.star(board.id, user.id, Date.now());
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.delete(
    '/boards/:id/star',
    handle((req, res) => {
      const user = currentUser(req);
      repo.unstar(req.params.id, user.id); // unstarring works even if access was lost
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.put(
    '/boards/:id/thumbnail',
    handle((req, res) => {
      const { board } = requireAccess(req.params.id, currentUser(req).id, 'editor');
      const dataUrl = req.body?.dataUrl;
      const m = typeof dataUrl === 'string' ? DATA_URL_RE.exec(dataUrl) : null;
      if (!m) throw badRequest('dataUrl must be a base64 PNG, JPEG or WebP data URL');
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.byteLength > MAX_THUMBNAIL_BYTES) throw badRequest('Thumbnail is too large (max 1MB)');
      const url = saveUpload(bytes, m[1]);
      repo.setThumbnail(board.id, url);
      deleteUpload(board.thumbnail);
      res.json({ ok: true } satisfies Out);
    }),
  );

  return r;
}
