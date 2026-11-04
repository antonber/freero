import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ToastProvider } from '@ui';
import { AppAnalytics } from './analytics/AppAnalytics';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { GuestGate } from './board/GuestGate';
import { FrameGuard } from './embed/FrameGuard';
import { FullPageSpinner } from './components/FullPageSpinner';
import { AppUpdates } from './pwa/AppUpdates';
import { AuthPage } from './pages/auth/AuthPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/auth/PasswordPages';
import { EmailLinkPage } from './pages/auth/EmailLinkPage';
import { TwoFactorPage } from './pages/auth/TwoFactorPage';
import { InvitePage } from './pages/invite/InvitePage';
import { AccountSettingsPage } from './pages/account/AccountSettingsPage';
import { ConnectAgentPage } from './pages/connect/ConnectAgentPage';
import { AppsPage, IntegrationPage } from './pages/apps/AppsPage';
import { CommunityListingPage, SubmitListingPage } from './pages/apps/CommunityPages';
import { UnsubscribePage } from './pages/unsubscribe/UnsubscribePage';
import { AdminConsolePage } from './pages/admin/AdminConsolePage';
import { OrgConsolePage } from './pages/admin/OrgConsolePage';
import { AppealPage } from './pages/appeal/AppealPage';
import { OperatorPage } from './pages/operator/OperatorPage';
import { OAuthConsentPage } from './pages/oauth/OAuthConsentPage';
import { SharePage } from './pages/share/SharePage';
import { ProblemReportProvider } from './problems/ProblemReport';

