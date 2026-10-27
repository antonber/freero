// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@freero/shared';
import { api, ApiError } from '../api/client';
import { AuthProvider } from './AuthContext';
import { RequireAuth } from './RequireAuth';
import { AuthPage } from '../pages/auth/AuthPage';

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>();
  return { ...real, api: { session: vi.fn(), login: vi.fn(), signup: vi.fn(), logout: vi.fn() } };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ada: User = { id: 'u1', name: 'Ada', email: 'ada@example.com', color: '#5F3DC4', avatarUrl: null, createdAt: 0 };
let root: Root;
let host: HTMLDivElement;

function Probe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}

function render(path: string) {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Probe />
          <Routes>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route
              path="/board/:id"
              element={
                <RequireAuth>
                  <p data-testid="board">board content</p>
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  });
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const loc = () => host.querySelector('[data-testid="loc"]')!.textContent;

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(api.session).mockReset();
  vi.mocked(api.login).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('auth guard', () => {
  it('sends a signed-out visitor to /login with ?next=, then back to the exact board after logging in', async () => {
    vi.mocked(api.session).mockResolvedValue({ user: null });
    vi.mocked(api.login).mockResolvedValue({ user: ada });
    render('/board/b1?dock=templates');
    await flush();

    expect(loc()).toBe('/login?next=%2Fboard%2Fb1%3Fdock%3Dtemplates');
    expect(host.querySelector('[data-testid="board"]')).toBeNull();

    type(host.querySelector<HTMLInputElement>('input[type="email"]')!, 'ada@example.com');
    type(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'secret-pass');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    });
    await flush();

    expect(api.login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'secret-pass' });
    expect(loc()).toBe('/board/b1?dock=templates');
    expect(host.querySelector('[data-testid="board"]')).not.toBeNull();
  });

  it('does not bounce a signed-in user to /login while the session check is still in flight', async () => {
    let resolve!: (v: { user: User }) => void;
    vi.mocked(api.session).mockReturnValue(new Promise((r) => (resolve = r)));
    render('/board/b1');
    await flush();
    expect(loc()).toBe('/board/b1');

    await act(async () => resolve({ user: ada }));
    await flush();
    expect(loc()).toBe('/board/b1');
    expect(host.querySelector('[data-testid="board"]')).not.toBeNull();
  });

  it('shows the server error instead of navigating when the login is rejected', async () => {
    vi.mocked(api.session).mockResolvedValue({ user: null });
    vi.mocked(api.login).mockRejectedValue(new ApiError(401, 'Incorrect email or password'));
    render('/login?next=%2Fboard%2Fb1');
    await flush();
    type(host.querySelector<HTMLInputElement>('input[type="email"]')!, 'ada@example.com');
    type(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'wrong');
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    });
    await flush();
    expect(loc()).toBe('/login?next=%2Fboard%2Fb1');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Incorrect email or password');
  });
});
