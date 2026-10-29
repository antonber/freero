import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ToastProvider } from '@ui';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { GuestGate } from './board/GuestGate';
import { FullPageSpinner } from './components/FullPageSpinner';
import { AppUpdates } from './pwa/AppUpdates';
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
import { AdminConsolePage } from './pages/admin/AdminConsolePage';
import { AppealPage } from './pages/appeal/AppealPage';
import { OperatorPage } from './pages/operator/OperatorPage';
import { OAuthConsentPage } from './pages/oauth/OAuthConsentPage';
import { SharePage } from './pages/share/SharePage';

// Owned by the board engine work; loaded on demand.
const BoardPage = lazy(() => import('./board/BoardPage'));
// The operator's read-only board preview mounts the board engine too.
const OperatorPreviewPage = lazy(() => import('./pages/operator/OperatorPreviewPage'));
// A frozen decision (KAI-161) renders with the board engine too.
const DecisionPage = lazy(() => import('./pages/decision/DecisionPage'));
// A live board view inside an AI assistant (MCP Apps, KAI-171).
const EmbedBoardPage = lazy(() => import('./embed/EmbedBoardPage'));
// Docs (KAI-162): the page and its editor load on demand.
const DocPage = lazy(() => import('./pages/doc/DocPage'));

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <AppUpdates />
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/login/two-factor" element={<TwoFactorPage />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/revert-email" element={<ResetPasswordPage mode="revert" />} />
            <Route path="/undo-two-factor" element={<ResetPasswordPage mode="undo" />} />
            <Route path="/recover-two-factor" element={<ResetPasswordPage mode="recover" />} />
            <Route path="/cancel-recovery" element={<EmailLinkPage mode="cancelRecovery" />} />
            <Route path="/verify-email" element={<EmailLinkPage mode="verify" />} />
            <Route path="/confirm-email" element={<EmailLinkPage mode="change" />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/workspace-invite/:token" element={<InvitePage kind="workspace" />} />
            <Route path="/unsubscribe" element={<UnsubscribePage />} />
            {/* Moderation notices link here; works signed out (a suspended account appeals too). */}
            <Route path="/appeal" element={<AppealPage />} />
            <Route
              path="/operator"
              element={
                <RequireAuth>
                  <OperatorPage />
                </RequireAuth>
              }
            />
            <Route
              path="/operator/boards/:id/preview"
              element={
                <RequireAuth>
                  <Suspense fallback={<FullPageSpinner label="Opening board" />}>
                    <OperatorPreviewPage />
                  </Suspense>
                </RequireAuth>
              }
            />
            {/* OAuth apps (and MCP clients) send people here to connect; signed out: log in first, then back. */}
            <Route
              path="/oauth/authorize"
              element={
                <RequireAuth>
                  <OAuthConsentPage />
                </RequireAuth>
              }
            />
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
            {/* The installed app's share target (KAI-218): the server stored the images and sent the browser here. */}
            <Route
              path="/share"
              element={
                <RequireAuth>
                  <SharePage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/:workspaceId"
              element={
                <RequireAuth>
                  <AdminConsolePage />
                </RequireAuth>
              }
            />
            <Route
              path="/decision/:id"
              element={
                <RequireAuth>
                  <Suspense fallback={<FullPageSpinner label="Opening the decision" />}>
                    <DecisionPage />
                  </Suspense>
                </RequireAuth>
              }
            />
            <Route path="/board/:id" element={<BoardRoute />} />
            <Route
              path="/embed/board/:id"
              element={
                <Suspense fallback={<FullPageSpinner label="Opening board" />}>
                  <EmbedBoardPage />
                </Suspense>
              }
            />
            <Route
              path="/doc/:id"
              element={
                <RequireAuth>
                  <Suspense fallback={<FullPageSpinner label="Opening doc" />}>
                    <DocPage />
                  </Suspense>
                </RequireAuth>
              }
            />
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
