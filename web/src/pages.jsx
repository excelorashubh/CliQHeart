import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Bell, Bookmark, Clapperboard, Compass, Eye, EyeOff, Grid3X3, Heart,
  LockKeyhole, MessageCircle, Search, ShieldCheck, Sparkles, UserRound,
  Share2,
} from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { Avatar, Brand } from './components/Brand.jsx';
import { EmptyState, ErrorState, Skeleton } from './components/Feedback.jsx';
import { ContentFeed, StoryFeed } from './components/Content.jsx';
import { MediaUploader } from './components/MediaUploader.jsx';
import { contentApi, mediaApi, messageApi, notificationApi, userApi } from './services/api.js';
import { MessageWorkspace } from './components/Messages.jsx';

export function LandingPage() {
  return <main className="landing">
    <nav className="landing-nav"><Link to="/"><Brand /></Link><div><Link className="landing-login" to="/login">Log in</Link><Link className="button button--primary" to="/register">Join CliQHeart <ArrowRight size={16} /></Link></div></nav>
    <section className="landing-hero">
      <div className="hero-copy">
        <p className="eyebrow"><span className="eyebrow-dot" /> MADE FOR YOUR PEOPLE</p>
        <h1>Closer feels<br />like <em>CliQHeart.</em></h1>
        <p className="hero-description">A thoughtful place to find your people, catch up, and keep the conversations going.</p>
        <div className="hero-actions"><Link className="button button--primary button--large" to="/signup">Get started <ArrowRight size={17} /></Link><Link className="text-link" to="/login">I already have an account <ArrowUpRight size={16} /></Link></div>
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
  const created = new URLSearchParams(location.search).get('created');
  const logoutWarning = location.state?.logoutWarning;

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(identifier, password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (reason) {
      setError(reason.message || 'Could not sign in.');
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
      <button className="button button--primary button--wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></button>
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
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setError('');
    const validation = {};
    const username = form.username.trim().toLowerCase();
    const validUsername = username.length >= 3 && username.length <= 30 &&
      /^[a-z0-9._]+$/.test(username) && !username.startsWith('.') &&
      !username.endsWith('.') && !username.includes('..');
    const reservedUsernames = new Set(['admin', 'root', 'support', 'staff', 'system', 'cliqheart']);
    if (!form.displayName.trim() || form.displayName.trim().length > 80) {
      validation.displayName = 'Enter a display name of up to 80 characters.';
    }
    if (!validUsername) {
      validation.username = 'Use 3–30 letters, numbers, periods, or underscores. Do not start/end with a period or repeat periods.';
    } else if (reservedUsernames.has(username)) {
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
      return;
    }
    setBusy(true);
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
      setError(reason.message || 'Could not create your account.');
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
      <label>Username<input autoComplete="username" minLength="3" maxLength="30" value={form.username} onChange={change('username')} required aria-invalid={Boolean(fieldErrors.username)} />{fieldErrors.username ? <small className="field-error">{fieldErrors.username}</small> : <small>3–30 letters, numbers, periods, or underscores.</small>}</label>
      <label>Email<input type="email" autoComplete="email" maxLength="254" value={form.email} onChange={change('email')} required aria-invalid={Boolean(fieldErrors.email)} />{fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}</label>
      <div className="form-two-columns">
        <label>Password<span className="password-field"><input aria-label="Password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="8" maxLength="128" value={form.password} onChange={change('password')} required aria-invalid={Boolean(fieldErrors.password)} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{fieldErrors.password ? <small className="field-error">{fieldErrors.password}</small> : <small>At least 8 characters, including a letter and number.</small>}</label>
        <label>Confirm password<span className="password-field"><input aria-label="Confirm password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="8" maxLength="128" value={form.confirmPassword} onChange={change('confirmPassword')} required aria-invalid={Boolean(fieldErrors.confirmPassword)} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{fieldErrors.confirmPassword && <small className="field-error">{fieldErrors.confirmPassword}</small>}</label>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>I agree to the Terms of Service and Privacy Policy.{fieldErrors.agreeToTerms && <small className="field-error">{fieldErrors.agreeToTerms}</small>}</span></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button--primary button--wide" disabled={busy || !terms}>{busy ? 'Creating account…' : 'Create account'} <ArrowRight size={17} /></button>
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
  return <div className="page-content home-page">
    <header className="page-heading home-heading"><div><p className="eyebrow">YOUR COMMUNITY, YOUR WAY</p><h1>Good to see you, {user?.displayName?.split(' ')[0]} <span className="wave">✦</span></h1><p className="heading-subtitle">A little more connection goes a long way.</p></div><Avatar name={user?.displayName} src={user?.avatarUrl} size="large" /></header>
    <section className="welcome-card"><div className="welcome-copy">
      <span className="welcome-kicker"><Sparkles size={15} /> A fresh start</span><h2>Your corner of CliQHeart is ready.</h2>
      <p>Find people you know, shape your profile, and start a conversation. Your account is shared with the CliQHeart Android app.</p>
      <Link to="/search" className="button button--light">Find your people <ArrowRight size={16} /></Link>
    </div><div className="welcome-art" aria-hidden="true"><span className="art-orbit orbit-one" /><span className="art-orbit orbit-two" /><span className="art-heart"><Heart size={78} fill="currentColor" strokeWidth={1.2} /></span><span className="art-spark spark-one">✦</span><span className="art-spark spark-two">✧</span></div></section>
    <section className="section-heading"><div><p className="eyebrow">MAKE IT YOURS</p><h2>Start with a connection</h2></div></section>
    <div className="action-grid">
      <Link to="/profile" className="action-card"><span className="action-icon action-icon--rose"><Heart size={20} /></span><span><strong>Set up your profile</strong><small>Share a little about yourself.</small></span><ArrowRight size={18} className="action-arrow" /></Link>
      <Link to="/search" className="action-card"><span className="action-icon action-icon--lavender"><Compass size={20} /></span><span><strong>Search and explore</strong><small>Find people and explore CliQHeart.</small></span><ArrowRight size={18} className="action-arrow" /></Link>
      <Link to="/messages" className="action-card"><span className="action-icon action-icon--peach"><MessageCircle size={20} /></span><span><strong>Say hello</strong><small>Pick up a conversation.</small></span><ArrowRight size={18} className="action-arrow" /></Link>
      <Link to="/create" className="action-card"><span className="action-icon action-icon--rose"><Heart size={20} /></span><span><strong>Share a moment</strong><small>Post a photo, story, or video.</small></span><ArrowRight size={18} className="action-arrow" /></Link>
    </div>
    <section className="content-section"><div className="section-heading"><div><p className="eyebrow">YOUR PEOPLE</p><h2>Stories</h2></div></div><StoryFeed /></section>
    <section className="content-section"><div className="section-heading"><div><p className="eyebrow">SHARED MOMENTS</p><h2>Latest posts</h2></div><Link className="text-link" to="/create">Create a post</Link></div><ContentFeed /></section>
  </div>;
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
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
    const timer = window.setTimeout(async () => {
      try {
        const result = await userApi.search(term, { signal: controller.signal });
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
        setResultsQuery('');
        setNextCursor(null);
        setError('');
        setFollowError('');
      }} aria-label="Search users by name or username" aria-controls="search-results" />
      {query && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => {
        setQuery('');
        setUsers([]);
        setResultsQuery('');
        setNextCursor(null);
        setError('');
        setFollowError('');
      }}>Clear</button>}
    </label>
    {term ? <>
      <div className="results-heading" id="search-results">
        {term.length >= 2 ? <span>People matching <strong>“{term}”</strong></span> : <span>Enter at least 2 characters to search.</span>}
      </div>
      {loading && <Skeleton rows={4} />}
      {!loading && error && <ErrorState error={error} onRetry={() => setRun((value) => value + 1)} />}
      {followError && <p className="inline-error" role="alert">{followError}</p>}
      {!loading && !error && term.length >= 2 && showingResults && users.length === 0 && <EmptyState title="No people found" description="Try another name or username." icon={Search} />}
      {!loading && showingResults && users.length > 0 && <div className="user-results">{users.map((person) => <article className="user-result" key={person.id}>
        <Link to={`/profile/${person.id}`} className="user-result-profile"><Avatar name={person.displayName} src={person.avatarUrl} size="large" /><span><b>{person.displayName}</b><small>@{person.username}</small>{person.bio && <small className="user-bio">{person.bio}</small>}</span></Link>
        <button className={`button ${person.isFollowing ? 'button--outline' : 'button--primary'}`} onClick={() => toggleFollow(person)} disabled={followBusy[person.id]}>{followBusy[person.id] ? '…' : person.isFollowing ? 'Following' : 'Follow'}</button>
      </article>)}</div>}
      {showingResults && nextCursor && <button className="button button--outline load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more people'}</button>}
    </> : <section className="explore-section" aria-labelledby="explore-heading">
      <div className="explore-heading"><div><p className="eyebrow">A LITTLE INSPIRATION</p><h2 id="explore-heading">Explore</h2></div></div>
      <div className="explore-content" aria-label="Explore posts">
        <ContentFeed />
      </div>
    </section>}
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
  const [listType, setListType] = useState('');
  const [people, setPeople] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [cursor, setCursor] = useState(null);
  const [form, setForm] = useState({ username: '', displayName: '', bio: '', avatarMediaId: '' });
  const [activeContentTab, setActiveContentTab] = useState('posts');
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
    if (editOnOpen && isOwn) setEditOpen(true);
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
      setProfile((current) => ({ ...current, ...result.user }));
      setUser(result.user);
      setEditOpen(false);
    } catch (reason) {
      setEditError(reason.message || 'Could not save your profile.');
    } finally {
      setBusy(false);
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
    setActiveContentTab(nextTab);
    document.getElementById(`profile-tab-${nextTab}`)?.focus();
  }

  if (loading) return <div className="page-content"><Skeleton rows={4} /></div>;
  if (error && !profile) return <div className="page-content"><ErrorState error={error} onRetry={() => loadProfile()} /></div>;
  if (!profile) return null;

  return <div className="page-content profile-page">
    <header className="profile-header">
      <Avatar name={profile.displayName} src={profile.avatarUrl} size="profile" />
      <div className="profile-info">
        <div className="profile-title"><h1>{profile.username}</h1>{isOwn
          ? <><button className="button button--outline" onClick={() => setEditOpen(true)}>Edit profile</button><button className="button button--outline" onClick={() => setEditOpen(true)}>Edit photo</button></>
          : <><button className={`button ${profile.isFollowing ? 'button--outline' : 'button--primary'}`} onClick={toggleFollow} disabled={busy}>{profile.isFollowing ? 'Following' : 'Follow'}</button><button className="button button--outline" onClick={messageUser}>Message</button></>}
          <button className="button button--outline profile-share-button" onClick={shareProfile} aria-label="Share profile"><Share2 size={15} /><span>Share</span></button>
        </div>
        <div className="profile-counts">
            <span><b>{profile.postsCount ?? '—'}</b> posts</span>
          <button onClick={() => openList('followers')}><b>{profile.followersCount || 0}</b> followers</button>
          <button onClick={() => openList('following')}><b>{profile.followingCount || 0}</b> following</button>
        </div>
        <div className="profile-bio"><strong>{profile.displayName}</strong>{profile.bio && <p>{profile.bio}</p>}</div>
      </div>
    </header>
    {error && <p className="inline-error">{error}</p>}
    {shareMessage && <p className="profile-share-status" role="status">{shareMessage}</p>}
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
          onClick={() => setActiveContentTab(tab)}
        >
          {tab === 'posts' ? <Grid3X3 size={15} /> : tab === 'reels' ? <Clapperboard size={15} /> : tab === 'saved' ? <Bookmark size={15} /> : <UserRound size={15} />}
          {tab.toUpperCase()}
        </button>)}
      </div>
      <div id={`profile-panel-${activeContentTab}`} role="tabpanel" aria-labelledby={`profile-tab-${activeContentTab}`} tabIndex={0}>
        {activeContentTab === 'posts'
          ? <ContentFeed key={`${profile.id}-posts`} userId={profile.id} layout="grid" />
          : activeContentTab === 'reels'
            ? <ContentFeed key={`${profile.id}-reels`} kind="reels" userId={profile.id} layout="grid" />
            : activeContentTab === 'saved'
              ? <ContentFeed key={`${profile.id}-saved`} kind="saved" layout="grid" />
              : <ContentFeed key={`${profile.id}-tagged`} kind="tagged" userId={profile.id} layout="grid" />}
      </div>
    </div>
    {editOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditOpen(false); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title">
        <header className="modal-header"><h2 id="edit-profile-title">Edit profile</h2><button className="icon-button" onClick={() => setEditOpen(false)} aria-label="Close">×</button></header>
        <form className="form-stack" onSubmit={saveProfile}>
          <label>Display name<input maxLength="80" required value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label>Username<input minLength="3" maxLength="30" pattern="(?!.*\\.\\.)[a-zA-Z0-9._]{3,30}" required value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} /></label>
          <label>Bio<textarea maxLength="500" rows="3" value={form.bio} onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))} /><small>{form.bio.length}/500 characters</small></label>
          <label>Profile photo</label>
          {profile.avatarUrl && form.avatarMediaId !== null && <button type="button" className="text-link" onClick={() => setForm((current) => ({ ...current, avatarMediaId: null }))}>Remove current photo</button>}
          <MediaUploader purpose="profile" onReady={(media) => setForm((current) => ({ ...current, avatarMediaId: media?.id || '' }))} />
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
  return <div className="page-content settings-page">
    <header className="page-heading"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Settings</h1><p className="heading-subtitle">Manage the CliQHeart experience.</p></div></header>
    <section className="settings-card"><div className="settings-account"><Avatar name={user?.displayName} src={user?.avatarUrl} size="large" /><span><b>{user?.displayName}</b><small>@{user?.username}</small></span><Link to="/profile" className="text-link">View profile</Link></div></section>
    <section className="settings-card"><div className="settings-section-head"><div><h2>Appearance</h2><p>Choose how CliQHeart looks on this device.</p></div></div><div className="theme-options"><button className={theme === 'light' ? 'is-selected' : ''} onClick={() => changeTheme('light')}>Light</button><button className={theme === 'dark' ? 'is-selected' : ''} onClick={() => changeTheme('dark')}>Dark</button></div></section>
    <section className="settings-card"><div className="settings-section-head"><div><h2>Account session</h2><p>Sign out of this browser session.</p></div><button className="button button--outline" onClick={logout}>Log out</button></div><p className="security-note"><ShieldCheck size={16} /> Access token remains in memory only and is cleared when you sign out or close the page.</p></section>
    <section className="settings-card"><div className="settings-section-head"><div><h2>Privacy & account</h2><p>Account controls are enforced by the shared CliQHeart API.</p></div></div><p className="helper-text">Email, phone number, and account status are not displayed in public profile screens.</p></section>
  </div>;
}

