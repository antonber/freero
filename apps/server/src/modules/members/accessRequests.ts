// "Request access": someone signed in who can't open a board asks for it, and the people who decide
// who joins that board approve (as a role of their choice) or decline. Approval is a board
// membership like an invite's; the requester's open page lets them in when they hear back.
//
// Deciders: the board's owner, and for a team board its workspace's owners/admins plus, for a board
// in a private project, the project's creator (workspaces.boardGatekeepers). Who is NOTIFIED is
// narrower: the owner plus the admins, or for a private project's board the people running the
// project — not every admin of a large workspace. Someone outside the workspace can be let in only
// as its "external sharing" policy allows (like an invite).
import type { AccessRequestState, Account, BoardAccessRequest } from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { recordAuditQuietly } from '../audit/index';
import { getUsers } from '../auth/index';
import { boardPlace, getBoardAccess } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
import { boardAccess, boardGatekeepers, isManager, mayShareExternally } from '../workspaces/index';
import { accessDecided, accessRequested } from './events';
import * as repo from './repo';
import { isMemberRole, type MemberRole } from './roles';

/** Asking again after a "no" waits this long (approvers aren't pestered by repeats). */
export const DENIED_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_MESSAGE = 500;

type Place = NonNullable<Awaited<ReturnType<typeof boardPlace>>>;

async function placeOf(boardId: string): Promise<Place> {
  const place = await boardPlace(boardId);
  if (!place) throw notFound('Board not found');
  return place;
}

/**
 * Why `userId` can't be let in by anyone, or null: the workspace closes its boards to them
 * (deactivated there, or two-step verification required and off: KAI-51 — nothing a board
 * membership could override), or keeps its boards to its own people.
 */
async function blockedReason(place: Place, userId: string): Promise<string | null> {
  const ws = await boardAccess(userId, place);
  if (ws.blocked === 'deactivated') return 'Your access to this team workspace is paused. Ask one of its admins.';
  if (ws.blocked) return 'This team requires two-step verification. Turn it on in your account settings, then try again.';
  if (!ws.inWorkspace && ws.outsidersBlocked) return 'This board is only open to people in its team workspace. Ask its owner to add you to the team.';
  return null;
}

/** The requester's side: where their request stands (and whether they got in meanwhile). */
export async function requestState(boardId: string, userId: string): Promise<AccessRequestState> {
  const place = await placeOf(boardId);
  const { role } = await getBoardAccess(boardId, userId);
  if (role) return { status: 'granted', role, canRequest: false };
  const [req, blocked] = await Promise.all([repo.getAccessRequest(boardId, userId), blockedReason(place, userId)]);
  if (blocked) return { status: req?.status === 'pending' ? 'pending' : 'none', canRequest: false, reason: blocked };
  if (req?.status === 'pending') return { status: 'pending', canRequest: false };
  if (req?.status === 'denied' && (req.decidedAt ?? 0) > Date.now() - DENIED_COOLDOWN_MS)
    return { status: 'denied', canRequest: false, reason: 'Your request was declined. You can ask again in a little while.' };
  return { status: req?.status === 'denied' ? 'denied' : 'none', canRequest: true };
}

/** Files a request (one pending per person per board) and tells the people who decide. */
export async function requestAccess(boardId: string, user: Account, body: { role?: unknown; message?: unknown }): Promise<AccessRequestState> {
  const role = body.role === undefined ? 'editor' : body.role;
  if (!isMemberRole(role)) throw badRequest('role must be editor, commenter or viewer');
  if (body.message !== undefined && typeof body.message !== 'string') throw badRequest('message must be a string');
  const message = (body.message ?? '').trim().slice(0, MAX_MESSAGE);
  // Otherwise anyone could make throwaway accounts to flood a board's owner with requests.
  if (!user.emailVerified) throw forbidden('Verify your email address before asking for access');
  const place = await placeOf(boardId);
  if ((await getBoardAccess(boardId, user.id)).role) throw new HttpError(409, 'You already have access to this board');
  const blocked = await blockedReason(place, user.id);
  if (blocked) throw forbidden(blocked);
  const now = Date.now();
  const filed = await repo.fileAccessRequest({ boardId, userId: user.id, role, message }, now, now - DENIED_COOLDOWN_MS);
  if (filed === 'board-gone') throw notFound('Board not found');
  if (filed === 'denied') throw new HttpError(429, 'Your request was declined. You can ask again in a little while.');
  if (filed === 'created') {
    await recordAuditQuietly({
      action: 'board.access_requested',
      workspaceId: place.workspaceId,
      actorId: user.id,
      target: { type: 'board', id: boardId, label: place.title },
      metadata: { role },
    });
    const { notify } = await boardGatekeepers(place);
    const recipients = [...new Set([place.ownerId, ...notify])].filter((id) => id !== user.id);
    await accessRequested({ boardId, boardTitle: place.title, requesterId: user.id, role, message, createdAt: now, recipientIds: recipients });
  }
  return requestState(boardId, user.id);
}

export async function withdrawRequest(boardId: string, userId: string): Promise<AccessRequestState> {
  await repo.withdrawAccessRequest(boardId, userId);
  return requestState(boardId, userId);
}

/** May `userId` decide requests for this board (approve / decline)? */
async function isDecider(place: Place, userId: string): Promise<boolean> {
  if (place.ownerId === userId) return true;
  return (await boardGatekeepers(place)).deciders.includes(userId);
}

