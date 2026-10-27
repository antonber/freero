import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ToastProvider } from '@ui';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { FullPageSpinner } from './components/FullPageSpinner';
import { LandingPage } from './pages/landing/LandingPage';
import { AuthPage } from './pages/auth/AuthPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Owned by the board engine work; loaded on demand.
const BoardPage = lazy(() => import('./board/BoardPage'));

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
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
  if (user) return <Navigate to="/app" replace />;
  return <LandingPage />;
}

function BoardRoute() {
  const { id } = useParams();
  const board: ReactNode = (
    <Suspense fallback={<FullPageSpinner label="Opening board" />}>
      <BoardPage />
    </Suspense>
  );
  // The engine's offline sandbox needs no account in development.
  if (import.meta.env.DEV && id === 'local') return board;
  return <RequireAuth>{board}</RequireAuth>;
}
