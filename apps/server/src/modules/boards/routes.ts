import { Router } from 'express';
import { hasKey } from '../keys/index';
import { guestDisplayName, GUEST_REMOVED, OFFLINE_CHECK_MAX, type BoardCallToken, type BoardGuestsResponse, type BoardCallResponse, type BoardSharingSettings, type BoardSummary, type GuestBoardInfo, type GuestJoinResponse, type LinkAccess, type MoveBoardResponse, type OfflineCheckResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, forbidden, handle, HttpError, notFound, unauthorized } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { recordAuditQuietly } from '../audit/index';
import { actorId, currentActor, currentUser, endGuestSession, guestFromCookieHeader, removedGuestBoard, requireUser, requireUserOrGuest, startGuestSession } from '../auth/index';
import { listBoardGuests, removeBoardGuest, undoGuestEdits } from './guests';
import { isLinkAccess, managesSharing } from '../members/index';
import { deleteUpload, saveUpload } from '../uploads/index';
import { callOf, cleanCallUrl, jitsiAvailable } from './call';
import { dockedCalls } from './callRoom';
import { boardCallToken } from './index';
import { boardLifecycle } from './events';
import { applyLinkProtection, checkVisitorPassword, cleanLinkProtection, hasLinkProtectionPatch, unlockLink } from './linkProtection';
import * as repo from './repo';
import {
  BOARD_FILTERS,
  boardTarget,
  recordExport,
  type BoardFilter,
  cleanDescription,
  checkEmbeddingChange,
  checkLinkAccessChange,
  checkLinkPolicy,
  cleanSharing,
  cleanTitle,
  moveToWorkspace,
  sharingSettingsChanged,
  checkGuestEditingChange,
  embeddingChanged,
  createBoard,
  deleteForever,
  duplicateBoard,
  guestRoleFor,
  guestEditFor,
  linkAccessChanged,
  listBoards,
  moveToProject,
  moveToTrash,
  renameBoard,
  requireAccess,
  requireDownload,
  restoreFromTrash,
  setBoardArchived,
  setBoardLabel,
  mayKeepOffline,
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

  // #178: which of the boards kept on this device may stay there — the person can still open it and
  // its workspace still lets it be kept. Anything else (gone, no access, policy off) is dropped by
  // the device. Never counts as opening the boards.
  r.post(
    '/boards/offline-check',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const ids = (req.body ?? {}).ids;
      if (!Array.isArray(ids) || ids.length > OFFLINE_CHECK_MAX || !ids.every((id) => typeof id === 'string' && id.length <= 64))
        throw badRequest(`ids must be a list of at most ${OFFLINE_CHECK_MAX} board ids`, 'invalid_offline_check');
      const keep: string[] = [];
      for (const id of new Set(ids as string[])) {
        try {
          const { board, access } = await requireAccess(id, user.id);
          if (board.deletedAt === null && (await mayKeepOffline(board, access))) keep.push(id);
        } catch (err) {
          if (!(err instanceof HttpError)) throw err;
        }
      }
      res.json({ keep } satisfies OfflineCheckResponse);
    }),
  );

  r.patch(
    '/boards/:id',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { board, role, access, coOwner } = await requireAccess(req.params.id, user.id);
      // The owner and co-owners (#122) manage sharing: the link, its protection, embedding, the settings.
      const manages = managesSharing(role, coOwner);
      const details: { title?: string; description?: string } = {};
      const patch: { linkAccess?: typeof board.linkAccess; embeddable?: boolean } & Partial<BoardSharingSettings> = {};
      if (body.title !== undefined) details.title = cleanTitle(body.title);
      if (body.description !== undefined) details.description = cleanDescription(body.description);
      if (body.linkAccess !== undefined) {
        if (!isLinkAccess(body.linkAccess)) throw badRequest('linkAccess must be none, viewer, commenter or editor');
        checkLinkAccessChange(board, manages, access, user, body.linkAccess);
        patch.linkAccess = body.linkAccess;
      }
      if (body.embeddable !== undefined) {
        if (typeof body.embeddable !== 'boolean') throw badRequest('embeddable must be true or false');
        checkEmbeddingChange(board, manages, access, body.embeddable);
        patch.embeddable = body.embeddable;
      }
      const sharing = cleanSharing(body.sharing);
      if (Object.keys(sharing).length && !manages) throw forbidden('Only the board’s owner and co-owners can change its sharing settings');
      if (sharing.guestsCanEdit !== undefined) checkGuestEditingChange(board, access, sharing.guestsCanEdit, patch.linkAccess ?? board.linkAccess);
      Object.assign(patch, sharing);
      if (hasLinkProtectionPatch(body) && !manages) throw forbidden('Only the board’s owner and co-owners can protect its link');
      if ((details.title !== undefined || details.description !== undefined) && role !== 'owner' && role !== 'editor')
        throw forbidden('You need editor access to rename this board');
      // Validated before anything is stored: the link as the WHOLE change leaves it must meet the
      // workspace's link policy (#39), so a link is never on without the password it requires.
      const protection = hasLinkProtectionPatch(body) ? await cleanLinkProtection(body) : null;
      if (patch.linkAccess !== undefined || protection)
        checkLinkPolicy(
          board,
          {
            ...(patch.linkAccess !== undefined ? { linkAccess: patch.linkAccess } : {}),
            ...(protection?.passwordHash !== undefined ? { password: protection.passwordHash === null ? 'removed' : 'set' } : {}),
            ...(protection?.expiresAt !== undefined ? { expiresAt: protection.expiresAt } : {}),
          },
          access.policies,
        );
      if (body.projectId !== undefined) {
        if (body.projectId !== null && typeof body.projectId !== 'string') throw badRequest('projectId must be a project id or null');
        if ((body.projectId || null) !== board.projectId) await moveToProject(board, user.id, (body.projectId as string | null) || null);
      }
      // Protection first: a link turned on in the same request is never live without it.
      if (protection) await applyLinkProtection(board, user.id, protection);
      if (Object.keys(patch).length > 0) await repo.updateBoardFields(board.id, patch, Date.now());
      await renameBoard(board, user.id, details);
      if (patch.linkAccess !== undefined && patch.linkAccess !== board.linkAccess) await linkAccessChanged(board, user.id, patch.linkAccess);
      if (patch.embeddable !== undefined && patch.embeddable !== board.embeddable) await embeddingChanged(board, user.id, patch.embeddable);
      await sharingSettingsChanged(board, user.id, sharing);
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
      res.json({ call: callOf(board), jitsiAvailable: jitsiAvailable(), ...(dockedCalls() ? { docked: dockedCalls()! } : {}) } satisfies BoardCallResponse);
    }),
  );

  // #149: joining the board's room on the operator's media server (callRoom.ts).
  r.post(
    '/boards/:id/call/token',
    requireUserOrGuest,
    rateLimit('wsConnect', 'user'),
    handle(async (req, res) => {
      const actor = currentActor(req);
      const who =
        actor.kind === 'user'
          ? { id: actor.user.id, name: actor.user.name, avatarUrl: actor.user.avatarUrl }
          : { id: actor.guest.id, name: guestDisplayName(actor.guest.name) };
      res.setHeader('Cache-Control', 'no-store');
      res.json((await boardCallToken(req.params.id, who)) satisfies BoardCallToken);
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
      res.json({
        call: callOf({ ...board, callUrl: next.url, callJitsi: next.jitsi }),
        jitsiAvailable: jitsiAvailable(),
        ...(dockedCalls() ? { docked: dockedCalls()! } : {}),
      } satisfies BoardCallResponse);
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

  // #153: archive / unarchive (its owner or a content admin of its workspace).
  for (const [verb, archived] of [
    ['archive', true],
    ['unarchive', false],
  ] as const)
    r.post(
      `/boards/:id/${verb}`,
      requireUser,
      handle(async (req, res) => {
        const user = currentUser(req);
        const board = await setBoardArchived(req.params.id, user.id, archived);
        res.json({ board: await summarize(board, user.id) } satisfies Out);
      }),
    );

  // #158: the board's classification label (owner, co-owners, content admins).
  r.put(
    '/boards/:id/label',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const board = await setBoardLabel(req.params.id, user.id, (req.body ?? {}).labelId ?? null);
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
      await requireDownload(board, user.id, access, 'duplicate', role); // a copy takes the content out of the workspace's control
      const body = (req.body ?? {}) as Record<string, unknown>;
      const copy = await duplicateBoard(board, user.id, role, { workspaceId: body.workspaceId, projectId: body.projectId });
      res.status(201).json({ board: await summarize(copy, user.id, { starred: false, lastOpenedAt: null }) } satisfies Out);
    }),
  );

  // Into another workspace (#124): the board's owner only (service.ts moveToWorkspace).
  r.post(
    '/boards/:id/move',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const { board } = await requireAccess(req.params.id, user.id, 'owner');
      const { board: moved, adjusted } = await moveToWorkspace(board, user.id, (req.body ?? {}) as Record<string, unknown>);
      res.json({ board: await summarize(moved, user.id), adjusted } satisfies MoveBoardResponse);
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
      // A picture of the board is its content: a workspace with an encryption key (#159) keeps none
      // in storage outside its key, so its boards have no thumbnail.
      if (await hasKey(board.workspaceId)) return void res.json({ ok: true } satisfies Out);
      const url = await saveUpload(bytes, m[1]);
      // The previous thumbnail as of THIS write (a concurrent save may have replaced the one we read).
      const previous = await repo.setThumbnail(board.id, url);
      await deleteUpload(previous === undefined ? url : previous); // board deleted meanwhile: drop ours
      res.json({ ok: true } satisfies Out);
    }),
  );

  // ---- a board's guests as its owner and co-owners manage them (#97, @freero/shared guestEditing.ts) ----

  r.get(
    '/boards/:id/guests',
    requireUser,
    handle(async (req, res) => {
      res.json({ guests: await listBoardGuests(req.params.id, currentUser(req).id) } satisfies BoardGuestsResponse);
    }),
  );

  r.post(
    '/boards/:id/guests/:guestId/undo',
    requireUser,
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      res.json({ removed: await undoGuestEdits(req.params.id, currentUser(req).id, req.params.guestId) });
    }),
  );

  r.delete(
    '/boards/:id/guests/:guestId',
    requireUser,
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      await removeBoardGuest(req.params.id, currentUser(req).id, req.params.guestId);
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
      // #97: a browser whose guest the owner removed is told so instead of being offered to join again.
      if (role && (await removedGuestBoard(req.headers.cookie)) === board.id) return void res.json({ allowed: false, removed: true } satisfies GuestBoardInfo);
      const canEdit = role ? await guestEditFor(board) : false;
      res.json(
        (role
          ? { allowed: true, role, title: board.title, ...(board.linkPasswordHash ? { passwordRequired: true } : {}), ...(canEdit ? { canEdit: true } : {}) }
          : { allowed: false }) satisfies GuestBoardInfo,
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
      if ((await removedGuestBoard(req.headers.cookie)) === board.id) throw new HttpError(403, 'The board’s owner removed you from this board', GUEST_REMOVED);
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
