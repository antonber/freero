import { Router } from 'express';
import type { BoardCallResponse, BoardSummary, GuestBoardInfo, GuestJoinResponse, LinkAccess } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, forbidden, handle, HttpError, notFound, unauthorized } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { recordAuditQuietly } from '../audit/index';
import { actorId, currentActor, currentUser, endGuestSession, guestFromCookieHeader, requireUser, requireUserOrGuest, startGuestSession } from '../auth/index';
import { isLinkAccess, ROLE_RANK } from '../members/index';
import { mayShareExternally } from '../workspaces/index';
import { refreshBoardAccess } from '../realtime/index';
import { deleteUpload, saveUpload } from '../uploads/index';
import { callOf, cleanCallUrl, jitsiAvailable } from './call';
import { boardLifecycle } from './events';
import { changeLinkProtection, checkVisitorPassword, hasLinkProtectionPatch, unlockLink } from './linkProtection';
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
  guestRoleFor,
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
  // requireUser per route, not `r.use('/boards', …)`: router-level middleware would also run for
  // other modules' /boards/:id/… routes mounted after this one (guests use some of those).

  r.get(
    '/boards',
    requireUser,
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
    requireUser,
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      const user = currentUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const place = {
        workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
        projectId: typeof body.projectId === 'string' ? body.projectId : null,
      };
      const board = await createBoard(user.id, cleanTitle(body.title), cleanDescription(body.description), 'none', place);
      await boardLifecycle({ boardId: board.id, actorId: user.id, action: 'created' });
      res.status(201).json({ board: await summarize(board, user.id, { starred: false, lastOpenedAt: null }) } satisfies Out);
    }),
  );

  r.get(
    '/boards/:id',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board, role, access } = await requireAccess(req.params.id, user.id);
      await repo.recordOpen(board.id, user.id, Date.now());
      res.json({ board: await toSummary(board, user.id, role, access) } satisfies Out);
    }),
  );

  r.patch(
    '/boards/:id',
    requireUser,
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
      if (hasLinkProtectionPatch(body) && role !== 'owner') throw forbidden('Only the board owner can protect its link');
      if ((patch.title !== undefined || patch.description !== undefined) && role !== 'owner' && role !== 'editor')
        throw forbidden('You need editor access to rename this board');
      if (body.projectId !== undefined) {
        if (body.projectId !== null && typeof body.projectId !== 'string') throw badRequest('projectId must be a project id or null');
        if ((body.projectId || null) !== board.projectId) await moveToProject(board, user.id, (body.projectId as string | null) || null);
      }
      if (Object.keys(patch).length > 0) await repo.updateBoardFields(board.id, patch, Date.now());
      if (hasLinkProtectionPatch(body)) await changeLinkProtection(board, user.id, body);
      if (patch.title !== undefined && patch.title !== board.title)
        await boardLifecycle({ boardId: board.id, actorId: user.id, action: 'renamed', from: board.title, to: patch.title });
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

  // Someone signed in gives the password of a board's protected link (KAI-145).
  r.post(
    '/boards/:id/link-unlock',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const board = await repo.getBoard(req.params.id);
      if (!board || !board.linkPasswordHash || board.linkAccess === 'none') throw notFound('Board not found');
      await unlockLink(req, board, user.id, req.body?.password);
      res.json({ ok: true } satisfies Out);
    }),
  );

  // The board's call link (KAI-134): anyone who can open the board reads it; editors set it.
  r.get(
    '/boards/:id/call',
    requireUserOrGuest,
    handle(async (req, res) => {
      const { board } = await requireAccess(req.params.id, actorId(currentActor(req)));
      res.json({ call: callOf(board), jitsiAvailable: jitsiAvailable() } satisfies BoardCallResponse);
    }),
  );

  r.put(
    '/boards/:id/call',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board } = await requireAccess(req.params.id, user.id, 'editor');
      const body = (req.body ?? {}) as Record<string, unknown>;
      let next: { url: string | null; jitsi: boolean };
      if (body.jitsi === true) {
        if (!jitsiAvailable()) throw badRequest('This Freero server has no Jitsi configured: paste a meeting link instead');
        next = { url: board.callUrl, jitsi: true };
      } else if (body.url === null || body.url === undefined || body.url === '') next = { url: null, jitsi: false };
      else next = { url: cleanCallUrl(body.url), jitsi: false };
      await repo.setCall(board.id, next);
      const host = next.url ? new URL(next.url).hostname : null;
      await recordAuditQuietly({
        action: 'board.call_link_changed',
        workspaceId: board.workspaceId,
        actorId: user.id,
        target: boardTarget(board),
        // The host only: meeting links often carry their passcode.
        metadata: { kind: next.jitsi ? 'jitsi' : next.url ? 'link' : 'none', ...(host && !next.jitsi ? { host } : {}) },
      });
      res.json({ call: callOf({ ...board, callUrl: next.url, callJitsi: next.jitsi }), jitsiAvailable: jitsiAvailable() } satisfies BoardCallResponse);
    }),
  );

  r.delete(
    '/boards/:id',
    requireUser,
    handle(async (req, res) => {
      const { board } = await requireAccess(req.params.id, currentUser(req).id, 'owner');
      await moveToTrash(board, currentUser(req).id);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/restore',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const board = await restoreFromTrash(req.params.id, user.id);
      res.json({ board: await summarize(board, user.id) } satisfies Out);
    }),
  );

  r.delete(
    '/boards/:id/permanent',
    requireUser,
    handle(async (req, res) => {
      await deleteForever(req.params.id, currentUser(req).id);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/duplicate',
    requireUser,
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board, role, access } = await requireAccess(req.params.id, user.id);
      await requireDownload(board, user.id, access, 'duplicate'); // a copy takes the content out of the workspace's control
      const copy = await duplicateBoard(board, user.id, role);
      res.status(201).json({ board: await summarize(copy, user.id, { starred: false, lastOpenedAt: null }) } satisfies Out);
    }),
  );

  // The web app reports exports it made in the browser (image, PDF), so they are audited.
  r.post(
    '/boards/:id/exported',
    requireUser,
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      await recordExport(req.params.id, currentUser(req).id, req.body?.format);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/transfer',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board } = await requireAccess(req.params.id, user.id);
      const moved = await transferBoard(board, user.id, req.body?.userId);
      res.json({ board: await summarize(moved, user.id) } satisfies Out);
    }),
  );

  r.put(
    '/boards/:id/star',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board } = await requireAccess(req.params.id, user.id);
      await repo.star(board.id, user.id, Date.now());
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.delete(
    '/boards/:id/star',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      await repo.unstar(req.params.id, user.id); // unstarring works even if access was lost
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.put(
    '/boards/:id/thumbnail',
    requireUser,
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

  // ---- guests: visitors without an account on a shared link (see @freero/shared api.ts) ----

  r.get(
    '/guest/boards/:id',
    handle(async (req, res) => {
      const board = await repo.getBoard(req.params.id);
      if (!board) throw notFound('Board not found');
      const role = await guestRoleFor(board);
      res.json(
        (role ? { allowed: true, role, title: board.title, ...(board.linkPasswordHash ? { passwordRequired: true } : {}) } : { allowed: false }) satisfies GuestBoardInfo,
      );
    }),
  );

  r.post(
    '/guest/boards/:id/join',
    rateLimit('guestJoin', 'ip'),
    handle(async (req, res) => {
      const board = await repo.getBoard(req.params.id);
      if (!board) throw notFound('Board not found');
      if (!(await guestRoleFor(board))) throw forbidden('This board doesn’t let visitors without an account in. Sign in to open it.');
      // A protected link (KAI-145): the password first, then the guest exists and is remembered as having given it.
      if (board.linkPasswordHash) await checkVisitorPassword(req, board, req.body?.password);
      const guest = await startGuestSession(req, res, board.id, req.body?.name);
      if (!guest) throw notFound('Board not found');
      if (board.linkPasswordHash) await repo.recordUnlock(board.id, guest.id, board.linkPasswordRev, Date.now());
      // A visitor, not an account: no actor; the name they gave and their guest id say who.
      await recordAuditQuietly({
        action: 'board.guest_joined',
        workspaceId: board.workspaceId,
        actorId: null,
        target: { type: 'board', id: board.id, label: board.title },
        metadata: { guestId: guest.id, name: guest.name },
      });
      res.status(201).json({ guest } satisfies GuestJoinResponse);
    }),
  );

  // Always 200 (like GET /auth/session): { guest: null } when this browser has no live guest session.
  r.get(
    '/guest/me',
    handle(async (req, res) => {
      res.json({ guest: await guestFromCookieHeader(req.headers.cookie) });
    }),
  );

  // The guest's board as they may see it (only the board they joined; its role re-checked).
  r.get(
    '/guest/boards/:id/board',
    handle(async (req, res) => {
      const guest = await guestFromCookieHeader(req.headers.cookie);
      if (!guest) throw unauthorized();
      if (guest.boardId !== req.params.id) throw forbidden();
      const { board, role, access } = await requireAccess(req.params.id, guest.id);
      res.json({ board: await toSummary(board, guest.id, role, access, { starred: false, lastOpenedAt: null, member: false }) } satisfies Out);
    }),
  );

  // A guest whose board's link got a password (or a new one) since they joined gives it (KAI-145).
  r.post(
    '/guest/boards/:id/unlock',
    handle(async (req, res) => {
      const guest = await guestFromCookieHeader(req.headers.cookie);
      if (!guest) throw unauthorized();
      if (guest.boardId !== req.params.id) throw forbidden();
      const board = await repo.getBoard(req.params.id);
      if (!board || !board.linkPasswordHash || board.linkAccess === 'none') throw notFound('Board not found');
      await unlockLink(req, board, guest.id, req.body?.password);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.post(
    '/guest/leave',
    handle(async (req, res) => {
      await endGuestSession(req, res);
      res.json({ ok: true } satisfies Out);
    }),
  );

  return r;
}
