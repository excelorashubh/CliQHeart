import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Play } from 'lucide-react';
import { Avatar } from './Brand.jsx';
import { EmptyState, ErrorState, Skeleton } from './Feedback.jsx';
import { contentApi } from '../services/api.js';

export function ContentFeed({ kind = 'posts', userId, onLoaded }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const result = userId
        ? await contentApi.userPosts(userId, 30, { signal })
        : kind === 'reels'
          ? await contentApi.reels(30, { signal })
          : await contentApi.posts(30, { signal });
      if (signal?.aborted) return;
      const nextItems = result[kind] || result.posts || [];
      setItems(nextItems);
      onLoaded?.(nextItems.length);
    } catch (reason) {
      if (signal?.aborted || reason.name === 'AbortError') return;
      setError(reason.message || 'Could not load content.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [kind, onLoaded, userId]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading) return <Skeleton rows={3} />;
  if (error) return <ErrorState error={error} onRetry={load} />;
  if (items.length === 0) {
    return <EmptyState
      title={kind === 'reels' ? 'No Reels to show yet' : 'No posts to show yet'}
      description={userId ? 'Published posts from this profile will appear here.' : 'Follow people and share a post to get started.'}
      icon={kind === 'reels' ? Play : Heart}
    />;
  }
  return <div className={`content-feed${kind === 'reels' ? ' content-feed--reels' : ''}`}>
    {items.map((item) => <ContentCard key={item.id} item={item} />)}
  </div>;
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

function ContentCard({ item }) {
  const isVideo = item.media?.resourceType === 'video';
  return <article className="content-card">
    <header className="content-card-header">
      <Link to={`/profile/${item.owner?.id}`} className="content-card-owner">
        <Avatar name={item.owner?.displayName} src={item.owner?.avatarUrl} size="small" />
        <span><strong>{item.owner?.displayName || 'CliQHeart member'}</strong><small>@{item.owner?.username || 'member'}</small></span>
      </Link>
      {item.createdAt && <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</time>}
    </header>
    <div className="content-card-media">
      {isVideo
        ? <video src={item.media.secureUrl} poster={item.media.thumbnailUrl} controls preload="metadata" />
        : <img src={item.media?.secureUrl || item.media?.thumbnailUrl} alt={item.caption || 'Shared CliQHeart media'} loading="lazy" />}
      {isVideo && <span className="content-video-badge"><Play size={14} fill="currentColor" /> Video</span>}
    </div>
    {item.caption && <p className="content-card-caption"><strong>@{item.owner?.username}</strong> {item.caption}</p>}
  </article>;
}
