import { describe, expect, it } from 'vitest';
import { atLeast, isMemberRole, resolveRole } from './roles';

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
