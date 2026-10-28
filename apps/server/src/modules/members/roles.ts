// Pure role resolution. owner > explicit member role > link access.
import type { LinkAccess, Role } from '@freero/shared';

export const ROLE_RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
export const INVITABLE_ROLES = ['editor', 'commenter', 'viewer'] as const;
export const LINK_ACCESS_VALUES: LinkAccess[] = ['none', 'viewer', 'commenter', 'editor'];

export type MemberRole = (typeof INVITABLE_ROLES)[number];

export const isMemberRole = (v: unknown): v is MemberRole => (INVITABLE_ROLES as readonly unknown[]).includes(v);
export const isLinkAccess = (v: unknown): v is LinkAccess => (LINK_ACCESS_VALUES as unknown[]).includes(v);

export function atLeast(role: Role | null, min: Role): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * What the board's workspace contributes to an access decision (modules/workspaces computes it;
 * structural here so this file stays pure).
 */
export interface WorkspaceAccess {
  /** What the workspace grants by itself (team access to its boards), or null. */
  teamRole: Role | null;
  /** The user is in the board's workspace (any workspace role). */
  inWorkspace: boolean;
  /** The workspace allows no outside access: direct invites and links work only for its people. */
  outsidersBlocked: boolean;
  /** Highest link access the workspace allows. */
  maxLink: LinkAccess;
  /** Set when the workspace closes its boards to this user (deactivated, two-step required): no access at all. */
  blocked?: string | null;
}

const LINK_RANK: Record<LinkAccess, number> = { none: 0, viewer: 1, commenter: 2, editor: 3 };
const higher = (a: Role | null, b: Role | null): Role | null => (!a ? b : !b ? a : ROLE_RANK[a] >= ROLE_RANK[b] ? a : b);

/**
 * The effective role of `userId` on a board, or null for no access.
 * - nobody gets anything while the workspace blocks them (deactivated, two-step verification
 *   required and off), not even the board's owner;
 * - the owner is always 'owner';
 * - otherwise the highest of: an explicit membership, what the workspace grants its members
 *   (team access), and the board's link access for any signed-in user;
 * - link access never exceeds the workspace's maximum; when the workspace allows no outside
 *   access, people outside it get nothing from memberships or links.
 */
export function resolveRole(
  board: { ownerId: string; linkAccess: LinkAccess },
  userId: string | null,
  memberRole: Role | null,
  ws?: WorkspaceAccess,
): Role | null {
  if (!userId) return null;
  if (ws?.blocked) return null;
  if (userId === board.ownerId) return 'owner';
  const outsider = !!ws && !ws.inWorkspace && ws.outsidersBlocked;
  const member: Role | null = outsider ? null : memberRole === 'owner' ? 'editor' : memberRole; // only the board owner is 'owner'
  let linkAccess = board.linkAccess;
  if (ws && LINK_RANK[linkAccess] > LINK_RANK[ws.maxLink]) linkAccess = ws.maxLink;
  const link: Role | null = linkAccess === 'none' || outsider ? null : linkAccess;
  return higher(higher(member, ws?.teamRole ?? null), link);
}
