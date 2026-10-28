import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { loginPath } from '../lib/nav';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { RestoreAccountPage } from '../pages/account/RestoreAccountPage';

/**
 * Renders children for signed-in users; otherwise redirects to /login?next=… An account in its
 * deletion grace period sees only the restore page (the server refuses everything else).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  if (user.deletionScheduledFor) return <RestoreAccountPage />;
  return <>{children}</>;
}
