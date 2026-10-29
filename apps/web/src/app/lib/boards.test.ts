import { describe, expect, it } from 'vitest';
import type { BoardSummary } from '@freero/shared';
import { boardTime, filterByOwner, sortBoards } from './boards';

const b = (id: string, p: Partial<BoardSummary>): BoardSummary => ({
  id,
  kind: 'board',
  title: id,
  description: '',
  ownerId: 'u1',
  ownerName: 'Ada',
  role: 'owner',
  starred: false,
  thumbnail: null,
  linkAccess: 'none',
  workspaceId: 'w1',
  projectId: null,
  team: null,
  member: false,
  permissions: { canExport: true, canShareExternally: true, maxLinkAccess: 'editor', canMove: true, canTransfer: true },
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: null,
  ...p,
});

const boards = [
  b('a', { title: 'Roadmap 10', updatedAt: 300, lastOpenedAt: 50 }),
  b('b', { title: 'roadmap 9', updatedAt: 100, lastOpenedAt: null, ownerId: 'u2' }),
  b('c', { title: 'Retro', updatedAt: 200, lastOpenedAt: 900 }),
];

describe('sortBoards', () => {
  it('puts never-opened boards last when sorting by last opened', () => {
    expect(sortBoards(boards, 'opened').map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
  it('sorts by last modified, newest first', () => {
    expect(sortBoards(boards, 'modified').map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });
  it('sorts names case-insensitively and puts "9" before "10"', () => {
    expect(sortBoards(boards, 'name').map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('does not mutate the array held in React state', () => {
    sortBoards(boards, 'name');
    expect(boards.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('filterByOwner', () => {
  it('separates my boards from boards owned by others', () => {
    expect(filterByOwner(boards, 'me', 'u1').map((x) => x.id)).toEqual(['a', 'c']);
    expect(filterByOwner(boards, 'others', 'u1').map((x) => x.id)).toEqual(['b']);
  });
});

describe('boardTime', () => {
  it('falls back to the edit time for boards never opened, instead of showing epoch', () => {
    expect(boardTime(boards[1], 'opened')).toEqual({ label: 'Edited', at: 100 });
    expect(boardTime(boards[0], 'opened')).toEqual({ label: 'Opened', at: 50 });
  });
});
