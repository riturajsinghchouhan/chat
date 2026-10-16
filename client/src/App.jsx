import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './store/authStore';
import { applyTheme, useUI } from './store/uiStore';
import { FullPageLoader } from './components/LoadingSkeleton';
import ConfirmDialog from './components/ConfirmDialog';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './pages/LoginPage';
import ChatLayout from './pages/ChatLayout';
import HomePage from './pages/HomePage';
import ChatPage from './pages/ChatPage';

const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const SharedMediaPage = lazy(() => import('./pages/SharedMediaPage'));
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'));
const EditProfilePage = lazy(() => import('./pages/EditProfilePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const BlockedUsersPage = lazy(() => import('./pages/BlockedUsersPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function RequireAuth({ children }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (status !== 'authed') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function GuestOnly({ children }) {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authed') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const init = useAuth((s) => s.init);
  const theme = useUI((s) => s.theme);

  useEffect(() => {
    init();
  }, [init]);

  // Follow OS theme changes when "system" is selected.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  return (
    <ErrorBoundary>
      <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
        <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <ChatLayout />
            </RequireAuth>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="c/:conversationId" element={<ChatPage />} />
          <Route path="c/:conversationId/media" element={<SharedMediaPage />} />
          <Route path="u/:userId" element={<UserProfilePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/profile" element={<EditProfilePage />} />
          <Route path="settings/blocked" element={<BlockedUsersPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      <ConfirmDialog />
      <Toaster
        position="top-center"
        toastOptions={{
          style: { background: 'var(--raised)', color: 'var(--fg)', borderRadius: '16px', boxShadow: '6px 6px 16px var(--sh-dark)' },
          success: { iconTheme: { primary: 'var(--success)', secondary: 'var(--raised)' } },
          error: { iconTheme: { primary: 'var(--accent)', secondary: 'var(--raised)' } },
        }}
      />
    </ErrorBoundary>
  );
}