import { t } from './messages';
// Owned by the board engine work; loaded on demand.
const BoardPage = lazy(() => import('./board/BoardPage'));
// The operator's read-only board preview mounts the board engine too.
const OperatorPreviewPage = lazy(() => import('./pages/operator/OperatorPreviewPage'));
// A frozen decision (KAI-161) renders with the board engine too.
const DecisionPage = lazy(() => import('./pages/decision/DecisionPage'));
// A live board view inside an AI assistant (MCP Apps, KAI-171).
const EmbedBoardPage = lazy(() => import('./embed/EmbedBoardPage'));
// A board embedded live on another site (#2), its sign-in popup and the tab that signs in for it.
const PublicEmbedPage = lazy(() => import('./embed/PublicEmbedPage'));
const EmbedConnectPage = lazy(() => import('./embed/EmbedConnectPage'));
const EmbedSignedInPage = lazy(() => import('./embed/EmbedSignedInPage'));
// The Microsoft Teams app (#112): the tab (a board's embed inside Teams), its configuration page and the board chooser.
const TeamsTabPage = lazy(() => import('./teams/TeamsTabPage'));
const TeamsConfigPage = lazy(() => import('./teams/TeamsConfigPage'));
const TeamsChoosePage = lazy(() => import('./teams/TeamsChoosePage'));
// Apps on other platforms (#166–#169): Confluence and Jira, Zoom, Google Meet, and the board chooser window.
const AtlassianBoardPage = lazy(() => import('./hosts/AtlassianBoardPage'));
const EmbedChoosePage = lazy(() => import('./hosts/EmbedChoosePage'));
const ZoomHomePage = lazy(() => import('./hosts/zoom/ZoomHomePage'));
const ZoomBoardPage = lazy(() => import('./hosts/zoom/ZoomBoardPage'));
const ZoomInstalledPage = lazy(() => import('./hosts/zoom/ZoomInstalledPage'));
const MeetSidePanelPage = lazy(() => import('./hosts/meet/MeetSidePanelPage'));
const MeetStagePage = lazy(() => import('./hosts/meet/MeetStagePage'));
// Docs (KAI-162): the page and its editor load on demand.
const DocPage = lazy(() => import('./pages/doc/DocPage'));
// The phone answer page of a live activity (#40): no board engine, just the activity's REST.
const RespondPage = lazy(() => import('./pages/respond/RespondPage').then((m) => ({ default: m.RespondPage })));

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <AppUpdates />
        <AuthProvider>
          {/* Google Analytics where the server has it on (GA_MEASUREMENT_ID): consent first, redacted pages. */}
          <AppAnalytics />
          {/* "Report a problem": its dialog and shortcut, for every signed-in page. */}
          <ProblemReportProvider>
          <FrameGuard>
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
                  <Suspense fallback={<FullPageSpinner label={t('openingBoard')} />}>
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
            {/* Connect an agent (#80): every MCP client's setup with this server's address; the site's /claude, /chatgpt, /agents link here. */}
            <Route
              path="/settings/connect"
              element={
                <RequireAuth>
                  <ConnectAgentPage />
                </RequireAuth>
              }
            />
            {/* Apps & agents (#87): the catalog of everything that connects, each entry's connect step, and community listings. */}
            <Route
              path="/apps"
              element={
                <RequireAuth>
                  <AppsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/apps/submit"
              element={
                <RequireAuth>
                  <SubmitListingPage />
                </RequireAuth>
              }
            />
            <Route
              path="/apps/community/:id"
              element={
                <RequireAuth>
                  <CommunityListingPage />
                </RequireAuth>
              }
            />
            <Route
              path="/apps/:id"
              element={
                <RequireAuth>
                  <IntegrationPage />
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
              path="/org/:organisationId"
              element={
                <RequireAuth>
                  <OrgConsolePage />
                </RequireAuth>
              }
            />
            <Route
              path="/decision/:id"
              element={
                <RequireAuth>
                  <Suspense fallback={<FullPageSpinner label={t('openingTheDecision')} />}>
                    <DecisionPage />
                  </Suspense>
                </RequireAuth>
              }
            />
            <Route path="/board/:id" element={<BoardRoute />} />
            {/* Answering a live activity on a phone, without the board (#40). */}
            <Route
              path="/respond/:boardId/:activityId"
              element={
                <Suspense fallback={<FullPageSpinner label={t('openingTheActivity')} />}>
                  <RespondPage />
                </Suspense>
              }
            />
            <Route
              path="/embed/board/:id"
              element={
                <Suspense fallback={<FullPageSpinner label={t('openingBoard')} />}>
                  <EmbedBoardPage />
                </Suspense>
              }
            />
            <Route
              path="/doc/:id"
              element={
                <RequireAuth>
                  <Suspense fallback={<FullPageSpinner label={t('openingDoc')} />}>
                    <DocPage />
                  </Suspense>
                </RequireAuth>
              }
            />
            <Route
              path="/embed/b/:id"
              element={
                <Suspense fallback={<FullPageSpinner label={t('openingBoard')} />}>
                  <PublicEmbedPage />
                </Suspense>
              }
            />
            <Route
              path="/embed/connect/:id"
              element={
                <Suspense fallback={<FullPageSpinner label={t('signingIn')} />}>
                  <EmbedConnectPage />
                </Suspense>
              }
            />
            <Route
              path="/embed/signed-in"
              element={
                <Suspense fallback={<FullPageSpinner label={t('signingIn')} />}>
                  <EmbedSignedInPage />
                </Suspense>
              }
            />
            <Route
              path="/teams/b/:id"
              element={
                <Suspense fallback={<FullPageSpinner label={t('openingBoard')} />}>
                  <TeamsTabPage />
                </Suspense>
              }
            />
            <Route
              path="/teams/config"
              element={
                <Suspense fallback={<FullPageSpinner label={t('connectingToTeams')} />}>
                  <TeamsConfigPage />
                </Suspense>
              }
            />
            <Route
              path="/teams/choose"
              element={
                <Suspense fallback={<FullPageSpinner label={t('connectingToTeams')} />}>
                  <TeamsChoosePage />
                </Suspense>
              }
            />
            {(
              [
                ['/atlassian/b/:id', AtlassianBoardPage],
                ['/embed/choose', EmbedChoosePage],
                ['/zoom/home', ZoomHomePage],
                ['/zoom/b/:id', ZoomBoardPage],
                ['/zoom/installed', ZoomInstalledPage],
                ['/meet/sidepanel', MeetSidePanelPage],
                ['/meet/stage/:id', MeetStagePage],
              ] as const
            ).map(([path, Page]) => (
              <Route
                key={path}
                path={path}
                element={
                  <Suspense fallback={<FullPageSpinner label={t('openingBoard')} />}>
                    <Page />
                  </Suspense>
                }
              />
            ))}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </FrameGuard>
          </ProblemReportProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

/**
 * `/` is the server's (modules/site): the marketing site, or your boards when signed in. The app
 * only gets here without a server in front (Vite in development): signed in → /app, else sign in.
 */
function Home() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && !user.deletionScheduledFor) return <Navigate to="/app" replace />;
  if (user) return <RequireAuth>{null}</RequireAuth>;
  return <Navigate to="/login" replace />;
}

function BoardRoute() {
  const { id = '' } = useParams();
  const { user, loading } = useAuth();
  const board: ReactNode = (
    <Suspense fallback={<FullPageSpinner label={t('openingBoard')} />}>
      <BoardPage />
    </Suspense>
  );
  // The engine's offline sandbox needs no account in development.
  if (import.meta.env.DEV && id === 'local') return board;
  // Not signed in: a shared link may let visitors in as guests (else GuestGate sends them to sign in).
  if (!loading && !user) return <GuestGate boardId={id} />;
  return <RequireAuth>{board}</RequireAuth>;
}
