import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ToastProvider } from '@ui';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { GuestGate } from './board/GuestGate';
import { FullPageSpinner } from './components/FullPageSpinner';
import { LandingPage } from './pages/landing/LandingPage';
import { AuthPage } from './pages/auth/AuthPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/auth/PasswordPages';
import { EmailLinkPage } from './pages/auth/EmailLinkPage';
import { TwoFactorPage } from './pages/auth/TwoFactorPage';
import { InvitePage } from './pages/invite/InvitePage';
import { AccountSettingsPage } from './pages/account/AccountSettingsPage';
import { UnsubscribePage } from './pages/unsubscribe/UnsubscribePage';

// Owned by the board engine work; loaded on demand.
const BoardPage = lazy(() => import('./board/BoardPage'));

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/login/two-factor" element={<TwoFactorPage />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/revert-email" element={<ResetPasswordPage mode="revert" />} />
            <Route path="/verify-email" element={<EmailLinkPage mode="verify" />} />
            <Route path="/confirm-email" element={<EmailLinkPage mode="change" />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/workspace-invite/:token" element={<InvitePage kind="workspace" />} />
            <Route path="/unsubscribe" element={<UnsubscribePage />} />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <AccountSettingsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/app"
              element={
                <RequireAuth>
                  <DashboardPage />
                </RequireAuth>
              }
            />
            <Route path="/board/:id" element={<BoardRoute />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && !user.deletionScheduledFor) return <Navigate to="/app" replace />;
  if (user) return <RequireAuth>{null}</RequireAuth>;
  return <LandingPage />;
}

function BoardRoute() {
  const { id = '' } = useParams();
  const { user, loading } = useAuth();
  const board: ReactNode = (
    <Suspense fallback={<FullPageSpinner label="Opening board" />}>
      <BoardPage />
    </Suspense>
  );
  // The engine's offline sandbox needs no account in development.
  if (import.meta.env.DEV && id === 'local') return board;
  // Not signed in: a shared link may let visitors in as guests (else GuestGate sends them to sign in).
  if (!loading && !user) return <GuestGate boardId={id} />;
  return <RequireAuth>{board}</RequireAuth>;
}
