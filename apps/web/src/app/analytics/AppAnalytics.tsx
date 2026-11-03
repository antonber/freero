// Mounted once inside the router and the session: reports each page (redacted, ./bridge.ts) and
// settles a sign-in that went through a provider's pages.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { reportPage, settleProviderSignIn, startAppAnalytics } from './bridge';

export function AppAnalytics() {
  const { pathname, search } = useLocation();
  const { user, loading } = useAuth();
  useEffect(() => startAppAnalytics(), []);
  useEffect(() => reportPage(pathname, search), [pathname, search]);
  useEffect(() => {
    if (!loading) settleProviderSignIn(user);
  }, [loading, user]);
  return null;
}
