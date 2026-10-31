import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Bell, Bookmark, Camera, CheckCircle2, Clapperboard, Compass, Download, Eye, EyeOff, Grid3X3, Heart, PlusSquare,
  LockKeyhole, MessageCircle, Search, ShieldCheck, Sparkles, Trash2, Upload, UserRound,
  Share2, XCircle,
} from 'lucide-react';
import { FaAndroid } from 'react-icons/fa';
import { useAuth } from './context/AuthContext.jsx';
import { Avatar, Brand } from './components/Brand.jsx';
import { EmptyState, ErrorState, RetryButton, Skeleton } from './components/Feedback.jsx';
import { ContentFeed, StoryFeed } from './components/Content.jsx';
import { EngagementActions } from './components/EngagementActions.jsx';
import { HashtagComposer } from './components/HashtagComposer.jsx';
import { HashtagText } from './components/HashtagText.jsx';
import { MediaUploader } from './components/MediaUploader.jsx';
import { ReelsExperience } from './components/ReelsExperience.jsx';
import { authApi, contentApi, mediaApi, messageApi, notificationApi, userApi } from './services/api.js';
import { MessageWorkspace } from './components/Messages.jsx';
import { getReelPath } from './services/reelUrl.js';

const reservedRegisterUsernames = new Set(['admin', 'root', 'support', 'staff', 'system', 'cliqheart']);
function getAndroidAppDownloadUrl() {
  const configuredUrl = import.meta.env.VITE_ANDROID_APP_DOWNLOAD_URL?.trim();
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isValidRegisterUsername(username) {
  return username.length >= 3 && username.length <= 30 &&
    /^[a-z0-9._]+$/.test(username) && !username.startsWith('.') &&
    !username.endsWith('.') && !username.includes('..');
}

function suggestionReasonLabel(person) {
  const names = person.mutualUsernames || [];
  if (!person.mutualCount || names.length === 0) return 'Suggested for you';
  return person.mutualCount === 1
    ? `Followed by ${names[0]}`
    : `Followed by ${names[0]} and others`;
}

function useRateLimitCooldown() {
  const [retryAt, setRetryAt] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const blockForError = useCallback((error) => {
    if (error?.status === 429 && Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds > 0) {
      setRetryAt(Date.now() + error.retryAfterSeconds * 1000);
    }
  }, []);

  useEffect(() => {
    if (!retryAt) return undefined;
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) setRetryAt(0);
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  return { remainingSeconds, blockForError };
}

export function LandingPage() {
  const androidAppDownloadUrl = getAndroidAppDownloadUrl();
  return <main className="landing">
    <nav className="landing-nav"><Link to="/"><Brand /></Link><div><Link className="landing-login" to="/login">Log in</Link><Link className="button button--primary" to="/register">Join CliQHeart <ArrowRight size={16} /></Link></div></nav>
    <section className="landing-hero">
      <div className="hero-copy">
        <p className="eyebrow"><span className="eyebrow-dot" /> MADE FOR YOUR PEOPLE</p>
        <h1>Closer feels<br />like <em>CliQHeart.</em></h1>
        <p className="hero-description">A thoughtful place to find your people, catch up, and keep the conversations going.</p>
        <div className="hero-actions">
          <Link className="button button--primary button--large" to="/signup">Get started <ArrowRight size={17} /></Link>
          <Link className="text-link" to="/login">I already have an account <ArrowUpRight size={16} /></Link>
          {androidAppDownloadUrl ? (
            <a
              className="button button--outline button--large hero-download-button"
              href={androidAppDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Download CliQHeart Android app"
            >
              <FaAndroid size={19} aria-hidden="true" />
              Download Android App
              <Download size={16} aria-hidden="true" />
            </a>
          ) : (
            <button
              className="button button--outline button--large hero-download-button"
              type="button"
              disabled
              aria-describedby="android-download-status"
            >
              <FaAndroid size={19} aria-hidden="true" />
              Download Android App
              <Download size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        {!androidAppDownloadUrl && (
          <p id="android-download-status" className="hero-download-status" role="status">
            Android download will be available when a signed production app is published.
          </p>
        )}
        <div className="hero-note"><ShieldCheck size={17} /><span>One account, shared with the CliQHeart Android app.</span></div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="hero-circle circle-one" /><div className="hero-circle circle-two" />
        <div className="hero-heart"><Heart size={100} fill="currentColor" strokeWidth={1.2} /></div>
        <div className="float-card float-card--top"><span className="mini-avatar mini-avatar--coral">C</span><span><b>Closer, together</b><small>Your people are one hello away</small></span><Heart size={17} fill="currentColor" /></div>
        <div className="float-card float-card--bottom"><span className="float-heart"><Heart size={18} fill="currentColor" /></span><span><b>A little more connection</b><small>makes a lovely difference.</small></span></div>
        <span className="visual-spark spark-a">✦</span><span className="visual-spark spark-b">✧</span>
      </div>
    </section>
    <section className="landing-foot"><span>YOUR SPACE, YOUR PEOPLE</span><span>Thoughtful connection, built on CliQHeart.</span></section>
  </main>;
}

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { remainingSeconds, blockForError } = useRateLimitCooldown();
  const created = new URLSearchParams(location.search).get('created');
  const logoutWarning = location.state?.logoutWarning;

  async function submit(event) {
    event.preventDefault();
    if (busy || remainingSeconds > 0) return;
    setError('');
    setBusy(true);
    try {
      await signIn(identifier, password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (reason) {
      setError(reason.message || 'Could not sign in.');
      blockForError(reason);
      setBusy(false);
    }
  }

  return <AuthLayout>
    <p className="auth-eyebrow"><LockKeyhole size={14} /> YOUR PEOPLE ARE HERE</p>
    <h1>Welcome back.</h1>
    <p className="auth-description">Sign in with the same CliQHeart account you use on Android.</p>
    {created && <p className="form-success" role="status">Account created. Sign in to continue.</p>}
    {logoutWarning && <p className="form-error" role="alert">You have been signed out on this device, but the server could not confirm revocation. Keep this browser online and retry logout before sharing it. {logoutWarning}</p>}
    <form className="form-stack" onSubmit={submit}>
      <label>Email or username<input autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></label>
      <label>Password<span className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button--primary button--wide" disabled={busy || remainingSeconds > 0}>{busy ? 'Signing in…' : remainingSeconds > 0 ? `Try again in ${remainingSeconds}s` : 'Sign in'} <ArrowRight size={17} /></button>
    </form>
    <p className="auth-switch">New to CliQHeart? <Link to="/register">Create an account</Link></p>
    <p className="auth-privacy">Your password is sent only to the CliQHeart API and is never saved in this browser.</p>
  </AuthLayout>;
}

export function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const { remainingSeconds, blockForError } = useRateLimitCooldown();
  const [usernameAvailability, setUsernameAvailability] = useState({ username: '', status: 'empty' });
  const usernameInputRef = useRef(null);
  const usernameTimerRef = useRef(null);
  const usernameRequestRef = useRef(null);
  const usernameSequenceRef = useRef(0);
  const usernameResultRef = useRef(null);
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const normalizedUsername = form.username.trim().toLowerCase();

  const checkUsername = useCallback(async (username) => {
    clearTimeout(usernameTimerRef.current);
    if (!isValidRegisterUsername(username) || reservedRegisterUsernames.has(username)) {
      const status = username ? 'invalid' : 'empty';
      setUsernameAvailability({ username, status });
      return { available: false, status };
    }
    if (usernameResultRef.current?.username === username &&
        usernameResultRef.current.result.status !== 'error') {
      return usernameResultRef.current.result;
    }
    usernameRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = ++usernameSequenceRef.current;
    usernameRequestRef.current = { controller, requestId };
    setUsernameAvailability({ username, status: 'checking' });
    const result = await authApi.usernameAvailability(username, { signal: controller.signal })
      .then((response) => ({ available: response.available, status: response.available ? 'available' : 'taken' }))
      .catch((reason) => {
        if (reason?.name === 'AbortError') return { available: false, status: 'stale' };
        blockForError(reason);
        return { available: false, status: 'error', error: reason };
      });
    if (requestId === usernameSequenceRef.current && !controller.signal.aborted) {
      if (result.status !== 'error') usernameResultRef.current = { username, result };
      setUsernameAvailability({ username, status: result.status, error: result.error });
    }
    return result;
  }, [blockForError]);

  useEffect(() => {
    usernameResultRef.current = null;
    if (!normalizedUsername) {
      setUsernameAvailability({ username: '', status: 'empty' });
      return undefined;
    }
    if (!isValidRegisterUsername(normalizedUsername) || reservedRegisterUsernames.has(normalizedUsername)) {
      setUsernameAvailability({ username: normalizedUsername, status: 'invalid' });
      return undefined;
    }
    setUsernameAvailability({ username: normalizedUsername, status: 'checking' });
    usernameTimerRef.current = setTimeout(() => {
      void checkUsername(normalizedUsername);
    }, 450);
    return () => {
      clearTimeout(usernameTimerRef.current);
      if (usernameRequestRef.current) {
        usernameRequestRef.current.controller.abort();
        usernameSequenceRef.current += 1;
      }
    };
  }, [normalizedUsername, checkUsername]);

  useEffect(() => () => {
    clearTimeout(usernameTimerRef.current);
    usernameRequestRef.current?.controller.abort();
  }, []);

  function changeUsername(event) {
    usernameResultRef.current = null;
    setFieldErrors((current) => ({ ...current, username: undefined }));
    setError('');
    setForm((current) => ({ ...current, username: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || remainingSeconds > 0) return;
    setError('');
    const validation = {};
    const username = normalizedUsername;
    const validUsername = isValidRegisterUsername(username);
    if (!form.displayName.trim() || form.displayName.trim().length > 80) {
      validation.displayName = 'Enter a display name of up to 80 characters.';
    }
    if (!validUsername) {
      validation.username = 'Use 3–30 letters, numbers, periods, or underscores. Do not start/end with a period or repeat periods.';
    } else if (reservedRegisterUsernames.has(username)) {
      validation.username = 'This username is reserved.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) || form.email.trim().length > 254) {
      validation.email = 'Enter a valid email address.';
    }
    if (form.password.length < 8 || form.password.length > 128 ||
        !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
      validation.password = 'Use 8–128 characters with at least one letter and one number.';
    }
    if (form.password !== form.confirmPassword) {
      validation.confirmPassword = 'Passwords do not match.';
    }
    if (!terms) validation.agreeToTerms = 'You must agree to the terms and privacy policy.';
    setFieldErrors(validation);
    if (Object.keys(validation).length > 0) {
      setError('Please correct the highlighted fields.');
      if (validation.username) usernameInputRef.current?.focus();
      return;
    }
    setBusy(true);
    const availability = await checkUsername(username);
    if (availability.status !== 'available' || !availability.available) {
      const message = availability.status === 'taken'
        ? 'Username already exists'
        : availability.status === 'error'
          ? availability.error?.message || 'Unable to check username. Please try again.'
          : 'Checking username availability...';
      setUsernameAvailability({ username, status: availability.status });
      setFieldErrors((current) => ({ ...current, username: message }));
      usernameInputRef.current?.focus();
      setBusy(false);
      return;
    }
    try {
      await signUp({
        ...form,
        displayName: form.displayName.trim(),
        username,
        email: form.email.trim().toLowerCase(),
        agreeToTerms: terms,
      });
      navigate(location.state?.from || '/', { replace: true });
    } catch (reason) {
      blockForError(reason);
      if (reason.field === 'username' || reason.message === 'Username already exists') {
        usernameResultRef.current = { username, result: { available: false, status: 'taken' } };
        setUsernameAvailability({ username, status: 'taken' });
        setFieldErrors((current) => ({ ...current, username: 'Username already exists' }));
        usernameInputRef.current?.focus();
      } else {
        setError(reason.message || 'Could not create your account.');
      }
      if (Array.isArray(reason.details)) {
        setFieldErrors(Object.fromEntries(reason.details
          .filter((item) => typeof item.field === 'string' && typeof item.message === 'string')
          .map((item) => [item.field, item.message])));
      }
      setBusy(false);
    }
  }
  return <AuthLayout register>
    <p className="auth-eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
    <h1>Find your people.</h1>
    <p className="auth-description">Create an account to connect across CliQHeart.</p>
    <form className="form-stack form-stack--register" onSubmit={submit}>
      <label>Display name<input autoComplete="name" maxLength="80" value={form.displayName} onChange={change('displayName')} required />{fieldErrors.displayName && <small className="field-error">{fieldErrors.displayName}</small>}</label>
      <label>Username<input ref={usernameInputRef} autoComplete="username" minLength="3" maxLength="30" value={form.username} onChange={changeUsername} required aria-invalid={Boolean(fieldErrors.username) || usernameAvailability.status === 'taken' || usernameAvailability.status === 'invalid'} aria-describedby="username-status" />
        <small id="username-status" className={`username-status username-status--${usernameAvailability.status}`} aria-live="polite">
          {usernameAvailability.status === 'empty' && 'Enter a username'}
          {usernameAvailability.status === 'checking' && 'Checking username availability...'}
          {usernameAvailability.status === 'available' && <><CheckCircle2 size={14} aria-hidden="true" /> Username available</>}
          {usernameAvailability.status === 'taken' && <><XCircle size={14} aria-hidden="true" /> Username already exists</>}
          {usernameAvailability.status === 'invalid' && 'Username format is invalid'}
          {usernameAvailability.status === 'error' && <>{usernameAvailability.error?.message || 'Unable to check username. Please try again.'} <button className="username-retry" type="button" aria-label="Retry username availability check" disabled={busy || remainingSeconds > 0} onClick={() => void checkUsername(normalizedUsername)}>{remainingSeconds > 0 ? `Retry in ${remainingSeconds}s` : 'Retry'}</button></>}
        </small>
        {fieldErrors.username && fieldErrors.username !== 'Username already exists' && fieldErrors.username !== 'Unable to check username. Please try again.' && <small className="field-error">{fieldErrors.username}</small>}
      </label>
      <label>Email<input type="email" autoComplete="email" maxLength="254" value={form.email} onChange={change('email')} required aria-invalid={Boolean(fieldErrors.email)} />{fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}</label>
      <div className="form-two-columns">
        <label>Password<span className="password-field"><input aria-label="Password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="8" maxLength="128" value={form.password} onChange={change('password')} required aria-invalid={Boolean(fieldErrors.password)} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{fieldErrors.password ? <small className="field-error">{fieldErrors.password}</small> : <small>At least 8 characters, including a letter and number.</small>}</label>
        <label>Confirm password<span className="password-field"><input aria-label="Confirm password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="8" maxLength="128" value={form.confirmPassword} onChange={change('confirmPassword')} required aria-invalid={Boolean(fieldErrors.confirmPassword)} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{fieldErrors.confirmPassword && <small className="field-error">{fieldErrors.confirmPassword}</small>}</label>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>I agree to the Terms of Service and Privacy Policy.{fieldErrors.agreeToTerms && <small className="field-error">{fieldErrors.agreeToTerms}</small>}</span></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button--primary button--wide" disabled={busy || !terms || remainingSeconds > 0}>{busy ? 'Creating account…' : remainingSeconds > 0 ? `Try again in ${remainingSeconds}s` : 'Create account'} <ArrowRight size={17} /></button>
    </form>
    <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
  </AuthLayout>;
}

function AuthLayout({ children, register = false }) {
  return <main className="auth-layout">
    <section className={`auth-panel${register ? ' auth-panel--register' : ''}`}>
      <Link to="/" className="auth-brand"><Brand /></Link>{children}
    </section>
    <aside className="auth-aside"><span className="auth-aside-orb orb-large" /><span className="auth-aside-orb orb-small" />
      <span className="auth-aside-heart"><Brand compact /></span>
      <p className="auth-quote">{register ? <>A small world<br />with a <em>big heart.</em></> : <>The best moments<br />are better <em>together.</em></>}</p>
      <p className="auth-aside-caption">Connection starts with a hello.</p>
    </aside>
  </main>;
}

export function HomePage() {
  const { user } = useAuth();
  return <div className="page-content home-page home-feed-page">
    <div className="home-feed-layout">
      <main className="home-content-column">
        <header className="home-feed-heading">
          <div><p className="eyebrow">YOUR COMMUNITY</p><h1>CliQHeart's</h1></div>
          <div className="home-feed-actions">
            <Link className="home-discover-link" to="/explore/people/"><Compass size={16} /> Discover people</Link>
            <Link className="button button--primary home-create-button" to="/create"><PlusSquare size={16} /> Create</Link>
          </div>
        </header>
        <StoryFeed />
        <section className="home-posts-section" aria-label="Latest posts">
          <div className="home-section-heading"><h2>For you</h2><span>Latest posts from CliQHeart</span></div>
          <ContentFeed showSuggestedLabels includeReels />
        </section>
      </main>
      <HomeSuggestions user={user} />
    </div>
  </div>;
}

function HomeSuggestions({ user }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [followBusy, setFollowBusy] = useState({});
  const [followError, setFollowError] = useState('');

  const loadSuggestions = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const result = await userApi.suggestions({ limit: 5, signal });
      if (!signal?.aborted) setUsers(result.users || []);
    } catch (reason) {
      if (!signal?.aborted && reason.name !== 'AbortError') {
        setError(reason.message || 'Could not load suggestions.');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadSuggestions(controller.signal);
    return () => controller.abort();
  }, [loadSuggestions]);

  async function followSuggestion(suggestion) {
    if (followBusy[suggestion.id]) return;
    setFollowBusy((current) => ({ ...current, [suggestion.id]: true }));
    setFollowError('');
    try {
      await userApi.follow(suggestion.id);
      setUsers((current) => current.filter((entry) => entry.id !== suggestion.id));
    } catch (reason) {
      setFollowError(reason.message || 'Could not follow this person.');
    } finally {
      setFollowBusy((current) => ({ ...current, [suggestion.id]: false }));
    }
  }

  return <aside className="home-right-rail" aria-label="Account suggestions">
    <div className="home-viewer-card">
      <Link to="/profile" className="home-viewer-profile">
        <Avatar name={user?.displayName} src={user?.avatarUrl} size="large" />
        <span><strong>@{user?.username}</strong><small>{user?.displayName}</small></span>
      </Link>
      <Link className="home-view-profile" to="/profile">View profile</Link>
    </div>
    <section className="home-suggestions">
      <header><h2>Suggested for you</h2><Link to="/explore/people/">See all</Link></header>
      {loading && <div className="home-suggestion-loading"><Skeleton rows={3} /></div>}
      {!loading && error && <div className="home-suggestion-error" role="alert">{error}<RetryButton error={error} onRetry={() => loadSuggestions()} className="text-link" /></div>}
      {!loading && !error && users.length === 0 && <p className="home-suggestion-empty">You're all caught up. Search for more people to follow.</p>}
      {!loading && !error && users.map((suggestion) => <article className="home-suggestion" key={suggestion.id}>
        <Link to={`/profile/${suggestion.id}`} className="home-suggestion-person">
          <Avatar name={suggestion.displayName} src={suggestion.avatarUrl} size="medium" />
          <span><strong>@{suggestion.username}</strong><small>{suggestionReasonLabel(suggestion)}</small></span>
        </Link>
        <button type="button" className="home-follow-button" disabled={followBusy[suggestion.id]} onClick={() => followSuggestion(suggestion)}>
          {followBusy[suggestion.id] ? '...' : 'Follow'}
        </button>
      </article>)}
      {followError && <p className="home-suggestion-error" role="alert">{followError}</p>}
    </section>
    <footer className="home-rail-footer">
      <Link to="/settings">Settings</Link><span>·</span><Link to="/notifications">Notifications</Link>
      <p>© {new Date().getFullYear()} CliQHeart</p>
    </footer>
  </aside>;
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [hashtagResults, setHashtagResults] = useState([]);
  const [hashtagError, setHashtagError] = useState('');
  const [resultsQuery, setResultsQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [followError, setFollowError] = useState('');
  const [followBusy, setFollowBusy] = useState({});
  const [nextCursor, setNextCursor] = useState(null);
  const [run, setRun] = useState(0);
  const searchVersion = useRef(0);
  const pageController = useRef(null);

  useEffect(() => {
    const term = query.trim();
    const version = ++searchVersion.current;
    pageController.current?.abort();
    setLoadingMore(false);
    if (term.length < 2) {
      setUsers([]);
      setHashtagResults([]);
      setHashtagError('');
      setResultsQuery('');
      setNextCursor(null);
      setError('');
      setFollowError('');
      setLoading(false);
      return undefined;
    }
    setResultsQuery('');
    setNextCursor(null);
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setHashtagError('');
    const timer = window.setTimeout(async () => {
      const hashtagQuery = term.replace(/^#/, '');
      contentApi.searchHashtags(hashtagQuery, { signal: controller.signal })
        .then((result) => {
          if (version === searchVersion.current) setHashtagResults(result.hashtags || []);
        })
        .catch((reason) => {
          if (reason.name !== 'AbortError' && version === searchVersion.current) {
            setHashtagError(reason.message || 'Could not search hashtags.');
          }
        });
      try {
        const result = await userApi.search(hashtagQuery, { signal: controller.signal });
        if (version === searchVersion.current) {
          setUsers(result.users || []);
          setResultsQuery(term);
          setNextCursor(result.nextCursor || null);
        }
      } catch (reason) {
        if (reason.name !== 'AbortError' && version === searchVersion.current) setError(reason.message || 'Could not search users.');
      } finally {
        if (!controller.signal.aborted && version === searchVersion.current) setLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      pageController.current?.abort();
    };
  }, [query, run]);

  async function loadMore() {
    const term = query.trim();
    if (!nextCursor || loadingMore || term.length < 2 || resultsQuery !== term) return;
    const version = searchVersion.current;
    const controller = new AbortController();
    pageController.current = controller;
    setLoadingMore(true);
    setError('');
    try {
      const result = await userApi.search(term, { after: nextCursor, signal: controller.signal });
      if (version === searchVersion.current && term === query.trim()) {
        setUsers((current) => {
          const known = new Set(current.map((person) => person.id));
          return [...current, ...(result.users || []).filter((person) => !known.has(person.id))];
        });
        setNextCursor(result.nextCursor || null);
      }
    } catch (reason) {
      if (reason.name !== 'AbortError' && version === searchVersion.current) setError(reason.message || 'Could not load more people.');
    } finally {
      if (pageController.current === controller) pageController.current = null;
      if (version === searchVersion.current) setLoadingMore(false);
    }
  }

  async function toggleFollow(person) {
    if (followBusy[person.id]) return;
    setFollowError('');
    setFollowBusy((current) => ({ ...current, [person.id]: true }));
    try {
      const result = person.isFollowing
        ? await userApi.unfollow(person.id)
        : await userApi.follow(person.id);
      setUsers((current) => current.map((item) => item.id === person.id ? { ...item, isFollowing: result.following } : item));
    } catch (reason) {
      setFollowError(reason.message || 'Could not update this follow.');
    } finally {
      setFollowBusy((current) => ({ ...current, [person.id]: false }));
    }
  }

  const term = query.trim();
  const showingResults = term.length >= 2 && resultsQuery === term;

  return <div className="page-content search-page">
    <header className="page-heading"><div><p className="eyebrow">FIND YOUR PEOPLE</p><h1>Search</h1><p className="heading-subtitle">Find people and explore CliQHeart.</p></div></header>
    <label className="search-field search-page-field">
      <Search size={19} aria-hidden="true" />
      <input type="search" autoFocus placeholder="Search by name or username…" value={query} onChange={(event) => {
        setQuery(event.target.value);
        setUsers([]);
        setHashtagResults([]);
        setResultsQuery('');
        setNextCursor(null);
        setError('');
        setFollowError('');
        setHashtagError('');
      }} aria-label="Search users by name or username" aria-controls="search-results" />
      {query && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => {
        setQuery('');
        setUsers([]);
        setHashtagResults([]);
        setResultsQuery('');
        setNextCursor(null);
        setError('');
        setFollowError('');
        setHashtagError('');
      }}>Clear</button>}
    </label>
    {term ? <>
      <div className="results-heading" id="search-results">
        {term.length >= 2 ? <span>People matching <strong>“{term}”</strong></span> : <span>Enter at least 2 characters to search.</span>}
      </div>
      {loading && <Skeleton rows={4} />}
      {!loading && error && <ErrorState error={error} onRetry={() => setRun((value) => value + 1)} />}
      {followError && <p className="inline-error" role="alert">{followError}</p>}
      {hashtagError && <p className="inline-error" role="alert">{hashtagError}</p>}
      {!loading && hashtagResults.length > 0 && <section className="search-hashtag-results" aria-label="Matching hashtags">
        <h2>Hashtags</h2>
        {hashtagResults.map((item) => <Link
          className="search-hashtag-result"
          key={item.normalizedName}
          to={`/explore/tags/${encodeURIComponent(item.normalizedName)}`}
        ><span>#{item.name}</span><small>{item.usageCount} {item.usageCount === 1 ? 'post' : 'posts'}</small></Link>)}
      </section>}
      {!loading && !error && term.length >= 2 && showingResults && users.length === 0 && <EmptyState title="No people found" description="Try another name or username." icon={Search} />}
      {!loading && showingResults && users.length > 0 && <div className="user-results">{users.map((person) => <article className="user-result" key={person.id}>
        <Link to={`/profile/${person.id}`} className="user-result-profile"><Avatar name={person.displayName} src={person.avatarUrl} size="large" /><span><b>{person.displayName}</b><small>@{person.username}</small>{person.bio && <small className="user-bio">{person.bio}</small>}</span></Link>
        <button className={`button ${person.isFollowing ? 'button--outline' : 'button--primary'}`} onClick={() => toggleFollow(person)} disabled={followBusy[person.id]}>{followBusy[person.id] ? '…' : person.isFollowing ? 'Following' : 'Follow'}</button>
      </article>)}</div>}
      {showingResults && nextCursor && <button className="button button--outline load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more people'}</button>}
    </> : <section className="explore-section" aria-labelledby="explore-heading">
      <div className="explore-heading"><div><p className="eyebrow">A LITTLE INSPIRATION</p><h2 id="explore-heading">Explore</h2></div></div>
      <div className="explore-content explore-media-content" aria-label="Explore media">
        <ContentFeed includeReels layout="explore" />
      </div>
    </section>}
  </div>;
}

export function ExplorePeoplePage() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [followError, setFollowError] = useState('');
  const [followBusy, setFollowBusy] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewProfile, setPreviewProfile] = useState(null);
  const [previewPosts, setPreviewPosts] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const closeTimer = useRef(null);
  const pageRequest = useRef(null);
  const busyIds = useRef(new Set());
  const previewCache = useRef(new Map());

  useEffect(() => {
    const controller = new AbortController();
    pageRequest.current?.abort();
    pageRequest.current = controller;
    setLoading(true);
    setError('');
    setNextCursor(null);
    setPeople([]);
    userApi.suggestions({ limit: 20, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setPeople(result.users || []);
          setNextCursor(result.nextCursor || null);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted && reason.name !== 'AbortError') {
          setError(reason.message || 'Could not load suggested people.');
        }
      })
      .finally(() => {
        if (pageRequest.current === controller) pageRequest.current = null;
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (pageRequest.current === controller) pageRequest.current = null;
    };
  }, [reloadKey]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!preview) return undefined;
    const cached = previewCache.current.get(preview.id);
    if (cached && cached.expiresAt > Date.now()) {
      setPreviewProfile(cached.profile);
      setPreviewPosts(cached.posts);
      setPreviewLoading(false);
      setPreviewError('');
      return undefined;
    }
    const controller = new AbortController();
    setPreviewProfile(null);
    setPreviewPosts([]);
    setPreviewLoading(true);
    setPreviewError('');
    Promise.all([
      userApi.profile(preview.id, { signal: controller.signal }),
      contentApi.userPosts(preview.id, 3, { signal: controller.signal }),
    ]).then(([profileResult, postsResult]) => {
      if (controller.signal.aborted) return;
      const profileData = profileResult.user;
      const posts = (postsResult.posts || []).filter((post) =>
        post.media?.resourceType === 'image' && post.media.secureUrl,
      ).slice(0, 3);
      previewCache.current.set(preview.id, {
        profile: profileData,
        posts,
        expiresAt: Date.now() + 30_000,
      });
      setPreviewProfile(profileData);
      setPreviewPosts(posts);
    }).catch((reason) => {
      if (!controller.signal.aborted && reason.name !== 'AbortError') {
        setPreviewError(reason.message || 'Could not load this profile preview.');
      }
    }).finally(() => {
      if (!controller.signal.aborted) setPreviewLoading(false);
    });
    return () => controller.abort();
  }, [preview?.id]);

  useEffect(() => {
    if (!preview) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setPreview(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [preview]);

  async function loadMore() {
    if (!nextCursor || loadingMore || pageRequest.current) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setLoadingMore(true);
    setMoreError('');
    try {
      const result = await userApi.suggestions({
        limit: 20,
        after: nextCursor,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setPeople((current) => {
          const known = new Set(current.map((person) => person.id));
          return [...current, ...(result.users || []).filter((person) => !known.has(person.id))];
        });
        setNextCursor(result.nextCursor || null);
      }
    } catch (reason) {
      if (!controller.signal.aborted && reason.name !== 'AbortError') {
        setMoreError(reason.message || 'Could not load more people.');
      }
    } finally {
      if (pageRequest.current === controller) pageRequest.current = null;
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  async function toggleFollow(person, following = person.isFollowing) {
    if (busyIds.current.has(person.id)) return;
    busyIds.current.add(person.id);
    setFollowBusy((current) => ({ ...current, [person.id]: true }));
    setFollowError('');
    try {
      const result = following
        ? await userApi.unfollow(person.id)
        : await userApi.follow(person.id);
      const cached = previewCache.current.get(person.id);
      const wasFollowing = cached?.profile.isFollowing ?? following;
      const followerCountDelta = result.following === wasFollowing
        ? 0
        : result.following ? 1 : -1;
      setPeople((current) => current.map((item) =>
        item.id === person.id ? { ...item, isFollowing: result.following } : item,
      ));
      setPreviewProfile((current) => current?.id === person.id
        ? {
          ...current,
          isFollowing: result.following,
          followersCount: Math.max(0, (current.followersCount || 0) + followerCountDelta),
        }
        : current,
      );
      if (cached) {
        cached.profile = {
          ...cached.profile,
          isFollowing: result.following,
          followersCount: Math.max(
            0,
            (cached.profile.followersCount || 0) + followerCountDelta,
          ),
        };
      }
      if (cached || preview?.id === person.id) {
        try {
          const refreshed = await userApi.profile(person.id);
          if (!refreshed.user) throw new Error('The API returned an incomplete profile.');
          previewCache.current.set(person.id, {
            profile: refreshed.user,
            posts: cached?.posts || [],
            expiresAt: Date.now() + 30_000,
          });
          setPreviewProfile((current) => current?.id === person.id ? refreshed.user : current);
        } catch (reason) {
          setFollowError(`Follow status was saved, but the latest profile counts could not be refreshed. ${reason.message || ''}`.trim());
        }
      }
    } catch (reason) {
      setFollowError(reason.message || 'Could not update this follow.');
    } finally {
      busyIds.current.delete(person.id);
      setFollowBusy((current) => ({ ...current, [person.id]: false }));
    }
  }

  function showPreview(person, target) {
    window.clearTimeout(closeTimer.current);
    const bounds = target.getBoundingClientRect();
    const width = 330;
    const height = 370;
    const gap = 12;
    let left = bounds.right + gap;
    if (left + width > window.innerWidth - 12) left = bounds.left - width - gap;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(bounds.top - 22, window.innerHeight - height - 12));
    setPreview({ id: person.id, person, left, top });
  }

  function scheduleClosePreview() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPreview(null), 160);
  }

  function keepPreviewOpen() {
    window.clearTimeout(closeTimer.current);
  }

  function previewFromPointer(person, event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    window.clearTimeout(closeTimer.current);
    const target = event.currentTarget;
    closeTimer.current = window.setTimeout(() => showPreview(person, target), 400);
  }

  const previewCard = preview && createPortal(
    <aside
      className="people-preview-card"
      role="dialog"
      aria-label={`Profile preview for @${preview.person.username}`}
      style={{ left: preview.left, top: preview.top }}
      onPointerEnter={keepPreviewOpen}
      onPointerLeave={scheduleClosePreview}
    >
      {previewLoading && <div className="people-preview-loading"><Skeleton rows={3} /></div>}
      {previewError && <p className="people-preview-error" role="alert">{previewError}</p>}
      {!previewLoading && previewProfile && <>
        <div className="people-preview-header">
          <Link to={`/profile/${previewProfile.id}`} onClick={() => setPreview(null)}>
            <Avatar name={previewProfile.displayName} src={previewProfile.avatarUrl} size="large" />
          </Link>
          <div className="people-preview-names">
            <Link to={`/profile/${previewProfile.id}`} onClick={() => setPreview(null)}>
              <strong>@{previewProfile.username}</strong>
            </Link>
            <span>{previewProfile.displayName}</span>
          </div>
        </div>
        <div className="people-preview-counts">
          <span><b>{previewProfile.postsCount || 0}</b> posts</span>
          <span><b>{previewProfile.followersCount || 0}</b> followers</span>
          <span><b>{previewProfile.followingCount || 0}</b> following</span>
        </div>
        {previewProfile.bio && <p className="people-preview-bio">{previewProfile.bio}</p>}
        {previewPosts.length > 0 && <div className="people-preview-posts" aria-label="Recent posts">
          {previewPosts.map((post) => <Link
            key={post.id}
            to={`/post/${post.id}`}
            aria-label={`Open post by @${previewProfile.username}`}
            onClick={() => setPreview(null)}
          >
            <img src={post.media.secureUrl} alt="" />
          </Link>)}
        </div>}
        <div className="people-preview-actions">
          <Link className="button button--outline" to={`/profile/${previewProfile.id}`} onClick={() => setPreview(null)}>View profile</Link>
          <button
            type="button"
            className={`button ${previewProfile.isFollowing ? 'button--outline' : 'button--primary'}`}
            disabled={Boolean(followBusy[previewProfile.id])}
            onClick={() => void toggleFollow(preview.person, previewProfile.isFollowing)}
          >
            {followBusy[previewProfile.id] ? '…' : previewProfile.isFollowing ? 'Following' : 'Follow'}
          </button>
        </div>
      </>}
    </aside>,
    document.body,
  );

  return <div className="page-content explore-people-page">
    <header className="page-heading explore-people-heading">
      <div><p className="eyebrow">FIND YOUR PEOPLE</p><h1>Discover people</h1><p className="heading-subtitle">Find people to connect with on CliQHeart.</p></div>
      <Sparkles className="explore-people-mark" size={27} aria-hidden="true" />
    </header>
    {followError && <p className="inline-error" role="alert">{followError}</p>}
    {loading && <div className="people-list-loading" aria-label="Loading suggested people"><Skeleton rows={7} /></div>}
    {!loading && error && <ErrorState error={error} onRetry={() => setReloadKey((value) => value + 1)} />}
    {!loading && !error && people.length === 0 && <EmptyState title="No suggestions right now" description="Try searching for people by name or username." icon={Compass} />}
    {!loading && !error && people.length > 0 && <section className="people-list" aria-label="Suggested people">
      {people.map((person) => <article className="people-row" key={person.id}>
        <div className="people-row-main">
          <Link
            to={`/profile/${person.id}`}
            className="people-row-avatar"
            aria-label={`View @${person.username}'s profile`}
            onPointerEnter={(event) => previewFromPointer(person, event)}
            onPointerLeave={scheduleClosePreview}
            onFocus={(event) => showPreview(person, event.currentTarget)}
            onBlur={scheduleClosePreview}
          >
            <Avatar name={person.displayName} src={person.avatarUrl} size="large" />
          </Link>
          <div className="people-row-copy">
            <Link
              to={`/profile/${person.id}`}
              className="people-row-username"
              onPointerEnter={(event) => previewFromPointer(person, event)}
              onPointerLeave={scheduleClosePreview}
              onFocus={(event) => showPreview(person, event.currentTarget)}
              onBlur={scheduleClosePreview}
            >@{person.username}</Link>
            <span className="people-row-name">{person.displayName}</span>
            <span className="people-row-reason">{suggestionReasonLabel(person)}</span>
          </div>
        </div>
        <button
          type="button"
          className={`button ${person.isFollowing ? 'button--outline' : 'button--primary'} people-follow-button`}
          disabled={Boolean(followBusy[person.id])}
          onClick={() => void toggleFollow(person)}
        >
          {followBusy[person.id] ? '…' : person.isFollowing ? 'Following' : 'Follow'}
        </button>
      </article>)}
    </section>}
    {moreError && <p className="inline-error" role="alert">{moreError} <RetryButton error={moreError} onRetry={() => void loadMore()} className="text-link" /></p>}
    {!loading && !error && nextCursor && <button className="button button--outline people-load-more" onClick={loadMore} disabled={loadingMore}>
      {loadingMore ? 'Loading…' : 'Load more people'}
    </button>}
    {previewCard}
  </div>;
}

export function ProfilePage({ editOnOpen = false }) {
  const { userId } = useParams();
  const { user: signedInUser, setUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState('');
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [photoChangeOpen, setPhotoChangeOpen] = useState(false);
  const [deletePhotoOpen, setDeletePhotoOpen] = useState(false);
  const [selectedProfileMedia, setSelectedProfileMedia] = useState(null);
  const [photoActionBusy, setPhotoActionBusy] = useState(false);
  const [photoActionError, setPhotoActionError] = useState('');
  const [photoActionNotice, setPhotoActionNotice] = useState('');
  const photoMenuRef = useRef(null);
  const cameraButtonRef = useRef(null);
  const [listType, setListType] = useState('');
  const [people, setPeople] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [cursor, setCursor] = useState(null);
  const [form, setForm] = useState({ username: '', displayName: '', bio: '', avatarMediaId: '' });
  const [activeContentTab, setActiveContentTab] = useState('posts');
  const [visitedContentTabs, setVisitedContentTabs] = useState(() => new Set(['posts']));
  const [savedType, setSavedType] = useState('posts');
  const [visitedSavedTypes, setVisitedSavedTypes] = useState(() => new Set(['posts']));
  const [availableTabs, setAvailableTabs] = useState(['posts', 'reels', 'tagged']);
  const [shareMessage, setShareMessage] = useState('');
  const navigate = useNavigate();
  const loadProfile = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      let data;
      if (userId) {
        data = /^[a-f\d]{24}$/i.test(userId)
          ? await userApi.profile(userId, { signal })
          : await userApi.profileByUsername(userId, { signal });
      } else {
        const own = await userApi.me({ signal });
        if (!own.user?.id) throw new Error('Your profile did not include an account ID.');
        data = await userApi.profile(own.user.id, { signal });
      }
      if (signal?.aborted) return;
      if (!data.user) throw new Error('The API returned an incomplete profile.');
      setProfile(data.user);
      setActiveContentTab('posts');
      setVisitedContentTabs(new Set(['posts']));
      setSavedType('posts');
      setVisitedSavedTypes(new Set(['posts']));
      setAvailableTabs(data.user.id === signedInUser?.id
        ? ['posts', 'reels', 'saved', 'tagged']
        : ['posts', 'reels', 'tagged']);
      setForm({
        username: data.user.username || '',
        displayName: data.user.displayName || '',
        bio: data.user.bio || '',
        avatarMediaId: '',
      });
    } catch (reason) {
      if (signal?.aborted || reason.name === 'AbortError') return;
      setError(reason.message || 'Could not load this profile.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [signedInUser?.id, userId]);

  useEffect(() => {
    const controller = new AbortController();
    loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);
  const isOwn = Boolean(profile && signedInUser && profile.id === signedInUser.id);
  useEffect(() => {
    if (!photoMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!photoMenuRef.current?.contains(event.target)) setPhotoMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setPhotoMenuOpen(false);
        cameraButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [photoMenuOpen]);
  useEffect(() => {
    if (!photoChangeOpen && !deletePhotoOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape' || photoActionBusy) return;
      if (photoChangeOpen) closePhotoChange();
      if (deletePhotoOpen) setDeletePhotoOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [photoActionBusy, photoChangeOpen, deletePhotoOpen]);
  useEffect(() => {
    if (editOnOpen && isOwn) {
      setEditError('');
      setEditOpen(true);
    }
  }, [editOnOpen, isOwn]);

  async function toggleFollow() {
    if (!profile || busy) return;
    setBusy(true);
    try {
      const result = profile.isFollowing ? await userApi.unfollow(profile.id) : await userApi.follow(profile.id);
      setProfile((current) => ({ ...current, isFollowing: result.following, followersCount: Math.max(0, (current.followersCount || 0) + (result.following ? 1 : -1)) }));
    } catch (reason) {
      setError(reason.message || 'Could not update this follow.');
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setEditError('');
    setBusy(true);
    const payload = {
      username: form.username,
      displayName: form.displayName,
      bio: form.bio,
      ...(form.avatarMediaId === null
        ? { avatarMediaId: null }
        : form.avatarMediaId
          ? { avatarMediaId: form.avatarMediaId }
          : {}),
    };
    try {
      const result = await userApi.updateMe(payload);
      if (!result.user) throw new Error('The API returned an incomplete profile update.');
      const updatedUser = form.avatarMediaId === null
        ? { ...result.user, avatarUrl: result.user.avatarUrl ?? null }
        : result.user;
      setProfile((current) => ({ ...current, ...updatedUser }));
      setUser(updatedUser);
      setForm({
        username: result.user.username || '',
        displayName: result.user.displayName || '',
        bio: result.user.bio || '',
        avatarMediaId: '',
      });
      setEditOpen(false);
      if (result.photoCleanupWarning) setPhotoActionNotice(result.photoCleanupWarning);
    } catch (reason) {
      setEditError(reason.message || 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  }

  function openEditProfile() {
    if (!profile) return;
    setEditError('');
    setForm({
      username: profile.username || '',
      displayName: profile.displayName || '',
      bio: profile.bio || '',
      avatarMediaId: '',
    });
    setEditOpen(true);
  }

  function openPhotoChange() {
    setPhotoMenuOpen(false);
    setPhotoActionError('');
    setSelectedProfileMedia(null);
    setPhotoChangeOpen(true);
  }

  async function closePhotoChange() {
    if (photoActionBusy) return;
    if (selectedProfileMedia?.id) {
      try {
        await mediaApi.remove(selectedProfileMedia.id);
      } catch (reason) {
        setPhotoActionError(reason.message || 'Could not discard the uploaded photo.');
        return;
      }
    }
    setSelectedProfileMedia(null);
    setPhotoChangeOpen(false);
    setPhotoActionError('');
  }

  async function saveProfilePhoto() {
    if (!selectedProfileMedia?.id || photoActionBusy) return;
    setPhotoActionBusy(true);
    setPhotoActionError('');
    setPhotoActionNotice('');
    try {
      const result = await userApi.updateMe({ avatarMediaId: selectedProfileMedia.id });
      if (!result.user) throw new Error('The API returned an incomplete profile update.');
      setProfile((current) => ({ ...current, ...result.user }));
      setUser(result.user);
      setSelectedProfileMedia(null);
      setPhotoChangeOpen(false);
      if (result.photoCleanupWarning) setPhotoActionNotice(result.photoCleanupWarning);
    } catch (reason) {
      setPhotoActionError(reason.message || 'Could not update your profile photo.');
    } finally {
      setPhotoActionBusy(false);
    }
  }

  async function deleteProfilePhoto() {
    if (!profile.avatarUrl || photoActionBusy) return;
    setPhotoActionBusy(true);
    setPhotoActionError('');
    setPhotoActionNotice('');
    try {
      const result = await userApi.deleteProfilePhoto();
      if (!result.user) throw new Error('The API returned an incomplete profile update.');
      setProfile((current) => ({
        ...current,
        ...result.user,
        avatarUrl: result.user.avatarUrl ?? null,
      }));
      setUser({ ...result.user, avatarUrl: result.user.avatarUrl ?? null });
      setDeletePhotoOpen(false);
      setPhotoMenuOpen(false);
      if (result.photoCleanupWarning) setPhotoActionNotice(result.photoCleanupWarning);
    } catch (reason) {
      setPhotoActionError(reason.message || 'Could not remove your profile photo.');
    } finally {
      setPhotoActionBusy(false);
    }
  }

  async function openList(relation) {
    setListType(relation);
    setPeople([]);
    setCursor(null);
    setListError('');
    setListLoading(true);
    try {
      const result = await userApi.relation(profile.id, relation);
      setPeople(result.users || []);
      setCursor(result.nextCursor || null);
    } catch (reason) {
      setListError(reason.message || `Could not load ${relation}.`);
    } finally {
      setListLoading(false);
    }
  }

  async function loadMorePeople() {
    if (!cursor || listLoading) return;
    setListLoading(true);
    try {
      const result = await userApi.relation(profile.id, listType, cursor);
      setPeople((current) => [...current, ...(result.users || [])]);
      setCursor(result.nextCursor || null);
    } catch (reason) {
      setListError(reason.message || `Could not load more ${listType}.`);
    } finally {
      setListLoading(false);
    }
  }

  async function messageUser() {
    try {
      const result = await messageApi.createConversation(profile.id);
      if (result.conversation?.id) navigate(`/messages/${result.conversation.id}`);
    } catch (reason) {
      setError(reason.message || 'Could not start a conversation.');
    }
  }

  async function shareProfile() {
    const url = `${window.location.origin}/profile/${encodeURIComponent(profile.username)}`;
    setShareMessage('');
    try {
      if (navigator.share) {
        await navigator.share({ title: `${profile.displayName} on CliQHeart`, url });
        setShareMessage('Profile shared.');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareMessage('Profile link copied.');
      } else {
        throw new Error('Sharing is not supported by this browser.');
      }
    } catch (reason) {
      if (reason.name !== 'AbortError') setShareMessage(reason.message || 'Could not share this profile.');
    }
  }

  function handleContentTabKey(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = availableTabs.indexOf(activeContentTab);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextTab = availableTabs[(currentIndex + direction + availableTabs.length) % availableTabs.length];
    activateContentTab(nextTab);
    document.getElementById(`profile-tab-${nextTab}`)?.focus();
  }

  function activateContentTab(tab) {
    setActiveContentTab(tab);
    setVisitedContentTabs((current) => new Set([...current, tab]));
  }

  if (loading) return <div className="page-content"><Skeleton rows={4} /></div>;
  if (error && !profile) return <div className="page-content"><ErrorState error={error} onRetry={() => loadProfile()} /></div>;
  if (!profile) return null;

  return <div className="page-content profile-page">
    <header className="profile-header">
      <div className="profile-photo-wrap">
        <Avatar name={profile.displayName} src={profile.avatarUrl} size="profile" />
        {isOwn && <div className="profile-photo-controls" ref={photoMenuRef}>
          <button
            ref={cameraButtonRef}
            className="profile-photo-camera"
            type="button"
            aria-label="Change profile photo"
            aria-haspopup="menu"
            aria-expanded={photoMenuOpen}
            title="Change profile photo"
            onClick={() => setPhotoMenuOpen((open) => !open)}
          >
            <Camera size={17} aria-hidden="true" />
          </button>
          {photoMenuOpen && <div className="profile-photo-menu" role="menu" aria-label="Profile photo actions">
            <button type="button" role="menuitem" onClick={openPhotoChange}>
              <Upload size={16} aria-hidden="true" /> Change profile photo
            </button>
            {profile.avatarUrl && <button
              type="button"
              role="menuitem"
              className="profile-photo-delete-action"
              onClick={() => {
                setPhotoMenuOpen(false);
                setPhotoActionError('');
                setDeletePhotoOpen(true);
              }}
            >
              <Trash2 size={16} aria-hidden="true" /> Delete profile photo
            </button>}
          </div>}
        </div>}
      </div>
      <div className="profile-info">
        <div className="profile-title"><h1>{profile.username}</h1>{isOwn
          ? <button className="button button--outline" onClick={openEditProfile}>Edit profile</button>
          : <><button className={`button ${profile.isFollowing ? 'button--outline' : 'button--primary'}`} onClick={toggleFollow} disabled={busy}>{profile.isFollowing ? 'Following' : 'Follow'}</button><button className="button button--outline" onClick={messageUser}>Message</button></>}
          <button className="button button--outline profile-share-button" onClick={shareProfile} aria-label="Share profile"><Share2 size={15} /><span>Share</span></button>
        </div>
        <div className="profile-counts">
            <span><b>{profile.postsCount ?? '—'}</b> posts</span>
          <button onClick={() => openList('followers')}><b>{profile.followersCount || 0}</b> followers</button>
          <button onClick={() => openList('following')}><b>{profile.followingCount || 0}</b> following</button>
        </div>
        <div className="profile-bio"><strong>{profile.displayName}</strong>{profile.bio && <p>{profile.bio}</p>}</div>
        {isOwn && <div className="profile-professional-actions">
          <Link className="button button--outline professional-profile-link" to={profile.accountType === 'CREATOR' || profile.accountType === 'BUSINESS' ? '/professional' : '/professional/onboarding'}>
            {profile.accountType === 'CREATOR' || profile.accountType === 'BUSINESS' ? 'Professional dashboard' : 'Switch to a professional account'}
          </Link>
        </div>}
      </div>
    </header>
    {error && <p className="inline-error">{error}</p>}
    {shareMessage && <p className="profile-share-status" role="status">{shareMessage}</p>}
    {photoActionNotice && <p className="profile-share-status" role="status">{photoActionNotice}</p>}
    {profile.professionalLabelVisible && <p className="professional-profile-label">{profile.professionalCategory?.replaceAll('_', ' ').toLowerCase()} · Professional account</p>}
    {profile.professionalContact && <div className="professional-public-contact">
      {profile.professionalContact.businessEmail && <a href={`mailto:${profile.professionalContact.businessEmail}`}>{profile.professionalContact.businessEmail}</a>}
      {profile.professionalContact.contactPhone && <a href={`tel:${profile.professionalContact.contactPhone}`}>{profile.professionalContact.contactPhone}</a>}
      {profile.professionalContact.website && <a href={profile.professionalContact.website} target="_blank" rel="noreferrer">Website</a>}
      {profile.professionalContact.businessAddress && <span>{profile.professionalContact.businessAddress}</span>}
    </div>}
    <div className="profile-content">
      <div className="profile-tabs" role="tablist" aria-label="Profile content" onKeyDown={handleContentTabKey}>
        {availableTabs.map((tab) => <button
          id={`profile-tab-${tab}`}
          key={tab}
          type="button"
          className={`profile-tab${activeContentTab === tab ? ' is-active' : ''}`}
          role="tab"
          aria-controls={`profile-panel-${tab}`}
          aria-selected={activeContentTab === tab}
          onClick={() => activateContentTab(tab)}
        >
          {tab === 'posts' ? <Grid3X3 size={15} /> : tab === 'reels' ? <Clapperboard size={15} /> : tab === 'saved' ? <Bookmark size={15} /> : <UserRound size={15} />}
          {tab.toUpperCase()}
        </button>)}
      </div>
      {availableTabs.filter((tab) => visitedContentTabs.has(tab)).map((tab) => <div
        id={`profile-panel-${tab}`}
        key={`${profile.id}-${tab}`}
        role="tabpanel"
        aria-labelledby={`profile-tab-${tab}`}
        tabIndex={0}
        hidden={activeContentTab !== tab}
      >
        {tab === 'posts'
          ? <ContentFeed userId={profile.id} layout="grid" />
          : tab === 'reels'
            ? <ContentFeed kind="reels" userId={profile.id} layout="grid" />
            : tab === 'saved'
              ? <>
                <div className="saved-content-tabs" role="tablist" aria-label="Saved content type">
                  {['posts', 'reels'].map((type) => <button
                    key={type}
                    type="button"
                    role="tab"
                    aria-selected={savedType === type}
                    className={savedType === type ? 'is-selected' : ''}
                    onClick={() => {
                      setSavedType(type);
                      setVisitedSavedTypes((current) => new Set([...current, type]));
                    }}
                  >{type === 'posts' ? 'Posts' : 'Reels'}</button>)}
                </div>
                {[...visitedSavedTypes].map((type) => <div key={type} hidden={savedType !== type}>
                  <ContentFeed kind="saved" savedType={type} layout="grid" />
                </div>)}
              </>
              : <ContentFeed kind="tagged" userId={profile.id} layout="grid" />}
      </div>)}
    </div>
    {photoChangeOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closePhotoChange();
    }}>
      <section className="modal-card profile-photo-modal" role="dialog" aria-modal="true" aria-labelledby="change-photo-title">
        <header className="modal-header">
          <h2 id="change-photo-title">Change profile photo</h2>
          <button type="button" className="icon-button" onClick={closePhotoChange} aria-label="Cancel photo change">×</button>
        </header>
        <MediaUploader
          purpose="profile"
          currentImageUrl={profile.avatarUrl || ''}
          disabled={photoActionBusy}
          onReady={setSelectedProfileMedia}
        />
        {photoActionError && <p className="form-error" role="alert">{photoActionError}</p>}
        <div className="profile-photo-modal-actions">
          <button type="button" className="button button--outline" disabled={photoActionBusy} onClick={closePhotoChange}>Cancel</button>
          <button
            type="button"
            className="button button--primary"
            disabled={!selectedProfileMedia?.id || photoActionBusy}
            onClick={saveProfilePhoto}
          >
            {photoActionBusy ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </section>
    </div>}
    {deletePhotoOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !photoActionBusy) setDeletePhotoOpen(false);
    }}>
      <section className="modal-card photo-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-photo-title" aria-describedby="delete-photo-description">
        <header className="modal-header">
          <h2 id="delete-photo-title">Remove your profile photo?</h2>
          <button type="button" className="icon-button" onClick={() => setDeletePhotoOpen(false)} aria-label="Cancel photo deletion" disabled={photoActionBusy}>×</button>
        </header>
        <p id="delete-photo-description">Your profile will show its default avatar. This cannot be undone.</p>
        {photoActionError && <p className="form-error" role="alert">{photoActionError}</p>}
        <div className="profile-photo-modal-actions">
          <button type="button" className="button button--outline" disabled={photoActionBusy} onClick={() => setDeletePhotoOpen(false)}>Cancel</button>
          <button type="button" className="button button--danger" disabled={photoActionBusy} onClick={deleteProfilePhoto}>
            <Trash2 size={16} aria-hidden="true" /> {photoActionBusy ? 'Deleting…' : 'Delete photo'}
          </button>
        </div>
      </section>
    </div>}
    {editOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditOpen(false); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">
        <header className="modal-header"><h2 id="edit-profile-title">Edit profile</h2><button className="icon-button" onClick={() => setEditOpen(false)} aria-label="Close">×</button></header>
        <form className="form-stack" onSubmit={saveProfile}>
          <label>Display name<input maxLength="80" required value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label>Username<input minLength="3" maxLength="30" pattern="(?!.*\\.\\.)[a-zA-Z0-9._]{3,30}" required value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} /></label>
          <label>Bio<textarea maxLength="500" rows="3" value={form.bio} onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))} /><small>{form.bio.length}/500 characters</small></label>
          <label>Profile photo</label>
          {profile.avatarUrl && form.avatarMediaId !== null && <button type="button" className="text-link" onClick={() => setForm((current) => ({ ...current, avatarMediaId: null }))}>Remove current photo</button>}
          {form.avatarMediaId === null && <button type="button" className="text-link" onClick={() => setForm((current) => ({ ...current, avatarMediaId: '' }))}>Keep current photo</button>}
          <MediaUploader
            purpose="profile"
            currentImageUrl={form.avatarMediaId === null ? '' : profile.avatarUrl || ''}
            onReady={(media) => setForm((current) => ({ ...current, avatarMediaId: media?.id || '' }))}
          />
          {editError && <p className="form-error" role="alert">{editError}</p>}
          <button className="button button--primary button--wide" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </form>
      </section>
    </div>}
    {listType && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setListType(''); }}>
      <section className="modal-card list-modal" role="dialog" aria-modal="true" aria-labelledby="people-list-title">
        <header className="modal-header"><h2 id="people-list-title">{listType === 'followers' ? 'Followers' : 'Following'}</h2><button className="icon-button" onClick={() => setListType('')} aria-label="Close">×</button></header>
        {listError && <ErrorState error={listError} onRetry={() => openList(listType)} />}
        {listLoading && people.length === 0 ? <Skeleton rows={4} /> : people.length === 0 ? <EmptyState title="No accounts yet" description={`This profile has no ${listType} to show.`} /> : <div className="people-list">{people.map((person) => <Link className="people-list-item" key={person.id} to={`/profile/${person.id}`} onClick={() => setListType('')}><Avatar name={person.displayName} src={person.avatarUrl} /><span><b>@{person.username}</b><small>{person.displayName}</small></span><ArrowUpRight size={16} /></Link>)}</div>}
        {cursor && <button className="button button--outline button--wide" disabled={listLoading} onClick={loadMorePeople}>{listLoading ? 'Loading…' : 'Load more'}</button>}
      </section>
    </div>}
  </div>;
}

export function MessagesPage() {
  return <MessageWorkspace />;
}

export function SettingsPage() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => localStorage.getItem('cliqheart-theme') || 'light');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  function changeTheme(value) {
    setTheme(value);
    localStorage.setItem('cliqheart-theme', value);
    document.documentElement.dataset.theme = value;
  }
  function logout() {
    signOut();
    navigate('/login', { replace: true });
  }
  async function deleteAccount(event) {
    event.preventDefault();
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await userApi.deleteAccount({ password: deletePassword });
      await signOut();
      navigate('/', { replace: true });
    } catch (error) {
      setDeleteError(error.message || 'Account deletion failed. Please try again.');
    } finally {
      setDeleteBusy(false);
    }
  }
  return <div className="page-content settings-page">
    <header className="page-heading"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Settings</h1><p className="heading-subtitle">Manage the CliQHeart experience.</p></div></header>
    <section className="settings-card"><div className="settings-account"><Avatar name={user?.displayName} src={user?.avatarUrl} size="large" /><span><b>{user?.displayName}</b><small>@{user?.username}</small></span><Link to="/profile" className="text-link">View profile</Link></div></section>
    <section className="settings-card"><div className="settings-section-head"><div><h2>Appearance</h2><p>Choose how CliQHeart looks on this device.</p></div></div><div className="theme-options"><button className={theme === 'light' ? 'is-selected' : ''} onClick={() => changeTheme('light')}>Light</button><button className={theme === 'dark' ? 'is-selected' : ''} onClick={() => changeTheme('dark')}>Dark</button></div></section>
    <section className="settings-card"><div className="settings-section-head"><div><h2>Account session</h2><p>Sign out of this browser session.</p></div><button className="button button--outline" onClick={logout}>Log out</button></div><p className="security-note"><ShieldCheck size={16} /> Access token remains in memory only and is cleared when you sign out or close the page.</p></section>
    <section className="settings-card"><div className="settings-section-head"><div><h2>Privacy & account</h2><p>Account controls are enforced by the shared CliQHeart API.</p></div></div><p className="helper-text">Email, phone number, and account status are not displayed in public profile screens.</p></section>
    <section className="settings-card"><div className="settings-section-head"><div><h2>{user?.accountType !== 'CREATOR' && user?.accountType !== 'BUSINESS' ? 'Professional account' : 'Professional tools'}</h2><p>{user?.accountType !== 'CREATOR' && user?.accountType !== 'BUSINESS' ? 'Keep your current profile, posts, followers, and sign-in while adding professional insights.' : `${user?.accountType === 'BUSINESS' ? 'Business' : 'Creator'} account tools and audience analytics.`}</p></div><Link className="button button--outline" to={user?.accountType === 'CREATOR' || user?.accountType === 'BUSINESS' ? '/professional' : '/professional/onboarding'}>{user?.accountType === 'CREATOR' || user?.accountType === 'BUSINESS' ? 'Open dashboard' : 'Get started'}</Link></div></section>
    <section className="settings-card settings-danger-zone"><div className="settings-section-head"><div><h2>Delete account</h2><p>Permanently deactivate your account and remove its follow relationships.</p></div><button className="button button--danger" onClick={() => { setDeleteError(''); setDeletePassword(''); setDeleteDialogOpen(true); }}>Delete account</button></div></section>
    {deleteDialogOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleteBusy) setDeleteDialogOpen(false); }}>
      <form className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-account-title" onSubmit={deleteAccount}>
        <h2 id="delete-account-title">Delete your account?</h2>
        <p>This will deactivate your account, revoke its sessions, remove its follower/following relationships, and remove notifications involving it. This action cannot be undone.</p>
        <label className="form-field"><span>Current password</span><input autoComplete="current-password" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} required /></label>
        {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
        <div className="modal-actions"><button type="button" className="button button--outline" disabled={deleteBusy} onClick={() => setDeleteDialogOpen(false)}>Cancel</button><button type="submit" className="button button--danger" disabled={deleteBusy || !deletePassword}>{deleteBusy ? 'Deleting...' : 'Permanently delete account'}</button></div>
      </form>
    </div>}
  </div>;
}

export function CapabilityPage({ title, feature }) {
  return <div className="page-content capability-page"><header className="page-heading"><div><p className="eyebrow">COMING INTO FOCUS</p><h1>{title}</h1><p className="heading-subtitle">A genuine feature, not a placeholder feed.</p></div></header><EmptyState title={`${feature} is not available yet`} description="The current shared API does not provide this capability. We have not added sample content or a pretend action. Your existing CliQHeart account and profile still work here." icon={Sparkles} /><Link to="/search" className="button button--primary"><Search size={16} /> Find people instead</Link></div>;
}

export function CreatePage() {
  const location = useLocation();
  const { user } = useAuth();
  const requestedKind = new URLSearchParams(location.search).get('kind');
  const [kind, setKind] = useState(['post', 'story', 'reel'].includes(requestedKind) ? requestedKind : 'post');
  const [media, setMedia] = useState(null);
  const [caption, setCaption] = useState('');
  const [locationName, setLocationName] = useState('');
  const [altText, setAltText] = useState('');
  const [aiDisclosure, setAiDisclosure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [published, setPublished] = useState(null);
  const [uploaderKey, setUploaderKey] = useState(0);
  const submitting = useRef(false);
  const verifiedReelDuration = typeof media?.duration === 'number' &&
    Number.isFinite(media.duration) && media.duration > 0;
  const reelDurationUnverified = kind === 'reel' && Boolean(media?.id) && !verifiedReelDuration;
  const reelTooLong = kind === 'reel' && verifiedReelDuration && media.duration > 180;
  const hasUnsavedChanges = Boolean(
    media?.id || caption.trim() || locationName.trim() || altText.trim() || aiDisclosure,
  );

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  async function changeKind(nextKind) {
    if (busy || published || nextKind === kind) return;
    if (hasUnsavedChanges && !window.confirm('Discard this upload and your unsaved changes?')) return;
    if (media?.id) {
      try {
        await mediaApi.remove(media.id);
      } catch (reason) {
        setError(`Could not clear the previous upload: ${reason.message}`);
        return;
      }
    }
    setMedia(null);
    setCaption('');
    setLocationName('');
    setAltText('');
    setAiDisclosure(false);
    setError('');
    setKind(nextKind);
  }

  async function publish(event) {
    event.preventDefault();
    if (!media?.id || busy || submitting.current || reelTooLong || reelDurationUnverified) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const payload = { mediaId: media.id, caption: caption.trim() };
      if (locationName.trim()) payload.location = locationName.trim();
      if (kind === 'post' && altText.trim()) payload.altText = altText.trim();
      if (kind === 'reel' && aiDisclosure) payload.aiDisclosure = true;
      const result = kind === 'post'
        ? await contentApi.createPost(payload)
        : kind === 'story'
          ? await contentApi.createStory(payload)
          : await contentApi.createReel(payload);
      setPublished({
        kind,
        id: result?.[kind]?.id,
      });
      setMedia(null);
      setCaption('');
      setLocationName('');
      setAltText('');
      setAiDisclosure(false);
      setUploaderKey((value) => value + 1);
    } catch (reason) {
      const validationDetails = Array.isArray(reason.details)
        ? reason.details
          .filter((detail) => typeof detail?.field === 'string' && typeof detail?.message === 'string')
          .map((detail) => `${detail.field}: ${detail.message}`)
        : [];
      setError([
        reason.message || 'Could not publish your content.',
        ...validationDetails,
      ].join(' '));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <div className="page-content create-page">
    <header className="page-heading create-heading"><div><p className="eyebrow">MAKE A MOMENT</p><h1>Create</h1><p className="heading-subtitle">Share something with your CliQHeart community.</p></div><Link className="button button--outline" to="/" onClick={(event) => {
      if (hasUnsavedChanges && !window.confirm('Leave and discard your unsaved changes?')) event.preventDefault();
    }}>Close</Link></header>
    <div className="content-mode-tabs" role="tablist" aria-label="Content type">
      {['post', 'story', 'reel'].map((option) => <button
        type="button"
        role="tab"
        aria-selected={kind === option}
        className={kind === option ? 'is-selected' : ''}
        disabled={busy || Boolean(published)}
        key={option}
        onClick={() => changeKind(option)}
      >{option[0].toUpperCase() + option.slice(1)}</button>)}
    </div>
    {published ? <section className="create-published" role="status">
      <CheckCircle2 size={26} />
      <div>
        <h2>{published.kind === 'story' ? 'Your story is live for 24 hours.' : 'Your content has been published.'}</h2>
        <p>{published.kind === 'story'
          ? 'Your story is now available to you and the people you follow.'
          : 'Your verified media and caption are now part of your CliQHeart profile.'}</p>
        {published.id && <Link className="text-link" to={`/${published.kind}/${published.id}`}>View published {published.kind}</Link>}
        {published.kind === 'story' && <Link className="text-link" to="/">Return to your feed</Link>}
      </div>
      <button type="button" className="button button--primary" onClick={() => setPublished(null)}>Create another</button>
    </section> : <form className="create-form create-studio" onSubmit={publish}>
      <section className="create-editor">
        <div className="create-section-heading">
          <div><p className="eyebrow">STEP 1 · MEDIA</p><h2>{kind === 'story' ? 'Create a story' : kind === 'reel' ? 'Create a Reel' : 'Create a post'}</h2></div>
          <span className="create-draft-status">Drafts unavailable</span>
        </div>
        <MediaUploader key={`${kind}-${uploaderKey}`} purpose={kind} onReady={setMedia} disabled={busy} />
        <p className="helper-text">{kind === 'reel'
          ? 'Choose an MP4 or MOV video up to 180 seconds. Your upload is verified before it can be published.'
          : kind === 'story'
            ? 'Choose a photo or video. Stories expire automatically after 24 hours.'
            : 'Choose one photo or video for this post. Carousel posts are not supported yet.'}</p>
        <label className="create-field">
          <span>Caption</span>
          {kind === 'story'
            ? <textarea aria-label="Caption" rows="5" maxLength={500} value={caption} onChange={(event) => setCaption(event.target.value)} disabled={busy} />
            : <>
              <span className="hashtag-section-label">Hashtags <small>Type # in your caption to search or create one</small></span>
              <HashtagComposer caption={caption} onChange={setCaption} disabled={busy} maxLength={2200} />
            </>}
          <small>{caption.length}/{kind === 'story' ? 500 : 2200}</small>
        </label>
        {kind !== 'story' && <label className="create-field">
          <span>Location <small>Optional</small></span>
          <input maxLength={120} value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="Add a location" disabled={busy} />
        </label>}
        {kind === 'post' && <label className="create-field">
          <span>Alt text <small>Optional · accessibility</small></span>
          <textarea rows="2" maxLength={500} value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Describe this media for people using screen readers" disabled={busy} />
        </label>}
        {kind === 'reel' && <div className="create-options">
          <label className="create-check">
            <input type="checkbox" checked={aiDisclosure} onChange={(event) => setAiDisclosure(event.target.checked)} disabled={busy} />
            <span><strong>AI-generated or altered content</strong><small>Disclose realistic AI-generated or significantly altered media. This is a self-reported label; CliQHeart does not automatically detect AI content.</small></span>
          </label>
          <p className="create-unavailable"><strong>Scheduling unavailable:</strong> this service does not yet have a durable publishing worker. Reels publish immediately.</p>
        </div>}
        {kind !== 'reel' && <p className="create-unavailable"><strong>Draft saving unavailable:</strong> drafts are not stored by the backend, so this composer publishes only after you choose Share or Publish.</p>}
        {kind === 'reel' && <p className="create-unavailable"><strong>Captions unavailable:</strong> automatic transcription and subtitle generation are not implemented.</p>}
        {reelDurationUnverified && <p className="form-error" role="alert">We couldn't verify this video's duration. Choose another video or retry the upload.</p>}
        {reelTooLong && <p className="form-error" role="alert">This video exceeds the 180-second Reel limit. Choose a shorter video.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary button--wide create-publish" disabled={busy || !media?.id || reelTooLong || reelDurationUnverified}>{busy ? 'Publishing…' : kind === 'story' ? 'Share story' : 'Publish'}</button>
      </section>
      <aside className={`create-preview${kind === 'story' ? ' create-preview--story' : kind === 'reel' ? ' create-preview--reel' : ''}`} aria-label="Content preview">
        <div className="create-section-heading"><div><p className="eyebrow">STEP 2 · PREVIEW</p><h2>Preview</h2></div></div>
        <article className="create-preview-card">
          <header className="create-preview-owner">
            <Avatar name={user?.displayName || user?.username || ''} src={user?.avatarUrl} size="small" />
            <span><strong>{user?.displayName || user?.username || 'Your profile'}</strong><small>@{user?.username || 'your-username'}</small></span>
          </header>
          <div className="create-preview-media">
            {media?.resourceType === 'video'
              ? <video src={media.secureUrl} poster={media.thumbnailUrl} controls playsInline preload="metadata" />
              : media?.secureUrl
                ? <img src={media.secureUrl} alt={altText || 'Selected media preview'} />
                : <p>Your media preview will appear here after upload.</p>}
          </div>
          <p className="create-preview-caption"><strong>@{user?.username || 'your-username'}</strong>{caption ? <> <HashtagText>{caption}</HashtagText></> : ' Your caption will appear here.'}</p>
          {locationName.trim() && <p className="create-preview-location">{locationName.trim()}</p>}
          {kind === 'reel' && aiDisclosure && <span className="create-ai-label">AI-generated or altered</span>}
        </article>
        <p className="helper-text">{kind === 'story' ? 'Stories are shown to people you follow and expire after 24 hours.' : kind === 'reel' ? 'Reels may appear in feeds and profile pages under existing visibility rules.' : 'Your post will appear in feeds and on your profile.'}</p>
      </aside>
    </form>}
  </div>;
}

export function ReelsPage() {
  const { user } = useAuth();
  return <ReelsExperience viewer={user} />;
}

export function StoryPage() {
  const { storyId } = useParams();
  const navigate = useNavigate();
  return <StoryFeed initialStoryId={storyId} standalone onStandaloneClose={() => navigate('/', { replace: true })} />;
}

export function NotificationsPage() {
  const { unreadNotificationCount, setUnreadNotificationCount } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [followBusy, setFollowBusy] = useState({});
  const [followedActors, setFollowedActors] = useState({});

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await notificationApi.list();
      setNotifications(result.notifications || []);
      setNextCursor(result.nextCursor || null);
      if (Number.isInteger(result.unreadCount)) setUnreadNotificationCount(result.unreadCount);
    } catch (reason) {
      setError(reason.message || 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, [setUnreadNotificationCount]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  async function markAllRead() {
    setError('');
    try {
      await notificationApi.markAllRead();
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
      setUnreadNotificationCount(0);
    } catch (reason) {
      setError(reason.message || 'Could not mark notifications as read.');
    }
  }

  async function openNotification(item) {
    if (!item.read) {
      try {
        await notificationApi.markRead(item.id);
        setNotifications((current) => current.map((notification) => notification.id === item.id
          ? { ...notification, read: true }
          : notification));
        setUnreadNotificationCount(Math.max(0, unreadNotificationCount - 1));
      } catch (reason) {
        setError(reason.message || 'Could not mark this notification as read.');
        return;
      }
    }
    if (item.type === 'follow' && (item.actor?.username || item.actor?.id)) navigate(`/profile/${item.actor.username || item.actor.id}`);
    else if (item.type === 'message' && item.conversationId) navigate(`/messages/${item.conversationId}`);
    else if ((item.type === 'story_like' || item.type === 'story_reaction') && item.storyId) navigate(`/story/${item.storyId}`);
    else if (item.reelId) navigate(getReelPath(item.reelId));
    else if (item.postId) navigate(`/post/${item.postId}`);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await notificationApi.list({ after: nextCursor });
      setNotifications((current) => [...current, ...(result.notifications || [])]);
      setNextCursor(result.nextCursor || null);
    } catch (reason) {
      setError(reason.message || 'Could not load more notifications.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function followBack(item) {
    const actorId = item.actor?.id;
    if (!actorId || followBusy[item.id]) return;
    setFollowBusy((current) => ({ ...current, [item.id]: true }));
    setError('');
    try {
      await userApi.follow(actorId);
      setFollowedActors((current) => ({ ...current, [item.id]: true }));
    } catch (reason) {
      setError(reason.message || 'Could not follow this person.');
    } finally {
      setFollowBusy((current) => ({ ...current, [item.id]: false }));
    }
  }

  const todayKey = new Date().toDateString();
  const today = notifications.filter((item) => new Date(item.createdAt).toDateString() === todayKey);
  const earlier = notifications.filter((item) => new Date(item.createdAt).toDateString() !== todayKey);

  function renderNotification(item) {
    const actor = item.actor;
    const description = item.type === 'follow'
      ? 'started following you.'
      : item.type === 'tag'
        ? 'tagged you in a post.'
        : item.type === 'like'
          ? 'liked your content.'
          : item.type === 'comment'
            ? 'commented on your content.'
            : item.type === 'reply'
              ? 'replied to your comment.'
              : item.type === 'repost'
                ? 'reposted your content.'
                : item.type === 'story_like'
                  ? 'liked your story.'
                  : item.type === 'story_reaction'
                    ? 'reacted to your story.'
                : 'sent you a message.';
    return <article className={`notification-item${item.read ? '' : ' is-unread'}`} key={item.id}>
      <button className="notification-open" onClick={() => openNotification(item)}>
        <Avatar name={actor?.displayName || actor?.username || 'CliQHeart member'} src={actor?.avatarUrl} size="medium" />
        <span className="notification-copy">
          <span><strong>{actor?.displayName || 'A CliQHeart member'}</strong> {description}</span>
          <small>{new Date(item.createdAt).toLocaleString()}</small>
        </span>
        {item.thumbnailUrl && <img className="notification-thumbnail" src={item.thumbnailUrl} alt="" loading="lazy" />}
      </button>
      {item.type === 'follow' && actor?.id && <button className="button button--outline notification-follow" onClick={() => followBack(item)} disabled={followBusy[item.id] || followedActors[item.id]}>
        {followBusy[item.id] ? '…' : followedActors[item.id] ? 'Following' : 'Follow back'}
      </button>}
    </article>;
  }

  return <div className="page-content notifications-page">
    <header className="page-heading notifications-heading">
      <div><p className="eyebrow">YOUR COMMUNITY</p><h1>Notifications</h1><p className="heading-subtitle">{unreadNotificationCount} unread</p></div>
      {unreadNotificationCount > 0 && <button className="button button--outline" onClick={markAllRead}>Mark all as read</button>}
    </header>
    {error && <ErrorState error={error} onRetry={loadNotifications} />}
    {loading && <Skeleton rows={5} />}
    {!loading && !error && notifications.length === 0 && <EmptyState title="You're all caught up" description="New follows, tags, and messages will show up here." icon={Bell} />}
    {!loading && today.length > 0 && <section className="notification-group"><h2>Today</h2>{today.map(renderNotification)}</section>}
    {!loading && earlier.length > 0 && <section className="notification-group"><h2>Earlier</h2>{earlier.map(renderNotification)}</section>}
    {!loading && nextCursor && <button className="button button--outline load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
  </div>;
}

export function ContentDetailPage({ kind }) {
  const { user: currentUser } = useAuth();
  const { postId, reelId } = useParams();
  const id = kind === 'reel' ? reelId : postId;
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [tagResults, setTagResults] = useState([]);
  const [tagStatus, setTagStatus] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const result = kind === 'reel'
          ? await contentApi.reel(id, { signal: controller.signal })
          : await contentApi.post(id, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setItem(result[kind]);
        }
      } catch (reason) {
        if (!controller.signal.aborted && reason.name !== 'AbortError') setError(reason.message || 'Could not load this content.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, [id, kind]);

  async function searchTagUsers(event) {
    event.preventDefault();
    const query = tagQuery.trim();
    if (query.length < 2) {
      setActionError('Enter at least 2 characters to search for someone.');
      return;
    }
    setActionError('');
    setTagStatus('');
    setTagBusy(true);
    try {
      const result = await userApi.search(query);
      setTagResults(result.users || []);
    } catch (reason) {
      setActionError(reason.message || 'Could not search for people to tag.');
    } finally {
      setTagBusy(false);
    }
  }

  async function tagUser(person) {
    setTagBusy(true);
    setActionError('');
    setTagStatus('');
    try {
      const contentType = kind === 'reel' ? 'reel' : 'post';
      await contentApi.tagUser(contentType, item.id, person.id);
      setTagStatus(`@${person.username} was tagged in this ${kind}.`);
      setTagResults((current) => current.filter((entry) => entry.id !== person.id));
    } catch (reason) {
      setActionError(reason.message || 'Could not tag this person.');
    } finally {
      setTagBusy(false);
    }
  }

  if (loading) return <div className="page-content"><Skeleton rows={3} /></div>;
  if (error) return <div className="page-content"><ErrorState error={error} /></div>;
  if (!item) return <div className="page-content"><EmptyState title="Content not found" description="This content may have been removed." icon={Heart} /></div>;
  const isVideo = item.media?.resourceType === 'video';
  async function shareContent(content) {
    const url = new URL(kind === 'reel' ? getReelPath(content.id) : `/post/${encodeURIComponent(content.id)}`, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: `Content by @${content.owner?.username || 'CliQHeart member'}`, text: content.caption || '', url });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else throw new Error('Sharing is not supported by this browser.');
    } catch (reason) {
      if (reason?.name !== 'AbortError') setActionError(reason?.message || 'Could not share this content.');
    }
  }
  return <article className={`page-content content-detail${kind === 'reel' ? ' content-detail--reel' : ''}`}>
    <header className="content-card-header">
      <Link to={`/profile/${item.owner.id}`} className="content-card-owner">
        <Avatar name={item.owner.displayName} src={item.owner.avatarUrl} size="small" />
        <span><strong>{item.owner.displayName}</strong><small>@{item.owner.username}</small></span>
      </Link>
      <div className="content-card-actions">
        <Link to={`/profile/${item.owner.id}`} className="text-link">View profile</Link>
      </div>
    </header>
    <div className="content-detail-media">
      {isVideo
        ? <video src={item.media.secureUrl} poster={item.media.thumbnailUrl} controls playsInline preload="metadata" />
        : <img src={item.media?.secureUrl || item.media?.thumbnailUrl} alt={item.altText || item.caption || 'Shared CliQHeart media'} />}
    </div>
    <div className="content-engagement">
      <EngagementActions item={item} kind={kind === 'reel' ? 'reels' : 'posts'} onShare={shareContent} />
    </div>
    {item.caption && <p className="content-card-caption"><strong>@{item.owner.username}</strong> <HashtagText>{item.caption}</HashtagText></p>}
    {item.location && <p className="content-card-location">{item.location}</p>}
    {kind === 'reel' && item.aiDisclosure && <p className="content-card-location">AI-generated or altered content</p>}
    {actionError && <p className="inline-error" role="alert">{actionError}</p>}
    {tagStatus && <p className="form-success" role="status">{tagStatus}</p>}
    {kind === 'post' && currentUser?.id === item.owner.id && <section className="post-tag-editor" aria-label="Tag someone in this post">
      <form className="post-tag-search" onSubmit={searchTagUsers}>
        <label htmlFor="post-tag-user">Tag a person</label>
        <input id="post-tag-user" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="Search by name or username" />
        <button className="button button--outline" disabled={tagBusy}>{tagBusy ? 'Searching…' : 'Search'}</button>
      </form>
      {tagResults.map((person) => <div className="post-tag-result" key={person.id}>
        <Avatar name={person.displayName} src={person.avatarUrl} size="small" />
        <span>@{person.username}</span>
        <button className="button button--outline" disabled={tagBusy} onClick={() => tagUser(person)}>Tag</button>
      </div>)}
    </section>}
  </article>;
}

export function NotFoundPage() {
  return <div className="not-found"><Brand /><p className="eyebrow">NOT THE RIGHT CORNER</p><h1>We couldn't find that page.</h1><Link to="/" className="button button--primary">Back to CliQHeart</Link></div>;
}
