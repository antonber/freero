import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { loginPath } from '../lib/nav';
import { FullPageSpinner } from '../components/FullPageSpinner';

/** Renders children for signed-in users; otherwise redirects to /login?next=… */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  return <>{children}</>;
}
