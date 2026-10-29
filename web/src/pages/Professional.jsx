import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BarChart3, BriefcaseBusiness, Megaphone, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorState } from '../components/Feedback.jsx';
import { contentApi, professionalApi } from '../services/api.js';

const categories = [
  ['DIGITAL_CREATOR', 'Digital creator'],
  ['GAMING_CREATOR', 'Gaming creator'],
  ['ARTIST', 'Artist'],
  ['MUSICIAN', 'Musician'],
  ['BLOGGER', 'Blogger'],
  ['PUBLIC_FIGURE', 'Public figure'],
  ['EDUCATION', 'Education'],
  ['CLOTHING_BRAND', 'Clothing brand'],
  ['RETAIL', 'Retail'],
  ['RESTAURANT', 'Restaurant'],
  ['TECHNOLOGY', 'Technology'],
  ['BEAUTY_WELLNESS', 'Beauty & wellness'],
  ['PROFESSIONAL_SERVICES', 'Professional services'],
  ['OTHER', 'Other'],
];

const steps = ['type', 'category', 'profile', 'confirmation'];

export function ProfessionalOnboardingPage() {
  const { updateUser } = useAuth();
  const navigate = useNavigate();
  const [professional, setProfessional] = useState(null);
  const [step, setStep] = useState('type');
  const [accountType, setAccountType] = useState('CREATOR');
  const [category, setCategory] = useState('DIGITAL_CREATOR');
  const [profile, setProfile] = useState({
    businessEmail: '',
    contactPhone: '',
    website: '',
    businessAddress: '',
    displayContactInfo: false,
    showProfessionalLabel: true,
  });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submissionLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    professionalApi.me({ signal: controller.signal }).then(({ professional: result }) => {
      setProfessional(result);
      const draft = result.onboardingDraft;
      if (!draft) return;
      if (draft.accountType) setAccountType(draft.accountType);
      if (draft.category) setCategory(draft.category);
      if (draft.profile) setProfile((current) => ({ ...current, ...draft.profile }));
      setConfirmed(draft.confirmPublicProfile === true);
      const lastComplete = draft.confirmPublicProfile
        ? 'confirmation'
        : draft.profile
          ? 'confirmation'
          : draft.category
            ? 'profile'
            : draft.accountType
              ? 'category'
              : 'type';
      setStep(lastComplete);
    }).catch((reason) => {
      if (reason.name !== 'AbortError') setError(reason.message || 'Could not load professional setup.');
    });
    return () => controller.abort();
  }, []);

  async function saveAndContinue(event) {
    event.preventDefault();
    if (submissionLock.current || !['CREATOR', 'BUSINESS'].includes(accountType)) return;
    submissionLock.current = true;
    setBusy(true);
    setError('');
    try {
      if (step === 'confirmation') {
        await professionalApi.saveOnboardingStep({ step, confirmPublicProfile: confirmed });
        const result = await professionalApi.convert({ confirmPublicProfile: true });
        setProfessional(result.professional);
        updateUser({ accountType: result.professional.accountType, professionalCategory: result.professional.category });
        navigate('/professional', { replace: true });
        return;
      }
      const body = step === 'type'
        ? { step, accountType }
        : step === 'category'
          ? { step, category }
          : { step, profile: cleanProfile(profile) };
      const result = await professionalApi.saveOnboardingStep(body);
      setProfessional(result.professional);
      setStep(steps[steps.indexOf(step) + 1]);
    } catch (reason) {
      setError(reason.message || 'Could not save your progress. Try again.');
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }

  return <main className="page-content professional-page">
    <Link className="professional-back-link" to="/settings"><ArrowLeft size={16} /> Settings</Link>
    <header className="page-heading"><div><p className="eyebrow">PROFESSIONAL ACCOUNT</p><h1>Set up your professional profile</h1><p className="heading-subtitle">Your existing CliQHeart identity and connections stay with you.</p></div></header>
    <section className="settings-card professional-onboarding">
      <div className="professional-step-indicator" aria-label={`Step ${steps.indexOf(step) + 1} of ${steps.length}`}>
        {steps.map((item, index) => <span className={index <= steps.indexOf(step) ? 'is-current' : ''} key={item} />)}
      </div>
      <form className="form-stack" onSubmit={saveAndContinue}>
        {step === 'type' && <>
          <h2>Choose an account type</h2>
          <p className="helper-text">Select the tools that fit how you use CliQHeart. You can switch back later.</p>
          <div className="professional-type-options">
            {['CREATOR', 'BUSINESS'].map((type) => <button
              className={`professional-type-card${accountType === type ? ' is-selected' : ''}`}
              key={type}
              onClick={() => setAccountType(type)}
              type="button"
              disabled={busy}
              aria-pressed={accountType === type}
            >
              {type === 'CREATOR' ? <Sparkles size={22} /> : <BriefcaseBusiness size={22} />}
              <b>{type === 'CREATOR' ? 'Creator' : 'Business'}</b>
              <span>{type === 'CREATOR' ? 'Understand how people find and engage with your content.' : 'Present your business and learn how your audience connects.'}</span>
            </button>)}
          </div>
        </>}
        {step === 'category' && <>
          <h2>What best describes you?</h2>
          <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        </>}
        {step === 'profile' && <>
          <h2>Add optional contact details</h2>
          <p className="helper-text">Contact details remain private unless you turn on public contact display below.</p>
          <label>Business email<input type="email" maxLength="254" value={profile.businessEmail} onChange={(event) => setProfile({ ...profile, businessEmail: event.target.value })} /></label>
          <label>Contact phone<input type="tel" placeholder="+12025550123" value={profile.contactPhone} onChange={(event) => setProfile({ ...profile, contactPhone: event.target.value })} /></label>
          <label>Website<input type="url" placeholder="https://" value={profile.website} onChange={(event) => setProfile({ ...profile, website: event.target.value })} /></label>
          <label>Business address<input maxLength="300" value={profile.businessAddress} onChange={(event) => setProfile({ ...profile, businessAddress: event.target.value })} /></label>
          <label className="professional-checkbox"><input type="checkbox" checked={profile.displayContactInfo} onChange={(event) => setProfile({ ...profile, displayContactInfo: event.target.checked })} /><span>Display the contact details I provided on my profile</span></label>
          <label className="professional-checkbox"><input type="checkbox" checked={profile.showProfessionalLabel} onChange={(event) => setProfile({ ...profile, showProfessionalLabel: event.target.checked })} /><span>Show the professional account label</span></label>
        </>}
        {step === 'confirmation' && <>
          <h2>Review before switching</h2>
          <p className="professional-notice"><b>Professional profile discoverability</b><br />Professional account features are intended for profiles that can be discovered. CliQHeart does not currently have private-account settings; this step does not change a privacy setting.</p>
          <p className="professional-notice">Your account identity, posts, messages, and followers stay on the same account. Existing profile details are preserved.</p>
          <label className="professional-checkbox"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required /><span>I understand and want to switch this account to {accountType === 'CREATOR' ? 'Creator' : 'Business'}.</span></label>
        </>}
        {error && <ErrorState error={error} />}
        <div className="professional-form-actions">
          {step !== 'type' && <button className="button button--outline" type="button" disabled={busy} onClick={() => setStep(steps[steps.indexOf(step) - 1])}><ArrowLeft size={15} /> Back</button>}
          <button className="button button--primary" disabled={busy || !['CREATOR', 'BUSINESS'].includes(accountType) || (step === 'confirmation' && !confirmed)}>{busy ? 'Saving…' : step === 'confirmation' ? 'Switch account type' : 'Save and continue'} <ArrowRight size={15} /></button>
        </div>
      </form>
    </section>
  </main>;
}

