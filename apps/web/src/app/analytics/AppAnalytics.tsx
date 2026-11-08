// Mounted once inside the router and the session: reports each page (redacted, ./bridge.ts),
// settles a sign-in that went through a provider's pages, and tells the bridge who is signed in
// (a browser's opt-out is recorded on their account).
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { noteSignedIn, reportPage, settleProviderSignIn, startAppAnalytics } from './bridge';

export function AppAnalytics() {
  const { pathname, search } = useLocation();
  const { user, loading } = useAuth();
  useEffect(() => startAppAnalytics(), []);
  useEffect(() => reportPage(pathname, search), [pathname, search]);
  useEffect(() => {
    if (!loading) settleProviderSignIn(user);
  }, [loading, user]);
  useEffect(() => {
    if (!loading) noteSignedIn(user?.id ?? null);
  }, [loading, user?.id]);
  return null;
}
