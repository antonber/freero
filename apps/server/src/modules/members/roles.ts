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
 * The effective role of `userId` on a board, or null for no access.
 * - the owner is always 'owner';
 * - an explicit membership grants its role;
 * - any signed-in user gets the board's link access (unless it is 'none').
 * A member never ends up with less than what the shared link gives everyone, so the
 * result is the higher of membership and link access.
 */
export function resolveRole(
  board: { ownerId: string; linkAccess: LinkAccess },
  userId: string | null,
  memberRole: Role | null,
): Role | null {
  if (!userId) return null;
  if (userId === board.ownerId) return 'owner';
  const member: Role | null = memberRole === 'owner' ? 'editor' : memberRole; // only the board owner is 'owner'
  const link: Role | null = board.linkAccess === 'none' ? null : board.linkAccess;
  if (member && link) return ROLE_RANK[member] >= ROLE_RANK[link] ? member : link;
  return member ?? link;
}
