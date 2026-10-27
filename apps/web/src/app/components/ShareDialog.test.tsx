// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardMember, BoardSummary, Role, User } from '@freero/shared';
import { api } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { ShareDialog } from './ShareDialog';

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>();
  return { ...real, api: { session: vi.fn(), listMembers: vi.fn(), getBoard: vi.fn() } };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const user = (id: string, name: string): User => ({ id, name, email: `${id}@x.io`, color: '#1C7ED6', avatarUrl: null, createdAt: 0 });
const member = (id: string, name: string, role: Role): BoardMember => ({ userId: id, name, email: `${id}@x.io`, color: '#1C7ED6', avatarUrl: null, role });
const MEMBERS = [member('u1', 'Ada', 'owner'), member('u2', 'Bob', 'editor'), member('u3', 'Cy', 'viewer')];
const board = (role: Role): BoardSummary => ({
  id: 'b1', title: 'Roadmap', description: '', ownerId: 'u1', ownerName: 'Ada', role, starred: false,
  thumbnail: null, linkAccess: 'viewer', createdAt: 0, updatedAt: 0, lastOpenedAt: null,
});

let root: Root;
let host: HTMLDivElement;

/** `role` = the server's current role; `pageRole` = what the board page loaded earlier (may be stale). */
async function open(me: User, role: Role, pageRole: Role = role) {
  vi.mocked(api.session).mockResolvedValue({ user: me });
  vi.mocked(api.getBoard).mockResolvedValue({ board: board(role) });
  vi.mocked(api.listMembers).mockResolvedValue({ members: MEMBERS });
  act(() => {
    root.render(
      <MemoryRouter>
        <AuthProvider>
          <ShareDialog boardId="b1" board={board(pageRole)} open onClose={() => {}} />
        </AuthProvider>
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  // The dialog renders in a portal on document.body.
  return {
    removeButtons: () => document.querySelectorAll('button[aria-label^="Remove "]'),
    roleSelects: () => document.querySelectorAll('button[aria-label^="Role for "]'),
    linkSelect: () => document.querySelector('button[aria-label="Link access"]'),
    inviteForm: () => document.querySelector('input[aria-label="Email address to invite"]'),
    leaveButton: () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Leave board'),
    memberRows: () => document.querySelectorAll('[data-testid="share-member"]'),
  };
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('ShareDialog permissions', () => {
  it('lets the owner change roles, remove others and set link access, but never remove themselves', async () => {
    const ui = await open(user('u1', 'Ada'), 'owner');
    expect(ui.memberRows()).toHaveLength(3);
    // Bob and Cy only; the owner row has no role select / remove control.
    expect(ui.removeButtons()).toHaveLength(2);
    expect(ui.roleSelects()).toHaveLength(2);
    expect([...ui.removeButtons()].map((b) => b.getAttribute('aria-label'))).not.toContain('Remove Ada');
    expect(ui.linkSelect()).not.toBeNull();
    expect(ui.leaveButton()).toBeUndefined();
  });

  it('hides owner-only controls from an editor but still lets them invite and leave', async () => {
    const ui = await open(user('u2', 'Bob'), 'editor');
    expect(ui.memberRows()).toHaveLength(3);
    expect(ui.removeButtons()).toHaveLength(0);
    expect(ui.roleSelects()).toHaveLength(0);
    expect(ui.linkSelect()).toBeNull();
    expect(ui.inviteForm()).not.toBeNull();
    expect(ui.leaveButton()).toBeDefined();
  });

  it('does not offer inviting to a viewer, even one demoted from editor after the board page loaded', async () => {
    const ui = await open(user('u3', 'Cy'), 'viewer', 'editor');
    expect(ui.inviteForm()).toBeNull();
    expect(ui.removeButtons()).toHaveLength(0);
    expect(ui.linkSelect()).toBeNull();
  });
});
