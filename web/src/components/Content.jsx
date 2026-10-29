import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, Heart, Play } from 'lucide-react';
import { Avatar } from './Brand.jsx';
import { EmptyState, ErrorState, Skeleton } from './Feedback.jsx';
import { contentApi, userApi } from '../services/api.js';

export function ContentFeed({ kind = 'posts', userId, layout = 'feed' }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
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
    } catch (reason) {
      if (signal?.aborted || reason.name === 'AbortError') return;
      setError(reason.message || 'Could not load content.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [kind, userId]);

  async function loadMore() {
    if (!nextCursor || loadingMore || (kind !== 'saved' && kind !== 'tagged')) return;
    setLoadingMore(true);
    setMoreError('');
    try {
      const result = kind === 'saved'
        ? await userApi.savedPosts({ after: nextCursor })
        : await userApi.taggedPosts(userId, { after: nextCursor });
      const nextItems = result.posts || [];
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
      key={item.id}
      item={item}
      layout={layout}
      kind={kind}
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
    {moreError && <p className="inline-error" role="alert">{moreError} <button type="button" className="text-link" onClick={loadMore}>Retry</button></p>}
    {nextCursor && (kind === 'saved' || kind === 'tagged') && <button className="button button--outline load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
  </>;
}

export function StoryFeed() {
  const [stories, setStories] = useState([]);
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

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (loading) return <Skeleton rows={1} />;
  if (!stories.length) return null;
  return <section className="story-section" aria-label="Stories">
    <div className="story-strip">
      {stories.map((story) => <article className="story-card" key={story.id}>
        <div className="story-card-media">
          {story.media?.resourceType === 'video'
            ? <video src={story.media.secureUrl} poster={story.media.thumbnailUrl} controls preload="metadata" />
            : <img src={story.media?.secureUrl || story.media?.thumbnailUrl} alt={story.caption || 'Shared story'} loading="lazy" />}
        </div>
        <Link className="story-card-owner" to={`/profile/${story.owner.id}`}>
          <Avatar name={story.owner.displayName} src={story.owner.avatarUrl} size="small" />
          <span>@{story.owner.username}</span>
        </Link>
        {story.caption && <p>{story.caption}</p>}
      </article>)}
    </div>
  </section>;
}

function ContentCard({ item, layout, kind, onSavedChange, onTaggedChange }) {
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
    <header className="content-card-header">
      <Link to={`/profile/${item.owner?.id}`} className="content-card-owner">
        <Avatar name={item.owner?.displayName} src={item.owner?.avatarUrl} size="small" />
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
      {isVideo && <span className="content-video-badge"><Play size={14} fill="currentColor" /> Video</span>}
    </div>
    {item.caption && <p className="content-card-caption"><strong>@{item.owner?.username}</strong> {item.caption}</p>}
    {bookmarkError && <p className="inline-error" role="alert">{bookmarkError}</p>}
  </article>;
}
