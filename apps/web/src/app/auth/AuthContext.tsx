import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Account, User } from '@freero/shared';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';

export interface AuthValue {
  /** The signed-in user, or null. `deletionScheduledFor` set: only the restore page is usable. */
  user: Account | null;
  /** True until the initial session check finishes. */
  loading: boolean;
  login(email: string, password: string): Promise<Account>;
  signup(name: string, email: string, password: string): Promise<Account>;
  logout(): Promise<void>;
  /** Re-fetches the session. */
  refresh(): Promise<Account | null>;
  /** Saves name/color; every open tab (boards included) picks the change up. */
  updateProfile(patch: Partial<Pick<User, 'name' | 'color' | 'avatarUrl'>>): Promise<Account>;
  /**
   * Adopts an account the server just returned (avatar change, password reset sign-in, restore)
   * — or null after it signed this tab out (deletion) — and tells the other tabs.
   */
  adopt(user: Account | null): void;
}

/** Other tabs of the app hear about session/profile changes here and re-check the session. */
const CHANNEL = 'freero:auth';

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.session();
      setUser(user);
      return user;
    } catch {
      // Network / server error: keep whatever we had.
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // The offline sandbox (/board/local, dev only) has no account: asking the server there would
  // only log 401s (or proxy errors when no server runs). Check once the user leaves it.
  const { pathname } = useLocation();
  const offline = import.meta.env.DEV && pathname === '/board/local';
  useEffect(() => {
    if (!offline) void refresh();
  }, [refresh, offline]);

  // Logged out, logged in as someone else or renamed in another tab: follow along. One channel
  // per tab, used for both directions: a channel never receives its own messages.
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (offline || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = () => void refresh();
    channel.current = ch;
    return () => {
      channel.current = null;
      ch.close();
    };
  }, [refresh, offline]);
  const announce = useCallback(() => channel.current?.postMessage('changed'), []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.login({ email: email.trim(), password });
    setUser(user);
    announce();
    return user;
  }, [announce]);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const { user } = await api.signup({ name: name.trim(), email: email.trim(), password });
    setUser(user);
    announce();
    return user;
  }, [announce]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      announce();
    }
  }, [announce]);

  const updateProfile = useCallback(async (patch: Partial<Pick<User, 'name' | 'color' | 'avatarUrl'>>) => {
    const { user } = await api.updateMe(patch);
    setUser(user);
    announce();
    return user;
  }, [announce]);

  const adopt = useCallback((next: Account | null) => {
    setUser(next);
    announce();
  }, [announce]);

  const value = useMemo<AuthValue>(
    () => ({ user, loading, login, signup, logout, refresh, updateProfile, adopt }),
    [user, loading, login, signup, logout, refresh, updateProfile, adopt],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}
