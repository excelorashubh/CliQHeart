import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { AppLayout } from './components/Layout.jsx';
import { ErrorState, PageSpinner } from './components/Feedback.jsx';
import {
  ProfessionalDashboardPage,
  ProfessionalOnboardingPage,
  ProfessionalPromotionsPage,
} from './pages/Professional.jsx';
import {
  HomePage, LoginPage, RegisterPage, SearchPage, ExplorePeoplePage, ProfilePage, MessagesPage,
  SettingsPage, CapabilityPage, CreatePage, ReelsPage, NotFoundPage, LandingPage, ContentDetailPage, NotificationsPage, StoryPage,
} from './pages.jsx';
import { HashtagPage } from './pages/HashtagPage.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageSpinner />;
  if (!user) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <AppLayout>{children}</AppLayout>;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  return user ? <Navigate to="/" replace /> : children;
}

function ProfessionalDashboardRoute() {
  const { user } = useAuth();
  if (user?.accountType !== 'CREATOR' && user?.accountType !== 'BUSINESS') {
    return <Navigate to="/professional/onboarding" replace />;
  }
  return user.professionalOnboardingCompletedAt
    ? <ProfessionalDashboardPage />
    : <ProfessionalOnboardingPage />;
}

function ProfessionalOnboardingRoute() {
  const { user } = useAuth();
  return user?.professionalOnboardingCompletedAt
    ? <Navigate to="/professional/dashboard" replace />
    : <ProfessionalOnboardingPage />;
}

function LegacyReelRedirect() {
  const { reelId } = useParams();
  return <Navigate to={reelId ? `/reels/${encodeURIComponent(reelId)}` : '/reels'} replace />;
}

export default function App() {
  const { user, loading, authError, authRetryAfterSeconds, refreshSession } = useAuth();
  if (loading) return <PageSpinner />;
  if (authError) {
    return <main className="page-content auth-restore-error">
      <h1>We couldn't verify your session.</h1>
      <p>Your saved sign-in has not been discarded. The page will continue after session verification succeeds.</p>
      <ErrorState
        error={authError}
        onRetry={() => refreshSession().catch(() => {})}
        retryDisabled={authRetryAfterSeconds > 0}
        retryLabel={authRetryAfterSeconds > 0 ? `Try again in ${authRetryAfterSeconds}s` : 'Try again'}
      />
    </main>;
  }
  return <Routes>
    <Route path="/" element={user ? <Protected><HomePage /></Protected> : <LandingPage />} />
    <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
    <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
    <Route path="/signup" element={<GuestOnly><RegisterPage /></GuestOnly>} />
    <Route path="/search" element={<Protected><SearchPage /></Protected>} />
    <Route path="/explore/tags/:tag" element={<Protected><HashtagPage /></Protected>} />
    <Route path="/explore/people/" element={<Protected><ExplorePeoplePage /></Protected>} />
    <Route path="/discover" element={<Navigate to="/search" replace />} />
    <Route path="/explore" element={<Navigate to="/search" replace />} />
    <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
    <Route path="/profile/edit" element={<Protected><ProfilePage editOnOpen /></Protected>} />
    <Route path="/profile/:userId" element={<Protected><ProfilePage /></Protected>} />
    <Route path="/messages" element={<Protected><MessagesPage /></Protected>} />
    <Route path="/messages/:conversationId/details" element={<Protected><MessagesPage /></Protected>} />
    <Route path="/messages/:conversationId" element={<Protected><MessagesPage /></Protected>} />
    <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
    <Route path="/professional" element={<Protected><Navigate to="/professional/dashboard" replace /></Protected>} />
    <Route path="/professional/dashboard" element={<Protected><ProfessionalDashboardRoute /></Protected>} />
    <Route path="/professional/onboarding" element={<Protected><ProfessionalOnboardingRoute /></Protected>} />
    <Route path="/professional/promotions" element={<Protected><ProfessionalPromotionsPage /></Protected>} />
    <Route path="/create" element={<Protected><CreatePage /></Protected>} />
    <Route path="/reels" element={<Protected><ReelsPage /></Protected>} />
    <Route path="/reels/:reelId" element={<Protected><ReelsPage /></Protected>} />
    <Route path="/notifications" element={<Protected><NotificationsPage /></Protected>} />
    <Route path="/post/:postId" element={<Protected><ContentDetailPage kind="post" /></Protected>} />
    <Route path="/reel/:reelId" element={<LegacyReelRedirect />} />
    <Route path="/story/:storyId" element={<Protected><StoryPage /></Protected>} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
