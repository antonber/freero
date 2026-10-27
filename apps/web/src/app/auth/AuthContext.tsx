import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@freero/shared';
import { useLocation } from 'react-router-dom';
import { api, ApiError } from '../api/client';

export interface AuthValue {
  /** The signed-in user, or null. */
  user: User | null;
  /** True until the initial session check finishes. */
  loading: boolean;
  login(email: string, password: string): Promise<User>;
  signup(name: string, email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  /** Re-fetches the session (e.g. after a profile update). */
  refresh(): Promise<User | null>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
      return user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        return null;
      }
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

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.login({ email: email.trim(), password });
    setUser(user);
    return user;
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const { user } = await api.signup({ name: name.trim(), email: email.trim(), password });
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, loading, login, signup, logout, refresh }),
    [user, loading, login, signup, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}
