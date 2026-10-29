import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Heart, Play } from 'lucide-react';
import { Avatar } from './Brand.jsx';
import { EmptyState, ErrorState, RetryButton, Skeleton } from './Feedback.jsx';
import { contentApi, userApi } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export function ContentFeed({
  kind = 'posts',
  userId,
  layout = 'feed',
  showSuggestedLabels = false,
  includeReels = false,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [nextReelCursor, setNextReelCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      if (includeReels && kind === 'posts' && !userId) {
        const [postResult, reelResult] = await Promise.all([
          contentApi.posts(30, { signal }),
          contentApi.reels(30, { signal }),
        ]);
        if (signal?.aborted) return;
        const feedItems = [
          ...(postResult.posts || []).map((item) => ({ ...item, feedType: 'posts' })),
          ...(reelResult.reels || []).map((item) => ({ ...item, feedType: 'reels' })),
        ].sort((first, second) =>
          new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime());
        setItems(feedItems);
        setNextCursor(postResult.nextCursor || null);
        setNextReelCursor(reelResult.nextCursor || null);
        return;
      }
      const result = kind === 'saved'
        ? await userApi.savedPosts({ signal })
        : kind === 'tagged'
          ? await userApi.taggedPosts(userId, { signal })
          : userId
        ? kind === 'reels'
          ? await contentApi.userReels(userId, 30, { signal })
          : await contentApi.userPosts(userId, 30, { signal })
        : kind === 'reels'
          ? await contentApi.reels(30, { signal })
          : await contentApi.posts(30, { signal });
      if (signal?.aborted) return;
      const nextItems = result[kind] || result.posts || [];
      setItems(nextItems);
      setNextCursor(result.nextCursor || null);
      setNextReelCursor(null);
    } catch (reason) {
      if (signal?.aborted || reason.name === 'AbortError') return;
      setError(reason.message || 'Could not load content.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [includeReels, kind, userId]);

  async function loadMore() {
    if (loadingMore) return;
    if (includeReels && kind === 'posts' && (nextCursor || nextReelCursor)) {
      setLoadingMore(true);
      setMoreError('');
      try {
        const [postResult, reelResult] = await Promise.all([
          nextCursor ? contentApi.posts(30, { after: nextCursor }) : Promise.resolve(null),
          nextReelCursor ? contentApi.reels(30, { after: nextReelCursor }) : Promise.resolve(null),
        ]);
        const additions = [
          ...(postResult?.posts || []).map((item) => ({ ...item, feedType: 'posts' })),
          ...(reelResult?.reels || []).map((item) => ({ ...item, feedType: 'reels' })),
        ];
        setItems((current) => {
          const ids = new Set(current.map((item) => `${item.feedType || kind}:${item.id}`));
          return [...current, ...additions.filter((item) =>
            !ids.has(`${item.feedType}:${item.id}`))].sort((first, second) =>
            new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime());
        });
        if (postResult) setNextCursor(postResult.nextCursor || null);
        if (reelResult) setNextReelCursor(reelResult.nextCursor || null);
      } catch (reason) {
        setMoreError(reason.message || 'Could not load more content.');
      } finally {
        setLoadingMore(false);
      }
      return;
    }
    if (!nextCursor || !['posts', 'saved', 'tagged', 'reels'].includes(kind)) return;
    setLoadingMore(true);
    setMoreError('');
    try {
      const result = kind === 'posts'
        ? await contentApi.posts(30, { after: nextCursor })
        : kind === 'reels'
          ? await contentApi.reels(30, { after: nextCursor })
        : kind === 'saved'
        ? await userApi.savedPosts({ after: nextCursor })
        : await userApi.taggedPosts(userId, { after: nextCursor });
      const nextItems = result[kind] || result.posts || [];
      setItems((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...current, ...nextItems.filter((item) => !ids.has(item.id))];
      });
      setNextCursor(result.nextCursor || null);
    } catch (reason) {
      setMoreError(reason.message || 'Could not load more content.');
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading) return <Skeleton rows={3} />;
  if (error) return <ErrorState error={error} onRetry={() => load()} />;
  if (items.length === 0) {
    return <EmptyState
      title={kind === 'saved' ? 'No saved posts yet' : kind === 'tagged' ? 'No tagged posts yet' : kind === 'reels' ? 'No Reels to show yet' : 'No posts to show yet'}
      description={kind === 'saved'
        ? 'Posts you save will appear here.'
        : kind === 'tagged'
          ? 'Posts this person is tagged in will appear here.'
          : userId
        ? `Published ${kind === 'reels' ? 'Reels' : 'posts'} from this profile will appear here.`
        : 'Follow people and share a post to get started.'}
      icon={kind === 'reels' ? Play : Heart}
    />;
  }
  return <>
    <div className={`content-feed${kind === 'reels' ? ' content-feed--reels' : ''}${layout === 'grid' ? ' content-feed--grid' : ''}`}>
    {items.map((item) => <ContentCard
      key={`${item.feedType || kind}:${item.id}`}
      item={item}
      layout={layout}
      kind={item.feedType || kind}
      showSuggestedLabel={showSuggestedLabels}
      onSavedChange={(saved) => {
        setItems((current) => kind === 'saved' && !saved
          ? current.filter((entry) => entry.id !== item.id)
          : current.map((entry) => entry.id === item.id ? { ...entry, isSaved: saved } : entry));
      }}
      onTaggedChange={(tagged) => {
        if (!tagged) setItems((current) => current.filter((entry) => entry.id !== item.id));
      }}
    />)}
    </div>
    {moreError && <p className="inline-error" role="alert">{moreError} <RetryButton error={moreError} onRetry={loadMore} className="text-link" label="Retry" /></p>}
    {(nextCursor || nextReelCursor) && ['posts', 'saved', 'tagged', 'reels'].includes(kind) && <button className="button button--outline load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
  </>;
}

export function StoryFeed() {
  const { user } = useAuth();
  const [stories, setStories] = useState([]);
  const [activeGroupIndex, setActiveGroupIndex] = useState(-1);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [viewedStoryIds, setViewedStoryIds] = useState(() => new Set());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const result = await contentApi.stories({ signal });
      if (signal?.aborted) return;
      setStories(result.stories || []);
    } catch (reason) {
      if (signal?.aborted || reason.name === 'AbortError') return;
      setError(reason.message || 'Could not load stories.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const groupedStories = [...stories.reduce((groups, story) => {
    const ownerId = story.owner?.id;
    if (!ownerId) return groups;
    const group = groups.get(ownerId) || { owner: story.owner, stories: [] };
    group.stories.push(story);
    groups.set(ownerId, group);
    return groups;
  }, new Map()).values()].sort((first, second) =>
    Number(second.owner.id === user?.id) - Number(first.owner.id === user?.id));

  const activeGroup = groupedStories[activeGroupIndex];
  const activeStory = activeGroup?.stories[activeStoryIndex];
  const advanceStory = useCallback((direction) => {
    if (!activeGroup) return;
    let nextGroupIndex = activeGroupIndex;
    let nextStoryIndex = activeStoryIndex + direction;
    if (nextStoryIndex >= activeGroup.stories.length) {
      nextGroupIndex += 1;
      nextStoryIndex = 0;
    } else if (nextStoryIndex < 0) {
      nextGroupIndex -= 1;
      nextStoryIndex = groupedStories[nextGroupIndex]?.stories.length - 1;
    }
    if (nextGroupIndex < 0 || nextGroupIndex >= groupedStories.length || nextStoryIndex < 0) {
      setActiveGroupIndex(-1);
      return;
    }
    setActiveGroupIndex(nextGroupIndex);
    setActiveStoryIndex(nextStoryIndex);
    const story = groupedStories[nextGroupIndex]?.stories[nextStoryIndex];
    if (story) setViewedStoryIds((current) => new Set([...current, story.id]));
  }, [activeGroup, activeGroupIndex, activeStoryIndex, groupedStories]);
  useEffect(() => {
    if (!activeGroup) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setActiveGroupIndex(-1);
      if (event.key === 'ArrowRight') advanceStory(1);
      if (event.key === 'ArrowLeft') advanceStory(-1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeGroup, advanceStory]);

  const openStory = (groupIndex) => {
    setActiveGroupIndex(groupIndex);
    setActiveStoryIndex(0);
    const firstStory = groupedStories[groupIndex]?.stories[0];
    if (firstStory) setViewedStoryIds((current) => new Set([...current, firstStory.id]));
  };
  return <>
    <section className="home-stories" aria-label="Stories">
      <div className="home-stories-strip">
        <Link className="home-story home-story--create" to="/create?kind=story" aria-label="Create a story">
          <span className="home-story-ring"><Avatar name={user?.displayName} src={user?.avatarUrl} size="large" /><span className="home-story-plus">+</span></span>
          <span>Your story</span>
        </Link>
        {loading && <div className="home-story-loading"><Skeleton rows={1} /></div>}
        {!loading && error && <div className="home-story-error" role="status">{error} <RetryButton error={error} onRetry={() => load()} className="text-link" label="Retry" /></div>}
        {!loading && !error && groupedStories.map((group, index) => {
          const seen = group.stories.every((story) => viewedStoryIds.has(story.id));
          return <button className="home-story" type="button" key={group.owner.id} onClick={() => openStory(index)}>
            <span className={`home-story-ring${seen ? ' is-viewed' : ''}`}>
              <Avatar
                name={group.owner.displayName}
                src={group.owner.id === user?.id ? user.avatarUrl : group.owner.avatarUrl}
                size="large"
              />
            </span>
            <span>{group.owner.id === user?.id ? 'Your story' : `@${group.owner.username}`}</span>
          </button>;
        })}
        {!loading && !error && groupedStories.length === 0 && <p className="home-story-empty">Stories from people you follow will appear here.</p>}
      </div>
    </section>
    {activeGroup && <div className="story-viewer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setActiveGroupIndex(-1);
    }}>
      <section className="story-viewer" role="dialog" aria-modal="true" aria-label={`Stories from @${activeGroup.owner.username}`}>
        <button className="story-viewer-close" type="button" onClick={() => setActiveGroupIndex(-1)} aria-label="Close stories">×</button>
        <div className="story-viewer-owner">
          <Avatar name={activeGroup.owner.displayName} src={activeGroup.owner.id === user?.id ? user.avatarUrl : activeGroup.owner.avatarUrl} size="small" />
          <span>@{activeGroup.owner.username}</span>
        </div>
        {activeStory && <article className="story-viewer-item" key={activeStory.id}>
          {activeStory.media?.resourceType === 'video'
            ? <video src={activeStory.media.secureUrl} poster={activeStory.media.thumbnailUrl} controls playsInline preload="metadata" />
            : <img src={activeStory.media?.secureUrl || activeStory.media?.thumbnailUrl} alt={activeStory.caption || `Story from ${activeGroup.owner.username}`} />}
          {activeStory.caption && <p>{activeStory.caption}</p>}
        </article>}
        {activeGroupIndex > 0 || activeStoryIndex > 0 ? <button className="story-viewer-nav story-viewer-nav--prev" type="button" onClick={() => advanceStory(-1)} aria-label="Previous story">‹</button> : null}
        <button className="story-viewer-nav story-viewer-nav--next" type="button" onClick={() => advanceStory(1)} aria-label="Next story">›</button>
      </section>
    </div>}
  </>;
}

function ContentCard({ item, layout, kind, showSuggestedLabel, onSavedChange, onTaggedChange }) {
  const { user } = useAuth();
  const ownerAvatarUrl = item.owner?.id === user?.id ? user.avatarUrl : item.owner?.avatarUrl;
  const isVideo = item.media?.resourceType === 'video';
  const [saved, setSaved] = useState(Boolean(item.isSaved));
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarkError, setBookmarkError] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState('');
  async function toggleSaved(event) {
    event.preventDefault();
    event.stopPropagation();
    if (bookmarkBusy) return;
    setBookmarkBusy(true);
    setBookmarkError('');
    try {
      const nextSaved = !saved;
      if (nextSaved) await contentApi.savePost(item.id);
      else await contentApi.unsavePost(item.id);
      setSaved(nextSaved);
      onSavedChange?.(nextSaved);
    } catch (reason) {
      setBookmarkError(reason.message || 'Could not update the saved post.');
    } finally {
      setBookmarkBusy(false);
    }
  }
  async function removeTag() {
    if (tagBusy) return;
    setTagBusy(true);
    setTagError('');
    try {
      await contentApi.removeMyTag(item.id);
      onTaggedChange?.(false);
    } catch (reason) {
      setTagError(reason.message || 'Could not remove your tag.');
    } finally {
      setTagBusy(false);
    }
  }
  if (layout === 'grid') {
    return <div className="content-grid-cell">
      <Link
        className="content-grid-item"
        to={`/${kind === 'reels' ? 'reel' : 'post'}/${item.id}`}
        aria-label={`View post by ${item.owner?.username || 'CliQHeart member'}${item.caption ? `: ${item.caption}` : ''}`}
      >
        <img src={item.media?.thumbnailUrl || item.media?.secureUrl} alt="" loading="lazy" />
        {isVideo && <span className="content-grid-video" aria-label="Video"><Play size={18} fill="currentColor" /></span>}
        <span className="content-grid-overlay">{item.caption || `Post by @${item.owner?.username || 'member'}`}</span>
      </Link>
      {kind !== 'reels' && <button className={`content-save-button${saved ? ' is-saved' : ''}`} onClick={toggleSaved} disabled={bookmarkBusy} aria-label={saved ? 'Remove saved post' : 'Save post'} title={saved ? 'Remove saved post' : 'Save post'}>
        <Bookmark size={17} fill={saved ? 'currentColor' : 'none'} />
      </button>}
      {kind === 'tagged' && <button className="content-untag-button" onClick={removeTag} disabled={tagBusy}>Remove tag</button>}
      {(bookmarkError || tagError) && <span className="content-action-error" role="alert">{bookmarkError || tagError}</span>}
    </div>;
  }
  return <article className="content-card">
    {showSuggestedLabel && item.owner?.id !== user?.id && !item.isFollowing && <div className="content-suggested-label">Suggested for you</div>}
    <header className="content-card-header">
      <Link to={`/profile/${item.owner?.id}`} className="content-card-owner">
        <Avatar name={item.owner?.displayName} src={ownerAvatarUrl} size="small" />
        <span><strong>{item.owner?.displayName || 'CliQHeart member'}</strong><small>@{item.owner?.username || 'member'}</small></span>
      </Link>
      <div className="content-card-actions">
        {item.createdAt && <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</time>}
        {kind !== 'reels' && <button className={`content-bookmark-button${saved ? ' is-saved' : ''}`} onClick={toggleSaved} disabled={bookmarkBusy} aria-label={saved ? 'Remove saved post' : 'Save post'} title={saved ? 'Remove saved post' : 'Save post'}>
          <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>}
      </div>
    </header>
    <div className="content-card-media">
      {isVideo
        ? <video src={item.media.secureUrl} poster={item.media.thumbnailUrl} controls preload="metadata" />
        : <img src={item.media?.secureUrl || item.media?.thumbnailUrl} alt={item.caption || 'Shared CliQHeart media'} loading="lazy" />}
      {isVideo && <span className="content-video-badge"><Play size={14} fill="currentColor" /> {kind === 'reels' ? 'Reel' : 'Video'}</span>}
    </div>
    {item.caption && <p className="content-card-caption"><strong>@{item.owner?.username}</strong> {item.caption}</p>}
    {bookmarkError && <p className="inline-error" role="alert">{bookmarkError}</p>}
  </article>;
}
