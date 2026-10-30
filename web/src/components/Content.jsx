import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck, Bookmark, Clapperboard, Heart, MoreHorizontal, Play, Repeat2, Volume2, VolumeX,
} from 'lucide-react';
import { Avatar } from './Brand.jsx';
import { EmptyState, ErrorState, RetryButton, Skeleton } from './Feedback.jsx';
import { EngagementActions } from './EngagementActions.jsx';
import { contentApi, userApi } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { getReelPath } from '../services/reelUrl.js';

export function ContentFeed({
  kind = 'posts',
  userId,
  layout = 'feed',
  showSuggestedLabels = false,
  includeReels = false,
  savedType = 'posts',
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const [nextReelCursor, setNextReelCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const activeVideoRef = useRef(null);
  const claimActiveVideo = useCallback((video) => {
    const activeVideo = activeVideoRef.current;
    if (activeVideo && activeVideo !== video) activeVideo.pause();
    activeVideoRef.current = video;
  }, []);
  const playActiveVideo = useCallback((video) => {
    claimActiveVideo(video);
    return video.play();
  }, [claimActiveVideo]);
  const pauseActiveVideo = useCallback((video) => {
    if (activeVideoRef.current === video) {
      video.pause();
      activeVideoRef.current = null;
    }
  }, []);
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
        ? await userApi.savedPosts({ signal, kind: savedType })
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
      const savedItems = result.items || result.content || [
        ...(result.posts || []).map((item) => ({ ...item, contentType: 'post' })),
        ...(result.reels || []).map((item) => ({ ...item, contentType: 'reel' })),
      ];
      const nextItems = kind === 'saved' || kind === 'tagged'
        ? savedItems.map((item) => ({ ...item, feedType: item.contentType === 'reel' ? 'reels' : 'posts' }))
        : result[kind] || result.posts || [];
      setItems(nextItems);
      setNextCursor(result.nextCursor || null);
      setNextReelCursor(null);
    } catch (reason) {
      if (signal?.aborted || reason.name === 'AbortError') return;
      setError(reason.message || 'Could not load content.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [includeReels, kind, savedType, userId]);

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
        ? await userApi.savedPosts({ after: nextCursor, kind: savedType })
        : await userApi.taggedPosts(userId, { after: nextCursor });
      const savedItems = result.items || result.content || [
        ...(result.posts || []).map((item) => ({ ...item, contentType: 'post' })),
        ...(result.reels || []).map((item) => ({ ...item, contentType: 'reel' })),
      ];
      const nextItems = kind === 'saved' || kind === 'tagged'
        ? savedItems.map((item) => ({ ...item, feedType: item.contentType === 'reel' ? 'reels' : 'posts' }))
        : result[kind] || result.posts || [];
      setItems((current) => {
        const ids = new Set(current.map((item) => `${item.feedType || kind}:${item.id}`));
        return [...current, ...nextItems.filter((item) => !ids.has(`${item.feedType || kind}:${item.id}`))];
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

  if (loading && (layout === 'explore' || layout === 'grid')) return <div
    className={`content-feed content-feed--grid${layout === 'explore' ? ' content-feed--explore-grid' : ''}`}
    aria-label={`Loading ${layout === 'explore' ? 'Explore' : 'profile'} media`}
    aria-busy="true"
  >
    {Array.from({ length: layout === 'explore' ? 9 : 8 }, (_, index) => <span
      className={layout === 'explore' ? 'explore-tile-placeholder' : 'profile-grid-placeholder'}
      key={index}
    />)}
  </div>;
  if (loading) return <Skeleton rows={3} />;
  if (error) return <ErrorState error={error} onRetry={() => load()} />;
  if (items.length === 0) {
    return <EmptyState
      title={layout === 'explore'
        ? 'No media to explore yet'
        : kind === 'saved' ? 'No saved content yet' : kind === 'tagged' ? 'No tagged content yet' : kind === 'reels' ? 'No Reels to show yet' : 'No posts to show yet'}
      description={layout === 'explore'
        ? 'Posts and Reels shared on CliQHeart will appear here.'
        : kind === 'saved'
        ? 'Posts you save will appear here.'
        : kind === 'tagged'
          ? 'Posts and Reels this person is tagged in will appear here.'
          : userId
        ? `Published ${kind === 'reels' ? 'Reels' : 'posts'} from this profile will appear here.`
        : 'Follow people and share a post to get started.'}
      icon={kind === 'reels' ? Play : Heart}
    />;
  }
  return <>
    <div className={`content-feed${kind === 'reels' ? ' content-feed--reels' : ''}${layout === 'grid' ? ' content-feed--grid' : ''}${layout === 'explore' ? ' content-feed--grid content-feed--explore-grid' : ''}`}>
    {items.map((item) => <ContentCard
      key={`${item.feedType || kind}:${item.feedKey || item.id}`}
      item={item}
      layout={layout}
      thumbnailOnly={layout === 'explore'}
      kind={item.feedType || kind}
      homeFeed={showSuggestedLabels && layout === 'feed'}
      showSuggestedLabel={showSuggestedLabels}
      claimActiveVideo={claimActiveVideo}
      playActiveVideo={playActiveVideo}
      pauseActiveVideo={pauseActiveVideo}
      onDeleted={(id, itemKind) => setItems((current) => current.filter((entry) =>
        entry.id !== id || (entry.feedType || kind) !== itemKind))}
      onSavedChange={(saved) => {
        setItems((current) => kind === 'saved' && !saved
          ? current.filter((entry) => entry.id !== item.id)
          : current.map((entry) => entry.id === item.id ? { ...entry, isSaved: saved } : entry));
      }}
    />)}
    </div>
    {moreError && <p className="inline-error" role="alert">{moreError} <RetryButton error={moreError} onRetry={loadMore} className="text-link" label="Retry" /></p>}
    {(nextCursor || nextReelCursor) && ['posts', 'saved', 'tagged', 'reels'].includes(kind) && <button className="button button--outline load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
  </>;
}

function FeedVideo({ item, autoPlay, claimActiveVideo, playActiveVideo, pauseActiveVideo }) {
  const videoRef = useRef(null);
  const inViewportRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return undefined;
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    updatePreference();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', updatePreference);
      return () => mediaQuery.removeEventListener('change', updatePreference);
    }
    mediaQuery.addListener(updatePreference);
    return () => mediaQuery.removeListener(updatePreference);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    if (!autoPlay || reducedMotion || typeof IntersectionObserver === 'undefined') {
      pauseActiveVideo(video);
      return () => pauseActiveVideo(video);
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        inViewportRef.current = entry.isIntersecting && entry.intersectionRatio >= 0.6;
        if (document.visibilityState === 'visible' && inViewportRef.current) {
          playActiveVideo(video).then(() => {
            setPlaybackError(false);
          }).catch((reason) => {
            if (reason?.name !== 'NotAllowedError' && reason?.name !== 'AbortError') {
              setPlaybackError(true);
            }
          });
        } else {
          pauseActiveVideo(video);
        }
      }
    }, { threshold: [0, 0.6] });
    observer.observe(video.parentElement);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        pauseActiveVideo(video);
      } else if (inViewportRef.current && !reducedMotion) {
        playActiveVideo(video).catch((reason) => {
          if (reason?.name !== 'NotAllowedError' && reason?.name !== 'AbortError') setPlaybackError(true);
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      pauseActiveVideo(video);
    };
  }, [autoPlay, pauseActiveVideo, playActiveVideo, reducedMotion]);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      playActiveVideo(video).then(() => setPlaybackError(false)).catch((reason) => {
        if (reason?.name !== 'NotAllowedError' && reason?.name !== 'AbortError') setPlaybackError(true);
      });
    } else {
      pauseActiveVideo(video);
    }
  }

  function retryPlayback() {
    const video = videoRef.current;
    if (!video) return;
    setPlaybackError(false);
    setBuffering(true);
    video.load();
    playActiveVideo(video).catch((reason) => {
      setBuffering(false);
      setPlaybackError(reason?.name !== 'NotAllowedError' && reason?.name !== 'AbortError');
    });
  }

  return <div className="content-card-video-wrap">
    {item.media?.secureUrl
      ? <video
        ref={videoRef}
        src={item.media.secureUrl}
        poster={item.media.thumbnailUrl}
        controls
        playsInline
        muted={muted}
        preload="none"
        onPlay={() => { claimActiveVideo(videoRef.current); setPlaying(true); }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onPlaying={() => { setBuffering(false); setPlaybackError(false); }}
        onError={() => { setBuffering(false); setPlaybackError(true); }}
        aria-label={`Video by @${item.owner?.username || 'member'}`}
      />
      : <div className="content-media-unavailable" role="status">Video is unavailable.</div>}
    {item.media?.secureUrl && <>
      <button
        type="button"
        className="content-video-mute"
        onClick={() => setMuted((value) => !value)}
        aria-label={muted ? 'Unmute video' : 'Mute video'}
        title={muted ? 'Unmute video' : 'Mute video'}
      >{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
      {!playing && !playbackError && <button className="content-video-play" type="button" onClick={togglePlayback} aria-label="Play video">
        <Play size={28} fill="currentColor" />
      </button>}
      {buffering && <span className="content-video-status" role="status">Loading video…</span>}
      {playbackError && <div className="content-video-error" role="alert">
        <span>Video playback failed.</span><button type="button" onClick={retryPlayback}>Try again</button>
      </div>}
    </>}
  </div>;
}

export function StoryFeed() {
  const { user, isInitializing } = useAuth();
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

  const getOwnerId = (owner) => owner?.id ?? owner?._id;
  const currentUserId = getOwnerId(user);
  const groupedStories = [...stories.reduce((groups, story) => {
    const ownerId = getOwnerId(story.owner);
    if (!ownerId) return groups;
    const group = groups.get(ownerId) || { owner: story.owner, stories: [] };
    group.stories.push(story);
    groups.set(ownerId, group);
    return groups;
  }, new Map()).values()].sort((first, second) =>
    Number(getOwnerId(second.owner) === currentUserId) - Number(getOwnerId(first.owner) === currentUserId));
  const ownerStoryGroupIndex = currentUserId
    ? groupedStories.findIndex((group) => getOwnerId(group.owner) === currentUserId)
    : -1;
  const ownerStoryGroup = groupedStories[ownerStoryGroupIndex];

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
        {ownerStoryGroup
          ? <button className="home-story home-story--owner" type="button" onClick={() => openStory(ownerStoryGroupIndex)} aria-label="Your story">
            <span className={`home-story-ring${ownerStoryGroup.stories.every((story) => viewedStoryIds.has(story.id)) ? ' is-viewed' : ''}`}>
              <Avatar name={user?.displayName} src={user?.avatarUrl} size="large" />
              <span className="home-story-plus" aria-hidden="true">+</span>
            </span>
            <span>Your story</span>
          </button>
          : <Link className="home-story home-story--create" to="/create?kind=story" aria-label="Create a story">
            <span className="home-story-ring"><Avatar name={user?.displayName} src={user?.avatarUrl} size="large" /><span className="home-story-plus">+</span></span>
            <span>Your story</span>
          </Link>}
        {loading && <div className="home-story-loading"><Skeleton rows={1} /></div>}
        {!loading && error && <div className="home-story-error" role="status">{error} <RetryButton error={error} onRetry={() => load()} className="text-link" label="Retry" /></div>}
        {!isInitializing && !loading && !error && groupedStories.map((group, index) => {
          if (index === ownerStoryGroupIndex) return null;
          const seen = group.stories.every((story) => viewedStoryIds.has(story.id));
          return <button className="home-story" type="button" key={group.owner.id} onClick={() => openStory(index)}>
            <span className={`home-story-ring${seen ? ' is-viewed' : ''}`}>
              <Avatar
                name={group.owner.displayName}
                src={getOwnerId(group.owner) === currentUserId ? user.avatarUrl : group.owner.avatarUrl}
                size="large"
              />
            </span>
            <span>@{group.owner.username}</span>
          </button>;
        })}
        {!isInitializing && !loading && !error && groupedStories.length === 0 && <p className="home-story-empty">Stories from people you follow will appear here.</p>}
      </div>
    </section>
    {activeGroup && <div className="story-viewer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setActiveGroupIndex(-1);
    }}>
      <section className="story-viewer" role="dialog" aria-modal="true" aria-label={`Stories from @${activeGroup.owner.username}`}>
        <button className="story-viewer-close" type="button" onClick={() => setActiveGroupIndex(-1)} aria-label="Close stories">×</button>
        <div className="story-viewer-owner">
          <Avatar name={activeGroup.owner.displayName} src={getOwnerId(activeGroup.owner) === currentUserId ? user.avatarUrl : activeGroup.owner.avatarUrl} size="small" />
          <span>@{activeGroup.owner.username}</span>
          {getOwnerId(activeGroup.owner) === currentUserId && <Link className="story-viewer-add" to="/create?kind=story">Add another story</Link>}
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

function ContentCard({
  item,
  layout,
  thumbnailOnly = false,
  kind,
  homeFeed = false,
  showSuggestedLabel,
  onSavedChange,
  claimActiveVideo,
  playActiveVideo,
  pauseActiveVideo,
  onDeleted,
}) {
  const { user } = useAuth();
  const ownerAvatarUrl = item.owner?.id === user?.id ? user.avatarUrl : item.owner?.avatarUrl;
  const repostAuthor = item.repostedBy || item.repost?.user;
  const isVideo = item.media?.resourceType === 'video';
  const contentKind = kind === 'reels' || item.contentType === 'reel' ? 'reels' : 'posts';
  const contentLabel = contentKind === 'reels' ? 'Reel' : 'post';
  const [saved, setSaved] = useState(Boolean(item.isSaved));
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const bookmarkBusyRef = useRef(false);
  const [bookmarkError, setBookmarkError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const likeButtonRef = useRef(null);
  const handleMediaDoubleClick = (event) => {
    if (!homeFeed) return;
    event.preventDefault();
    likeButtonRef.current?.click();
  };
  async function toggleSaved(event) {
    event.preventDefault();
    event.stopPropagation();
    if (bookmarkBusyRef.current) return;
    bookmarkBusyRef.current = true;
    setBookmarkBusy(true);
    setBookmarkError('');
    const previousSaved = saved;
    const nextSaved = !previousSaved;
    setSaved(nextSaved);
    try {
      if (nextSaved) await contentApi.saveContent(contentKind, item.id);
      else await contentApi.unsaveContent(contentKind, item.id);
      onSavedChange?.(nextSaved);
    } catch (reason) {
      setSaved(previousSaved);
      setBookmarkError(reason.message || 'Could not update the saved post.');
    } finally {
      bookmarkBusyRef.current = false;
      setBookmarkBusy(false);
    }
  }
  async function shareContent() {
    const path = kind === 'reels' ? getReelPath(item.id) : `/post/${encodeURIComponent(item.id)}`;
    const url = new URL(path, window.location.origin).toString();
    setActionNotice('');
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: `Post by @${item.owner?.username || 'CliQHeart member'}`,
            text: item.caption || 'View this post on CliQHeart.',
            url,
          });
        } catch (reason) {
          if (reason?.name === 'AbortError') return;
          if (!navigator.clipboard?.writeText) throw reason;
          await navigator.clipboard.writeText(url);
          setActionNotice('Post link copied.');
        }
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setActionNotice('Post link copied.');
      } else {
        setActionNotice('Sharing is not supported by this browser.');
      }
    } catch (reason) {
      setBookmarkError(reason.message || 'Could not share this post.');
    }
  }
  async function deleteContent() {
    if (deleteBusy || item.owner?.id !== user?.id ||
        !window.confirm(`Delete this ${kind === 'reels' ? 'Reel' : 'post'}? This cannot be undone.`)) return;
    setDeleteBusy(true);
    setBookmarkError('');
    try {
      if (kind === 'reels') await contentApi.deleteReel(item.id);
      else await contentApi.deletePost(item.id);
      onDeleted?.(item.id, kind);
    } catch (reason) {
      setBookmarkError(reason.message || 'Could not delete this content.');
    } finally {
      setDeleteBusy(false);
    }
  }
  if (layout === 'grid' || layout === 'explore') {
    const thumbnailUrl = item.media?.thumbnailUrl || (!isVideo ? item.media?.secureUrl : null);
    return <div className="content-grid-cell">
      <Link
        className="content-grid-item"
        to={kind === 'reels' ? getReelPath(item.id) : `/post/${encodeURIComponent(item.id)}`}
        aria-label={thumbnailOnly
          ? kind === 'reels' ? 'Open Reel' : isVideo ? 'Open video post' : 'Open post'
          : kind === 'reels' ? 'Open Reel' : 'Open post'}
      >
        {thumbnailUrl
          ? <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" />
          : <span className="content-grid-thumbnail-placeholder" aria-hidden="true" />}
        {isVideo && <span className="content-grid-video" aria-label={kind === 'reels' ? 'Reel' : 'Video'}>
          {kind === 'reels' ? <Clapperboard size={17} /> : <Play size={17} fill="currentColor" />}
        </span>}
      </Link>
    </div>;
  }
  return <article className={`content-card${kind === 'reels' ? ' content-card--reel' : ''}`}>
    {repostAuthor && <div className="content-repost-label"><Repeat2 size={14} /> Reposted by <Link to={`/profile/${encodeURIComponent(repostAuthor.id || '')}`}>@{repostAuthor.username || 'member'}</Link></div>}
    {showSuggestedLabel && item.owner?.id !== user?.id && !item.isFollowing && <div className="content-suggested-label">Suggested for you</div>}
    <header className="content-card-header">
      <Link to={`/profile/${item.owner?.id}`} className="content-card-owner">
        <Avatar name={item.owner?.displayName} src={ownerAvatarUrl} size="small" />
        <span><strong>{item.owner?.displayName || 'CliQHeart member'}{item.owner?.isVerified && <BadgeCheck className="content-verified-badge" size={14} aria-label="Verified" />}</strong><small>@{item.owner?.username || 'member'}</small></span>
      </Link>
      <div className="content-card-actions">
        {(item.repostedAt || item.createdAt) && <time dateTime={item.repostedAt || item.createdAt}>{new Date(item.repostedAt || item.createdAt).toLocaleDateString()}</time>}
        {!homeFeed && <button className={`content-bookmark-button${saved ? ' is-saved' : ''}`} onClick={toggleSaved} disabled={bookmarkBusy} aria-label={saved ? `Remove saved ${contentLabel}` : `Save ${contentLabel}`} title={saved ? `Remove saved ${contentLabel}` : `Save ${contentLabel}`}>
          <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
        </button>}
        {homeFeed && <details className="content-more-options">
          <summary aria-label="More options" title="More options"><MoreHorizontal size={21} /></summary>
          <div className="content-more-menu">
            <button type="button" onClick={shareContent}>Share link</button>
            {item.owner?.id === user?.id && <button type="button" onClick={deleteContent} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting…' : `Delete ${kind === 'reels' ? 'Reel' : 'post'}`}
            </button>}
            {item.owner?.id !== user?.id && <span>No other options are available.</span>}
          </div>
        </details>}
      </div>
    </header>
    <div className="content-card-media" onDoubleClick={handleMediaDoubleClick}>
      {isVideo
        ? homeFeed
          ? <FeedVideo
            item={item}
            autoPlay
            claimActiveVideo={claimActiveVideo}
            playActiveVideo={playActiveVideo}
            pauseActiveVideo={pauseActiveVideo}
          />
          : <video src={item.media.secureUrl} poster={item.media.thumbnailUrl} controls playsInline preload="metadata" />
        : <img src={item.media?.secureUrl || item.media?.thumbnailUrl} alt={item.altText || item.caption || 'Shared CliQHeart media'} loading="lazy" />}
      {isVideo && (kind === 'reels'
        ? <Link className="content-video-badge content-video-badge--link" to={getReelPath(item.id)} aria-label="Open Reel"><Play size={14} fill="currentColor" /> Reel</Link>
        : <span className="content-video-badge"><Play size={14} fill="currentColor" /> Video</span>)}
    </div>
    {homeFeed && <div className="content-engagement">
      <EngagementActions
        item={{ ...item, isSaved: saved }}
        kind={contentKind}
        onShare={shareContent}
        likeButtonRef={likeButtonRef}
        onSavedChange={(nextSaved) => {
          setSaved(nextSaved);
          onSavedChange?.(nextSaved);
        }}
      />
      {actionNotice && <p className="content-action-notice" role="status">{actionNotice}</p>}
    </div>}
    {item.caption && <ContentCaption
      username={item.owner?.username || 'member'}
      caption={item.caption}
      postId={item.id}
      compact={homeFeed}
    />}
    {item.audio?.title && <div className="content-audio-attribution">
      {item.audio.url
        ? <a href={item.audio.url} target="_blank" rel="noreferrer">{item.audio.title}</a>
        : <span>{item.audio.title}</span>}
    </div>}
    {item.location && <p className="content-card-location">{item.location}</p>}
    {bookmarkError && <p className="inline-error" role="alert">{bookmarkError}</p>}
  </article>;
}

export function ContentCaption({ username, caption, postId, compact = false }) {
  const captionRef = useRef(null);
  const [isLong, setIsLong] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = captionRef.current;
    if (!element || isExpanded) return undefined;
    const measure = () => {
      setIsLong(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [caption, isExpanded, postId]);

  return <div className="content-card-caption-block" data-post-id={postId}>
    <p ref={captionRef} className={`content-card-caption${!isExpanded ? ' is-collapsed' : ''}${compact ? ' is-home-preview' : ''}`}>
      <strong>@{username}</strong> {caption}
    </p>
    {isLong && <button
      type="button"
      className="content-caption-toggle"
      aria-expanded={isExpanded}
      aria-label={`${isExpanded ? 'Show less' : 'Read more'} for post by @${username}`}
      onClick={() => setIsExpanded((current) => !current)}
    >{isExpanded ? 'Show less' : 'Read more'}</button>}
  </div>;
}