export function CapabilityPage({ title, feature }) {
  return <div className="page-content capability-page"><header className="page-heading"><div><p className="eyebrow">COMING INTO FOCUS</p><h1>{title}</h1><p className="heading-subtitle">A genuine feature, not a placeholder feed.</p></div></header><EmptyState title={`${feature} is not available yet`} description="The current shared API does not provide this capability. We have not added sample content or a pretend action. Your existing CliQHeart account and profile still work here." icon={Sparkles} /><Link to="/search" className="button button--primary"><Search size={16} /> Find people instead</Link></div>;
}

export function CreatePage() {
  const [kind, setKind] = useState('post');
  const [media, setMedia] = useState(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();
  const reelTooLong = kind === 'reel' && media?.duration > 180;

  async function changeKind(nextKind) {
    if (busy || nextKind === kind) return;
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
    setError('');
    setSuccess('');
    setKind(nextKind);
  }

  async function publish(event) {
    event.preventDefault();
    if (!media?.id || busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const payload = { mediaId: media.id, caption: caption.trim() };
      if (kind === 'post') await contentApi.createPost(payload);
      else if (kind === 'story') await contentApi.createStory(payload);
      else await contentApi.createReel(payload);
      setSuccess(kind === 'story' ? 'Your story is live for 24 hours.' : 'Your content has been published.');
      setMedia(null);
      navigate(kind === 'reel' ? '/reels' : '/', { replace: true });
    } catch (reason) {
      setError(reason.message || 'Could not publish your content.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="page-content create-page">
    <header className="page-heading"><div><p className="eyebrow">MAKE A MOMENT</p><h1>Create</h1><p className="heading-subtitle">Share something with your CliQHeart community.</p></div></header>
    <div className="content-mode-tabs" role="tablist" aria-label="Content type">
      {['post', 'story', 'reel'].map((option) => <button
        type="button"
        role="tab"
        aria-selected={kind === option}
        className={kind === option ? 'is-selected' : ''}
        disabled={busy}
        key={option}
        onClick={() => changeKind(option)}
      >{option[0].toUpperCase() + option.slice(1)}</button>)}
    </div>
    <form className="create-form" onSubmit={publish}>
      <MediaUploader key={kind} purpose={kind} onReady={setMedia} disabled={busy} />
      <label>Caption<textarea rows="4" maxLength={kind === 'story' ? 500 : 2200} value={caption} onChange={(event) => setCaption(event.target.value)} disabled={busy} /></label>
      {kind === 'reel' && <p className="helper-text">Reels must be videos no longer than 180 seconds.</p>}
      {reelTooLong && <p className="form-error" role="alert">This video is longer than the 180-second Reel limit.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {success && <p className="form-success" role="status">{success}</p>}
      <button className="button button--primary button--wide" disabled={busy || !media?.id || reelTooLong}>{busy ? 'Publishing…' : kind === 'story' ? 'Share story' : 'Publish'}</button>
    </form>
  </div>;
}

export function ReelsPage() {
  return <div className="page-content reels-page">
    <header className="page-heading"><div><p className="eyebrow">SHORT VIDEOS</p><h1>Reels</h1><p className="heading-subtitle">Discover video moments from the CliQHeart community.</p></div><Link className="button button--primary" to="/create">Create a Reel</Link></header>
    <ContentFeed kind="reels" />
  </div>;
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
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
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
          setSaved(Boolean(result[kind]?.isSaved));
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

  async function toggleSaved() {
    if (!item || kind !== 'post' || saveBusy) return;
    setSaveBusy(true);
    setActionError('');
    try {
      const nextSaved = !saved;
      if (nextSaved) await contentApi.savePost(item.id);
      else await contentApi.unsavePost(item.id);
      setSaved(nextSaved);
    } catch (reason) {
      setActionError(reason.message || 'Could not update the saved post.');
    } finally {
      setSaveBusy(false);
    }
  }

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
      await contentApi.tagUser(item.id, person.id);
      setTagStatus(`@${person.username} was tagged in this post.`);
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
  return <article className="page-content content-detail">
    <header className="content-card-header">
      <Link to={`/profile/${item.owner.id}`} className="content-card-owner">
        <Avatar name={item.owner.displayName} src={item.owner.avatarUrl} size="small" />
        <span><strong>{item.owner.displayName}</strong><small>@{item.owner.username}</small></span>
      </Link>
      <div className="content-card-actions">
        {kind === 'post' && <button className={`content-bookmark-button${saved ? ' is-saved' : ''}`} onClick={toggleSaved} disabled={saveBusy} aria-label={saved ? 'Remove saved post' : 'Save post'}>
          <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>}
        <Link to={`/profile/${item.owner.id}`} className="text-link">View profile</Link>
      </div>
    </header>
    <div className="content-detail-media">
      {isVideo
        ? <video src={item.media.secureUrl} poster={item.media.thumbnailUrl} controls playsInline preload="metadata" />
        : <img src={item.media?.secureUrl || item.media?.thumbnailUrl} alt={item.caption || 'Shared CliQHeart media'} />}
    </div>
    {item.caption && <p className="content-card-caption"><strong>@{item.owner.username}</strong> {item.caption}</p>}
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
