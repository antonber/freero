import { describe, expect, it } from 'vitest';
import { atLeast, isMemberRole, resolveGuestRole, resolveRole, type WorkspaceAccess } from './roles';

const board = (linkAccess: 'none' | 'viewer' | 'commenter' | 'editor' = 'none') => ({ ownerId: 'owner', linkAccess });

describe('resolveRole precedence (owner > member > link access)', () => {
  it('does not demote the owner through a membership row or link setting', () => {
    expect(resolveRole(board('viewer'), 'owner', 'viewer')).toBe('owner');
  });

  it('does not let a membership row grant ownership', () => {
    expect(resolveRole(board(), 'u1', 'owner')).toBe('editor');
  });

  it('honours the member role over a weaker link setting', () => {
    expect(resolveRole(board('viewer'), 'u1', 'editor')).toBe('editor');
    expect(resolveRole(board('none'), 'u1', 'commenter')).toBe('commenter');
  });

  it('does not leave a member with less access than everyone with the link', () => {
    expect(resolveRole(board('editor'), 'u1', 'viewer')).toBe('editor');
  });

  it('does not leak a private board to signed-in strangers', () => {
    expect(resolveRole(board('none'), 'stranger', null)).toBeNull();
  });

  it('gives strangers exactly the link access, not more', () => {
    expect(resolveRole(board('viewer'), 'stranger', null)).toBe('viewer');
    expect(resolveRole(board('commenter'), 'stranger', null)).toBe('commenter');
  });

  it('does not grant link access to anonymous requests', () => {
    expect(resolveRole(board('editor'), null, null)).toBeNull();
  });
});

describe('guests (visitors without an account on a shared link)', () => {
  const ws = (o: Partial<WorkspaceAccess> = {}): WorkspaceAccess => ({
    teamRole: null,
    inWorkspace: false,
    outsidersBlocked: false,
    maxLink: 'editor',
    anonymousLinks: true,
    ...o,
  });

  it('never lets a guest edit, even on a "can edit" link, and caps them by the workspace’s link maximum', () => {
    expect(resolveGuestRole(board('editor'), ws())).toBe('commenter');
    expect(resolveGuestRole(board('editor'), ws({ maxLink: 'viewer' }))).toBe('viewer');
    expect(resolveGuestRole(board('none'), ws())).toBeNull();
  });

  it('lets no guest in where the workspace requires sign-in or keeps its boards to its own people', () => {
    expect(resolveGuestRole(board('viewer'), ws({ anonymousLinks: false }))).toBeNull();
    expect(resolveGuestRole(board('viewer'), ws({ outsidersBlocked: true }))).toBeNull();
  });
});

describe('permission gates', () => {
  it('does not let lower roles pass an editor-only check', () => {
    expect(atLeast('commenter', 'editor')).toBe(false);
    expect(atLeast('viewer', 'commenter')).toBe(false);
    expect(atLeast(null, 'viewer')).toBe(false);
    expect(atLeast('owner', 'editor')).toBe(true);
  });

  it("does not allow inviting someone as 'owner'", () => {
    expect(isMemberRole('owner')).toBe(false);
  });
});