export function ProfessionalDashboardPage() {
  const { user, updateUser } = useAuth();
  const [days, setDays] = useState('30');
  const [analytics, setAnalytics] = useState(null);
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');
  const [profileForm, setProfileForm] = useState({
    businessEmail: '',
    contactPhone: '',
    website: '',
    businessAddress: '',
    displayContactInfo: false,
    showProfessionalLabel: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    Promise.all([
      professionalApi.dashboard(days, { signal: controller.signal }),
      professionalApi.me({ signal: controller.signal }),
    ]).then(([dashboard, result]) => {
      setAnalytics(dashboard.analytics);
      setProfile(result.professional);
      setProfileForm((current) => ({ ...current, ...(result.professional.profile ?? {}) }));
      updateUser({ accountType: result.professional.accountType, professionalCategory: result.professional.category });
      setError('');
    }).catch((reason) => {
      if (reason.name !== 'AbortError') setError(reason.message || 'Could not load your professional dashboard.');
    }).finally(() => setBusy(false));
    return () => controller.abort();
  }, [days, reloadKey, updateUser]);

  const chartRows = useMemo(() => {
    const map = new Map();
    for (const event of analytics?.dailyUniqueEvents ?? []) {
      const row = map.get(event.day) ?? { day: event.day, views: 0, follows: 0, unfollows: 0 };
      if (['profile_view', 'post_view', 'reel_view'].includes(event.event)) row.views += event.count;
      if (event.event === 'follow') row.follows += event.count;
      if (event.event === 'unfollow') row.unfollows += event.count;
      map.set(event.day, row);
    }
    return [...map.values()];
  }, [analytics]);

  async function switchToPersonal() {
    if (switchBusy || !window.confirm('Switch back to a personal account? Your content and connections will remain.')) return;
    setSwitchBusy(true);
    setError('');
    try {
      const result = await professionalApi.switchToPersonal();
      updateUser({ accountType: result.professional.accountType, professionalCategory: null });
      window.location.assign('/settings');
    } catch (reason) {
      setError(reason.message || 'Could not switch account type.');
    } finally {
      setSwitchBusy(false);
    }
  }

  async function saveProfessionalProfile(event) {
    event.preventDefault();
    if (profileSaving) return;
    setProfileSaving(true);
    setError('');
    setProfileNotice('');
    try {
      const result = await professionalApi.updateProfile(profileForm);
      setProfile(result.professional);
      setProfileNotice('Professional profile settings saved.');
    } catch (reason) {
      setError(reason.message || 'Could not save your professional profile settings.');
    } finally {
      setProfileSaving(false);
    }
  }

  if (busy && !analytics) return <main className="page-content professional-page"><div className="page-loading"><span /></div></main>;
  return <main className="page-content professional-page">
    <header className="page-heading professional-heading">
      <div><p className="eyebrow">PROFESSIONAL DASHBOARD</p><h1>Welcome, {user?.displayName}</h1><p className="heading-subtitle">{profile?.accountType === 'BUSINESS' ? 'Business' : 'Creator'} account · {categoryLabel(profile?.category)}</p></div>
      <Link to="/professional/promotions" className="button button--outline"><Megaphone size={16} /> Promotion drafts</Link>
    </header>
    <nav className="professional-quick-links" aria-label="Professional tools">
      <a href="#insights"><BarChart3 size={15} /> Insights</a>
      <a href="#professional-settings"><BriefcaseBusiness size={15} /> Edit professional profile</a>
      <Link to="/professional/promotions"><Megaphone size={15} /> Promotions</Link>
      <Link to="/settings">Professional settings</Link>
    </nav>
    {error && <ErrorState error={error} onRetry={() => setReloadKey((current) => current + 1)} />}
    {analytics && <>
      <section className="settings-card professional-completion">
        <div><p className="eyebrow">PROFILE SETUP</p><h2>{profile?.category ? 'Professional profile ready' : 'Continue professional setup'}</h2><p>{profile?.category ? `${profile.accountType === 'BUSINESS' ? 'Business' : 'Creator'} · ${categoryLabel(profile.category)}` : 'Choose a category to finish your professional profile.'}</p></div>
        <span className={profile?.category ? 'completion-status is-complete' : 'completion-status'}>{profile?.category ? 'Complete' : 'Incomplete'}</span>
      </section>
      <div className="professional-metrics">
        <Metric label="Followers" value={analytics.totals.followers} icon={<BarChart3 size={17} />} />
        <Metric label="Following" value={analytics.totals.following} icon={<BarChart3 size={17} />} />
        <Metric label="Posts" value={analytics.totals.posts} icon={<BarChart3 size={17} />} />
        <Metric label="Reels" value={analytics.totals.reels} icon={<BarChart3 size={17} />} />
      </div>
      <section className="settings-card" id="insights">
        <div className="settings-section-head"><div><h2>Audience and content activity</h2><p>{analytics.metricDefinition}</p></div><label className="analytics-range">Period<select value={days} onChange={(event) => setDays(event.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label></div>
        <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>UTC day</th><th>Unique viewer-days</th><th>Follows</th><th>Unfollows</th></tr></thead><tbody>{chartRows.map((row) => <tr key={row.day}><td>{row.day}</td><td>{row.views}</td><td>{row.follows}</td><td>{row.unfollows}</td></tr>)}</tbody></table>
          {chartRows.length === 0 && <p className="helper-text">No measured activity in this period yet. Views are recorded when signed-in users open your profile, posts, or reels.</p>}
        </div>
      </section>
      <section className="settings-card"><div className="settings-section-head"><div><h2>Most viewed content</h2><p>Unique signed-in viewers per UTC day. This is not ad reach or impression data.</p></div></div>
        {analytics.topContent.length ? <div className="professional-content-list">{analytics.topContent.map((item) => <div key={`${item.type}-${item.id}`}><span className="professional-content-type">{item.type}</span><b>{item.caption || 'Untitled content'}</b><span>{item.uniqueViewerDays} viewer-days</span></div>)}</div> : <p className="helper-text">Content analytics will appear after your content receives measured views.</p>}
      </section>
      <section className="settings-card" id="professional-settings">
        <h2>Professional profile settings</h2>
        <p className="helper-text">Contact details stay private unless public display is enabled.</p>
        <form className="form-stack" onSubmit={saveProfessionalProfile}>
          <label>Business email<input type="email" maxLength="254" value={profileForm.businessEmail} onChange={(event) => setProfileForm({ ...profileForm, businessEmail: event.target.value })} /></label>
          <label>Contact phone<input type="tel" placeholder="+12025550123" value={profileForm.contactPhone} onChange={(event) => setProfileForm({ ...profileForm, contactPhone: event.target.value })} /></label>
          <label>Website<input type="url" placeholder="https://" value={profileForm.website} onChange={(event) => setProfileForm({ ...profileForm, website: event.target.value })} /></label>
          <label>Business address<input maxLength="300" value={profileForm.businessAddress} onChange={(event) => setProfileForm({ ...profileForm, businessAddress: event.target.value })} /></label>
          <label className="professional-checkbox"><input type="checkbox" checked={profileForm.displayContactInfo} onChange={(event) => setProfileForm({ ...profileForm, displayContactInfo: event.target.checked })} /><span>Display contact details on my public profile</span></label>
          <label className="professional-checkbox"><input type="checkbox" checked={profileForm.showProfessionalLabel} onChange={(event) => setProfileForm({ ...profileForm, showProfessionalLabel: event.target.checked })} /><span>Show the professional account label</span></label>
          {profileNotice && <p className="professional-success" role="status">{profileNotice}</p>}
          <button className="button button--primary" disabled={profileSaving}>{profileSaving ? 'Saving…' : 'Save professional profile'}</button>
        </form>
      </section>
      <section className="settings-card"><div className="settings-section-head"><div><h2>Account type</h2><p>Your CliQHeart account identity and existing content stay in place if you switch back.</p></div><button className="button button--outline" disabled={switchBusy} onClick={switchToPersonal}>{switchBusy ? 'Switching…' : 'Switch to personal'}</button></div></section>
    </>}
  </main>;
}

export function ProfessionalPromotionsPage() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [posts, setPosts] = useState([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({
    name: '',
    objective: 'AWARENESS',
    postId: '',
    dailyBudget: '5',
    startsAt: '',
    endsAt: '',
  });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      professionalApi.campaigns({ signal: controller.signal }),
      contentApi.userPosts(user.id, 50, { signal: controller.signal }),
    ]).then(([result, content]) => {
      setCampaigns(result.campaigns);
      setPosts(content.posts ?? []);
      setError('');
    }).catch((reason) => {
      if (reason.name !== 'AbortError') setError(reason.message || 'Could not load promotion drafts.');
    }).finally(() => setBusy(false));
    return () => controller.abort();
  }, [user.id]);

  async function createDraft(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const body = {
        name: form.name,
        objective: form.objective,
        dailyBudgetMinor: Math.round(Number(form.dailyBudget) * 100),
        currency: 'USD',
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      };
      if (editingId) {
        const result = await professionalApi.updateCampaign(editingId, { ...body, postId: form.postId || null });
        setCampaigns((current) => current.map((campaign) => campaign.id === editingId ? result.campaign : campaign));
        setEditingId('');
      } else {
        const result = await professionalApi.createCampaign({ ...body, ...(form.postId ? { postId: form.postId } : {}) });
        setCampaigns((current) => [result.campaign, ...current]);
      }
      setForm({ name: '', objective: 'AWARENESS', postId: '', dailyBudget: '5', startsAt: '', endsAt: '' });
      setNotice('Promotion saved as a draft. It is not paid, approved, or running.');
    } catch (reason) {
      setError(reason.message || 'Could not save the promotion draft.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft(id) {
    try {
      await professionalApi.deleteCampaign(id);
      setCampaigns((current) => current.filter((campaign) => campaign.id !== id));
    } catch (reason) {
      setError(reason.message || 'Could not delete the promotion draft.');
    }
  }

  function editDraft(campaign) {
    setEditingId(campaign.id);
    setForm({
      name: campaign.name,
      objective: campaign.objective,
      postId: campaign.postId || '',
      dailyBudget: (campaign.dailyBudgetMinor / 100).toFixed(2),
      startsAt: toLocalDateTime(campaign.startsAt),
      endsAt: toLocalDateTime(campaign.endsAt),
    });
    setNotice('');
    setError('');
  }

  return <main className="page-content professional-page">
    <Link className="professional-back-link" to="/professional"><ArrowLeft size={16} /> Dashboard</Link>
    <header className="page-heading"><div><p className="eyebrow">PROMOTIONS</p><h1>Promotion drafts</h1><p className="heading-subtitle">Prepare campaign details without starting a payment or ad delivery.</p></div></header>
    <p className="professional-notice"><b>Drafts only:</b> CliQHeart does not currently have a payment provider, campaign approval, or ad-delivery system. Saving a draft does not charge your account or start a promotion.</p>
    <section className="settings-card">
      <h2>Create a promotion draft</h2>
      <form className="form-stack" onSubmit={createDraft}>
        <label>Draft name<input maxLength="100" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>Goal<select value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })}><option value="AWARENESS">Awareness</option><option value="PROFILE_VISITS">Profile visits</option><option value="ENGAGEMENT">Engagement</option></select></label>
        <label>Post (optional)<select value={form.postId} onChange={(event) => setForm({ ...form, postId: event.target.value })}><option value="">No post selected</option>{posts.map((post) => <option key={post.id} value={post.id}>{post.caption || 'Untitled post'}</option>)}</select></label>
        <label>Proposed daily budget (USD)<input type="number" min="1" max="1000000" step="0.01" required value={form.dailyBudget} onChange={(event) => setForm({ ...form, dailyBudget: event.target.value })} /></label>
        <div className="form-two-columns"><label>Proposed start<input type="datetime-local" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label><label>Proposed end<input type="datetime-local" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label></div>
        {error && <ErrorState error={error} />}{notice && <p className="professional-success" role="status">{notice}</p>}
        <div className="professional-form-actions">
          {editingId && <button className="button button--outline" type="button" disabled={saving} onClick={() => { setEditingId(''); setForm({ name: '', objective: 'AWARENESS', postId: '', dailyBudget: '5', startsAt: '', endsAt: '' }); }}>Cancel edit</button>}
          <button className="button button--primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update draft' : 'Save draft'} <ArrowRight size={15} /></button>
        </div>
      </form>
    </section>
    <section className="settings-card"><h2>Saved drafts</h2>{busy ? <p className="helper-text">Loading drafts…</p> : campaigns.length ? <div className="professional-campaign-list">{campaigns.map((campaign) => <article key={campaign.id}><div><b>{campaign.name}</b><p>{campaign.objective.replaceAll('_', ' ').toLowerCase()} · ${((campaign.dailyBudgetMinor || 0) / 100).toFixed(2)} / day</p><small>{new Date(campaign.startsAt).toLocaleDateString()} – {new Date(campaign.endsAt).toLocaleDateString()} · Draft only</small></div><div className="professional-campaign-actions"><button className="button button--outline" onClick={() => editDraft(campaign)}>Edit</button><button className="button button--outline" onClick={() => deleteDraft(campaign.id)}>Delete</button></div></article>)}</div> : <p className="helper-text">No promotion drafts yet.</p>}</section>
  </main>;
}

function Metric({ label, value, icon }) {
  return <section className="settings-card professional-metric">{icon}<span>{label}</span><b>{value.toLocaleString()}</b></section>;
}

function cleanProfile(value) {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) =>
    typeof item === 'boolean' || item.trim() !== '',
  ));
}

function categoryLabel(value) {
  return categories.find(([key]) => key === value)?.[1] ?? 'Professional account';
}

function toLocalDateTime(value) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
