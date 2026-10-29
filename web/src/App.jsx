import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { AppLayout } from './components/Layout.jsx';
import { ErrorState, PageSpinner } from './components/Feedback.jsx';
import {
  HomePage, LoginPage, RegisterPage, SearchPage, ProfilePage, MessagesPage,
  SettingsPage, CapabilityPage, NotFoundPage, LandingPage,
} from './pages.jsx';

function Protected({ children }) {
  const { user, loading, authError, refreshSession } = useAuth();
  const location = useLocation();
  if (loading) return <PageSpinner />;
  if (authError) {
    return <main className="page-content auth-restore-error">
      <h1>We couldn't verify your session.</h1>
      <p>Your saved sign-in has not been discarded. Check your connection and try again.</p>
      <ErrorState error={authError} onRetry={() => refreshSession().catch(() => {})} />
    </main>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppLayout>{children}</AppLayout>;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  return <Routes>
    <Route path="/" element={user ? <Protected><HomePage /></Protected> : <LandingPage />} />
    <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
    <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
    <Route path="/signup" element={<GuestOnly><RegisterPage /></GuestOnly>} />
    <Route path="/search" element={<Protected><SearchPage /></Protected>} />
    <Route path="/discover" element={<Navigate to="/search" replace />} />
    <Route path="/explore" element={<Navigate to="/search" replace />} />
    <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
    <Route path="/profile/edit" element={<Protected><ProfilePage editOnOpen /></Protected>} />
    <Route path="/profile/:userId" element={<Protected><ProfilePage /></Protected>} />
    <Route path="/messages" element={<Protected><MessagesPage /></Protected>} />
    <Route path="/messages/:conversationId" element={<Protected><MessagesPage /></Protected>} />
    <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
    <Route path="/create" element={<Protected><CapabilityPage title="Create a post" feature="Post and media publishing" /></Protected>} />
    <Route path="/reels" element={<Protected><CapabilityPage title="Reels" feature="Reels and video playback" /></Protected>} />
    <Route path="/notifications" element={<Protected><CapabilityPage title="Notifications" feature="Activity notifications" /></Protected>} />
    <Route path="/post/:postId" element={<Protected><CapabilityPage title="Post" feature="Post details and engagement" /></Protected>} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
