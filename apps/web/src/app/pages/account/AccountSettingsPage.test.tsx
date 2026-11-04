// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, NotificationPrefs } from '@freero/shared';
import { ToastProvider } from '@ui';
import { api } from '../../api/client';
import { AuthProvider } from '../../auth/AuthContext';
import { AccountSettingsPage } from './AccountSettingsPage';
import { NotificationsSections } from './NotificationsSections';

// The calls these tests answer; every other one stays pending (its section keeps loading).
vi.mock('../../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/client')>();
  const answered: Record<string, unknown> = { session: vi.fn(), notificationPrefs: vi.fn(), setNotificationPrefs: vi.fn() };
  const pending = () => new Promise(() => undefined);
  return { ...real, api: new Proxy(answered, { get: (t, k: string) => (k in t ? t[k] : pending) }) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me: Account = { id: 'u1', name: 'Ada', email: 'ada@x.io', color: '#1C7ED6', avatarUrl: null, createdAt: 0, emailVerified: true, deletionScheduledFor: null, timeZone: 'UTC' };

let root: Root;
let host: HTMLDivElement;
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
};
async function render(at: string, page = <AccountSettingsPage />) {
  window.history.replaceState(null, '', at);
  vi.mocked(api.session).mockResolvedValue({ user: me });
  act(() => {
    root.render(
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/settings" element={page} />
              <Route path="/settings/:group" element={page} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>,
    );
  });
  await settle();
}
const heading = () => document.querySelector('h1')?.textContent;
const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(api.notificationPrefs).mockReturnValue(new Promise(() => undefined));
  // jsdom has no scrolling.
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollTo = () => undefined;
  Element.prototype.scrollTo = () => undefined;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  localStorage.clear();
  vi.clearAllMocks();
});

describe('links into account settings', () => {
  // Links already sent in emails and Slack messages, the server's redirects and other pages all
  // still say /settings#<section> (or a query): they must land in the group holding the section.
  it.each([
    ['/settings#notifications', '/settings/notifications#notifications', 'Notifications'],
    ['/settings#two-factor', '/settings/security#two-factor', 'Sign-in & security'],
    ['/settings#connected-apps', '/settings/integrations#connected-apps', 'Integrations'],
    ['/settings#api-tokens', '/settings/developer#api-tokens', 'Developer'],
    ['/settings#problems', '/settings/account#problems', 'Account & data'],
    ['/settings#data', '/settings/account#data', 'Account & data'],
    ['/settings?section=trackers', '/settings/integrations#trackers', 'Integrations'],
    ['/settings?error=failed', '/settings/security', 'Sign-in & security'],
    ['/settings', '/settings', 'Profile'],
  ])('%s opens %s', async (link, landing, group) => {
    await render(link);
    expect(here()).toBe(landing);
    expect(heading()).toBe(group);
  });

  it('a sign-in provider’s or Slack’s return still reaches the section that reports it, in its new group', async () => {
    await render('/settings?connected=google');
    expect(heading()).toBe('Sign-in & security');
    expect(document.body.textContent).toContain('Connected. You can now log in with it.');
    act(() => root.unmount());
    root = createRoot(host);

    await render('/settings?slack=connected#slack');
    expect(heading()).toBe('Integrations');
    expect(document.body.textContent).toContain('Slack connected');
    expect(here()).toBe('/settings/integrations#slack');
  });
});

const PREFS: NotificationPrefs = {
  emailAll: true,
  boardChanges: 'off',
  boardComments: false,
  slack: { linked: true },
  types: [
    { type: 'comment.mention', label: 'Mentions', description: 'Someone @mentions you in a comment.', email: true, slack: true },
    { type: 'comment.reply', label: 'Replies', description: 'Someone replies in a comment thread you started or wrote in.', email: true, slack: true },
    { type: 'comment.thread', label: 'New comments on your boards', description: 'Someone starts a comment thread on a board you own or starred.', email: true, slack: true },
  ],
};
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const click = async (label: string) => {
  const b = button(label);
  if (!b) throw new Error(`no button “${label}”`);
  act(() => b.click());
  await settle();
};

describe('the notifications table', () => {
  beforeEach(() => {
    vi.mocked(api.notificationPrefs).mockResolvedValue(PREFS);
    vi.mocked(api.setNotificationPrefs).mockImplementation(async (patch) => ({
      ...PREFS,
      boardComments: patch.boardComments ?? PREFS.boardComments,
      types: PREFS.types.map((t) => ({ ...t, email: patch.email?.[t.type] ?? t.email, slack: patch.slack?.[t.type] ?? t.slack })),
    }));
    // A browser that can show notifications, turned on here.
    (window as unknown as { Notification: unknown }).Notification = function Notification() {};
    localStorage.setItem('freero:device-notifications', JSON.stringify({ on: true, off: [] }));
  });

  it('opts into new comments on your boards through boardComments, the switch the server checks before creating them', async () => {
    await render('/settings/notifications', <NotificationsSections />);
    expect(button('Email: New comments on your boards')).toBeNull();
    await click('Turn on New comments on your boards');
    expect(vi.mocked(api.setNotificationPrefs).mock.calls).toEqual([[{ boardComments: true }]]);
    // Now on: its channels can be chosen like any other kind's, and it can be turned off again.
    expect(button('Email: New comments on your boards')).not.toBeNull();
    await click('Turn off New comments on your boards');
    expect(vi.mocked(api.setNotificationPrefs).mock.calls[1]).toEqual([{ boardComments: false }]);
  });

  it('writes each column to its own channel: Email and Slack to the account’s kinds, This browser to this device only', async () => {
    await render('/settings/notifications', <NotificationsSections />);
    await click('Slack: Mentions');
    await click('Email: Replies');
    expect(vi.mocked(api.setNotificationPrefs).mock.calls).toEqual([[{ slack: { 'comment.mention': false } }], [{ email: { 'comment.reply': false } }]]);

    await click('This browser: Mentions');
    expect(vi.mocked(api.setNotificationPrefs)).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem('freero:device-notifications') ?? '{}')).toEqual({ on: true, off: ['comment.mention'] });
    // The account's switches for it are as they were.
    expect(button('Email: Mentions')?.getAttribute('aria-checked')).toBe('true');
  });
});