/** For the share dialog: the pending requests (deciders only; others get 403). */
export async function listRequests(boardId: string, userId: string): Promise<BoardAccessRequest[]> {
  const place = await placeOf(boardId);
  if (!(await isDecider(place, userId))) throw forbidden('Only the board owner and workspace admins see access requests');
  const rows = await repo.pendingAccessRequests(boardId);
  const users = await getUsers(rows.map((r) => r.userId));
  const out: BoardAccessRequest[] = [];
  for (const r of rows) {
    const u = users.get(r.userId);
    if (u) out.push({ userId: u.id, name: u.name, email: u.email, color: u.color, avatarUrl: u.avatarUrl, role: r.role, message: r.message, createdAt: r.createdAt });
  }
  return out;
}

/**
 * Approves (as `role`, default: what they asked for) or declines a pending request. Approval
 * gives a board membership that never lowers access they have meanwhile. 409 if someone else
 * decided it first.
 */
export async function decideRequest(
  boardId: string,
  decider: Account,
  requesterId: string,
  body: { decision?: unknown; role?: unknown },
): Promise<void> {
  if (body.decision !== 'approve' && body.decision !== 'deny') throw badRequest('decision must be approve or deny');
  if (body.role !== undefined && !isMemberRole(body.role)) throw badRequest('role must be editor, commenter or viewer');
  const place = await placeOf(boardId);
  if (!(await isDecider(place, decider.id))) throw forbidden('Only the board owner and workspace admins can let people in');
  const pending = await repo.getAccessRequest(boardId, requesterId);
  if (!pending || pending.status !== 'pending') throw new HttpError(409, 'This request was already handled');
  const approve = body.decision === 'approve';
  const role: MemberRole = (body.role as MemberRole | undefined) ?? pending.role;
  if (approve) {
    const [requesterWs, deciderWs] = await Promise.all([boardAccess(requesterId, place), boardAccess(decider.id, place)]);
    // Never past a workspace that closes its boards to them (deactivated, two-step required).
    if (requesterWs.blocked) throw forbidden('This person can’t open the team’s boards right now (deactivated, or two-step verification required)');
    // Like an invite: people outside a team workspace only as its "external sharing" policy allows.
    if (!requesterWs.inWorkspace && (requesterWs.outsidersBlocked || !mayShareExternally(deciderWs.workspaceRole, deciderWs.policies)))
      throw forbidden(
        isManager(deciderWs.workspaceRole) || requesterWs.outsidersBlocked
          ? 'This workspace only lets its boards be shared with people in it'
          : 'This workspace only lets its owners and admins share boards with people outside it',
      );
  }
  const decided = await repo.transaction(async () => {
    const d = await repo.decideAccessRequest(boardId, requesterId, { status: approve ? 'approved' : 'denied', by: decider.id, role: approve ? role : null }, Date.now());
    if (d && approve && !(await repo.grantAtLeast(boardId, requesterId, role, Date.now()))) throw notFound('Board not found');
    return d;
  });
  if (!decided) throw new HttpError(409, 'This request was already handled');
  await recordAuditQuietly({
    action: approve ? 'board.access_approved' : 'board.access_declined',
    workspaceId: place.workspaceId,
    actorId: decider.id,
    target: { type: 'board', id: boardId, label: place.title },
    metadata: { userId: requesterId, ...(approve ? { role } : {}) },
  });
  if (approve) await refreshBoardAccess(boardId);
  await accessDecided({ boardId, boardTitle: place.title, requesterId, deciderId: decider.id, approved: approve, role: approve ? role : null });
}

/**
 * Where the requests behind access-request notifications stand, for `viewerId`'s inbox (keyed
 * `${boardId}:${requesterId}`). A request withdrawn (or asked again later) reads as 'withdrawn'.
 */
export async function requestOutcomes(
  viewerId: string,
  items: Array<{ boardId: string; requesterId: string; createdAt: number }>,
): Promise<Map<string, { role: MemberRole; status: 'pending' | 'approved' | 'denied' | 'withdrawn'; decidedRole: MemberRole | null; canDecide: boolean }>> {
  const rows = await repo.accessRequestsFor(items.map((i) => ({ boardId: i.boardId, userId: i.requesterId })));
  const byKey = new Map(rows.map((r) => [`${r.boardId}:${r.userId}`, r]));
  const deciderOf = new Map<string, Promise<boolean>>();
  const out = new Map<string, { role: MemberRole; status: 'pending' | 'approved' | 'denied' | 'withdrawn'; decidedRole: MemberRole | null; canDecide: boolean }>();
  for (const i of items) {
    const key = `${i.boardId}:${i.requesterId}`;
    const r = byKey.get(key);
    // A newer request replaced the one this notification was about (or it was withdrawn).
    if (!r || r.createdAt > i.createdAt + 60_000) {
      out.set(key, { role: r?.role ?? 'viewer', status: 'withdrawn', decidedRole: null, canDecide: false });
      continue;
    }
    if (!deciderOf.has(i.boardId))
      deciderOf.set(
        i.boardId,
        boardPlace(i.boardId).then((p) => (p ? isDecider(p, viewerId) : false)),
      );
    out.set(key, { role: r.role, status: r.status, decidedRole: r.decidedRole, canDecide: r.status === 'pending' && (await deciderOf.get(i.boardId)!) });
  }
  return out;
}

