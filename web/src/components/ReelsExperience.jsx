import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronDown, MoreHorizontal, Pause, Play,
  Search, Volume2, VolumeX,
} from 'lucide-react';
import { Avatar } from './Brand.jsx';
import { contentApi, userApi } from '../services/api.js';
import { getReelPath, getReelUrl } from '../services/reelUrl.js';
import { EngagementActions } from './EngagementActions.jsx';
import { HashtagText } from './HashtagText.jsx';

const pageSize = 10;

function ReelSlide({ item, index, active, preloadNext, viewerId, followBusy, onFollow, onShare, registerVideo }) {
  const videoRef = useRef(null);
  const likeButtonRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const isOwner = item.owner?.id === viewerId;
  const isFollowing = Boolean(item.isFollowing);

  useEffect(() => {
    registerVideo(index, videoRef.current);
    return () => registerVideo(index, null);
  }, [index, registerVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    if (!active) {
      video.pause();
      setPlaying(false);
      return undefined;
    }

    video.muted = muted;
    const attempt = video.play();
    if (attempt?.then) {
      attempt.then(() => {
        setPlaying(true);
        setPlaybackError(false);
      }).catch(() => setPlaying(false));
    }
    return () => video.pause();
  }, [active, item.id, muted]);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setPlaybackError(false)).catch(() => setPlaybackError(true));
    } else {
      video.pause();
    }
  }

  function retryPlayback() {
    const video = videoRef.current;
    if (!video) return;
    setPlaybackError(false);
    setBuffering(true);
    video.load();
    video.play().catch(() => {
      setBuffering(false);
      setPlaybackError(true);
    });
  }

  return <article className="reel-slide" data-reel-id={item.id} aria-label={`Reel by @${item.owner?.username || 'member'}`}>
    <div className="reel-player">
      {item.media?.secureUrl
        ? <video
          ref={videoRef}
          className="reel-video"
          src={item.media.secureUrl}
          poster={item.media.thumbnailUrl}
          muted={muted}
          playsInline
          loop
          preload={active ? 'auto' : preloadNext ? 'metadata' : 'none'}
          onWaiting={() => setBuffering(true)}
          onCanPlay={() => setBuffering(false)}
          onPlaying={() => { setBuffering(false); setPlaying(true); setPlaybackError(false); }}
          onPause={() => setPlaying(false)}
          onError={() => { setBuffering(false); setPlaybackError(true); }}
          onClick={togglePlayback}
          onDoubleClick={(event) => {
            event.preventDefault();
            likeButtonRef.current?.click();
          }}
          aria-label={`Reel video by @${item.owner?.username || 'member'}`}
        />
        : <div className="reel-media-error" role="alert">This Reel has no playable video.</div>}
      <div className="reel-video-shade" aria-hidden="true" />
      {buffering && active && <span className="reel-buffering" role="status">Loading video…</span>}
      {!playing && !playbackError && active && <button className="reel-center-control" type="button" onClick={togglePlayback} aria-label="Play Reel"><Play size={31} fill="currentColor" /></button>}
      {playbackError && <div className="reel-playback-error" role="alert">
        <span>Video playback failed.</span>
        <button type="button" onClick={retryPlayback}>Try again</button>
      </div>}

      <div className="reel-top-controls">
        <button className="reel-icon-button" type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute Reel' : 'Mute Reel'}>
          {muted ? <VolumeX size={21} /> : <Volume2 size={21} />}
        </button>
        <button className="reel-icon-button" type="button" onClick={togglePlayback} aria-label={playing ? 'Pause Reel' : 'Play Reel'}>
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
      </div>

      <div className="reel-creator-overlay">
        <div className="reel-creator-row">
          <Link className="reel-avatar-link" to={`/profile/${encodeURIComponent(item.owner?.id || '')}`} aria-label={`View @${item.owner?.username || 'member'} profile`}>
            <Avatar name={item.owner?.displayName || item.owner?.username} src={item.owner?.avatarUrl} size="small" />
          </Link>
          <Link className="reel-creator-name" to={`/profile/${encodeURIComponent(item.owner?.id || '')}`}>@{item.owner?.username || 'member'}</Link>
          {!isOwner && <button
            className={`reel-follow-button${isFollowing ? ' is-following' : ''}`}
            type="button"
            onClick={() => onFollow(item)}
            disabled={followBusy}
            aria-label={`${isFollowing ? 'Unfollow' : 'Follow'} @${item.owner?.username || 'member'}`}
          >{followBusy ? 'Updating…' : isFollowing ? 'Following' : 'Follow'}</button>}
        </div>
        {item.caption && <>
          <p className={`reel-caption${captionExpanded ? ' is-expanded' : ''}`}><HashtagText>{item.caption}</HashtagText></p>
          {item.caption.length > 120 && <button className="reel-caption-toggle" type="button" onClick={() => setCaptionExpanded((value) => !value)} aria-expanded={captionExpanded}>
            {captionExpanded ? 'Show less' : 'Read more'}
          </button>}
        </>}
        {item.location && <span className="reel-location">{item.location}</span>}
        {item.aiDisclosure && <span className="reel-ai-label">AI-generated or altered</span>}
      </div>
    </div>
    <aside className="reel-actions" aria-label="Reel actions">
      <EngagementActions item={item} kind="reels" onShare={onShare} vertical likeButtonRef={likeButtonRef} />
      <Link className="reel-action" to={getReelPath(item.id)} aria-label="More Reel details" title="More Reel details">
        <MoreHorizontal size={25} />
      </Link>
    </aside>
  </article>;
}

export function ReelsExperience({ viewer }) {
  const { reelId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [notice, setNotice] = useState('');
  const [followBusy, setFollowBusy] = useState({});
  const viewportRef = useRef(null);
  const slideRefs = useRef([]);
  const videoRefs = useRef([]);
  const nextCursorRef = useRef(null);
  const requestInFlight = useRef(false);
  const followBusyRef = useRef(new Set());
  const requestControllerRef = useRef(null);
  const initialReelIdRef = useRef(reelId || null);
  const routeFetchRef = useRef(null);
  const hasCommittedUrlRef = useRef(Boolean(reelId));
  const pendingRouteIdRef = useRef(null);
  const previousRouteIdRef = useRef(reelId || null);
  const registerVideo = useCallback((index, video) => {
    videoRefs.current[index] = video;
  }, []);

  const loadPage = useCallback(async (after, initial = false, selectedReelId = null) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    if (initial) {
      setLoading(true);
      setError('');
      setNotFound(false);
    } else {
      setLoadingMore(true);
      setError('');
    }
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const feedRequest = contentApi.reels(pageSize, {
        ...(after ? { after } : {}),
        signal: controller.signal,
      });
      const [feedResult, selectedResult] = await Promise.all([
        feedRequest.then((value) => ({ value }), (reason) => ({ reason })),
        selectedReelId
          ? contentApi.reel(selectedReelId, { signal: controller.signal })
            .then((value) => ({ value }), (reason) => ({ reason }))
          : Promise.resolve(null),
      ]);
      if (selectedReelId && selectedResult?.reason) {
        setItems([]);
        setCursor(null);
        nextCursorRef.current = null;
        throw selectedResult.reason;
      }
      if (feedResult.reason && !selectedResult?.value) throw feedResult.reason;
      const result = feedResult.value || { reels: [], nextCursor: null };
      const incoming = Array.isArray(result.reels) ? result.reels : [];
      const selectedReel = selectedResult?.value?.reel;
      const mergedIncoming = selectedReel
        ? [selectedReel, ...incoming.filter((item) => item.id !== selectedReel.id)]
        : incoming;
      setItems((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        return initial ? mergedIncoming : [...current, ...mergedIncoming.filter((item) => !existingIds.has(item.id))];
      });
      if (initial) setActiveIndex(0);
      nextCursorRef.current = result.nextCursor || null;
      setCursor(result.nextCursor || null);
      if (feedResult.reason) setError(feedResult.reason?.message || 'Could not load more Reels.');
    } catch (reason) {
      if (!controller.signal.aborted && reason?.name !== 'AbortError') {
        setNotFound(Boolean(selectedReelId && (reason?.status === 400 || reason?.status === 404)));
        setError(reason?.message || 'Could not load Reels. Check your connection and try again.');
      }
    } finally {
      if (requestControllerRef.current === controller) {
        requestInFlight.current = false;
        requestControllerRef.current = null;
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    loadPage(null, true, initialReelIdRef.current);
    return () => {
      if (requestControllerRef.current) {
        requestControllerRef.current.abort();
        requestControllerRef.current = null;
        requestInFlight.current = false;
      }
      for (const video of videoRefs.current) video?.pause();
    };
  }, [loadPage]);

  useEffect(() => {
    if (!reelId || loading || items.some((item) => item.id === reelId) ||
        initialReelIdRef.current === reelId || routeFetchRef.current === reelId) return undefined;
    const controller = new AbortController();
    routeFetchRef.current = reelId;
    contentApi.reel(reelId, { signal: controller.signal }).then(({ reel }) => {
      if (!reel || controller.signal.aborted) return;
      setItems((current) => [reel, ...current.filter((item) => item.id !== reel.id)]);
      setActiveIndex(0);
      setError('');
    }).catch((reason) => {
      if (!controller.signal.aborted && reason?.name !== 'AbortError') {
        setItems([]);
        setNotFound(reason?.status === 400 || reason?.status === 404);
        setError(reason?.message || 'Reel not found.');
      }
    });
    return () => controller.abort();
  }, [items, loading, reelId]);

  useEffect(() => {
    if (previousRouteIdRef.current === (reelId || null)) return;
    previousRouteIdRef.current = reelId || null;
    if (!reelId) return;
    const index = items.findIndex((item) => item.id === reelId);
    if (index < 0 || index === activeIndex) return;
    pendingRouteIdRef.current = reelId;
    setActiveIndex(index);
    window.requestAnimationFrame(() => {
      slideRefs.current[index]?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  }, [activeIndex, items, reelId]);

  useEffect(() => {
    const root = viewportRef.current;
    if (!root || !items.length) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
          const index = Number(entry.target.getAttribute('data-reel-index'));
          setActiveIndex(index);
          if (index >= items.length - 3 && nextCursorRef.current) {
            loadPage(nextCursorRef.current);
          }
        }
      }
    }, { root, threshold: [0.65] });
    for (const slide of slideRefs.current) if (slide) observer.observe(slide);
    return () => observer.disconnect();
  }, [items, loadPage]);

  useEffect(() => {
    const activeReel = items[activeIndex];
    if (!activeReel || (reelId && !items.some((item) => item.id === reelId))) return;
    if (pendingRouteIdRef.current && reelId === pendingRouteIdRef.current &&
        activeReel.id !== pendingRouteIdRef.current) return;
    if (activeReel.id === pendingRouteIdRef.current) pendingRouteIdRef.current = null;
    if (reelId === activeReel.id) {
      hasCommittedUrlRef.current = true;
      return;
    }
    const isInitialFeedUrl = !reelId && !hasCommittedUrlRef.current;
    navigate(`${getReelPath(activeReel.id)}${location.search}${location.hash}`, {
      replace: isInitialFeedUrl,
    });
    hasCommittedUrlRef.current = true;
  }, [activeIndex, items, location.hash, location.search, navigate, reelId]);

  useEffect(() => {
    const activeReel = items[activeIndex];
    if (!reelId || !activeReel || activeReel.id !== reelId) return undefined;
    const previousTitle = document.title;
    const canonical = document.querySelector('link[rel="canonical"]');
    const createdCanonical = !canonical;
    const canonicalLink = canonical || document.createElement('link');
    const previousCanonical = canonicalLink.getAttribute('href');
    const metaValues = [
      ['property', 'og:title', `Reel by @${activeReel.owner?.username || 'CliQHeart member'}`],
      ['property', 'og:description', activeReel.caption || 'Watch this Reel on CliQHeart.'],
      ['property', 'og:image', activeReel.media?.thumbnailUrl || activeReel.media?.secureUrl || ''],
      ['property', 'og:url', getReelUrl(activeReel.id)],
    ].map(([attribute, name, value]) => {
      let element = document.querySelector(`meta[${attribute}="${name}"]`);
      const created = !element;
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attribute, name);
        document.head.append(element);
      }
      const previous = element.getAttribute('content');
      element.setAttribute('content', value);
      return { element, created, previous };
    });
    document.title = `Reel by @${activeReel.owner?.username || 'CliQHeart member'} | CliQHeart`;
    canonicalLink.setAttribute('href', getReelUrl(activeReel.id));
    if (createdCanonical) document.head.append(canonicalLink);
    return () => {
      document.title = previousTitle;
      if (createdCanonical) canonicalLink.remove();
      else if (previousCanonical === null) canonicalLink.removeAttribute('href');
      else canonicalLink.setAttribute('href', previousCanonical);
      for (const { element, created, previous } of metaValues) {
        if (created) element.remove();
        else if (previous === null) element.removeAttribute('content');
        else element.setAttribute('content', previous);
      }
    };
  }, [activeIndex, items, reelId]);

  useEffect(() => {
    if (document.visibilityState !== 'visible') {
      videoRefs.current[activeIndex]?.pause();
    }
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') videoRefs.current[activeIndex]?.pause();
      else videoRefs.current[activeIndex]?.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [activeIndex]);

  async function toggleFollow(item) {
    if (!item.owner?.id || item.owner.id === viewer?.id || followBusyRef.current.has(item.owner.id)) return;
    const wasFollowing = Boolean(item.isFollowing);
    followBusyRef.current.add(item.owner.id);
    setFollowBusy((current) => ({ ...current, [item.owner.id]: true }));
    setItems((current) => current.map((entry) => entry.id === item.id
      ? { ...entry, isFollowing: !wasFollowing }
      : entry));
    try {
      if (wasFollowing) await userApi.unfollow(item.owner.id);
      else await userApi.follow(item.owner.id);
    } catch (reason) {
      setItems((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, isFollowing: wasFollowing }
        : entry));
      setNotice(reason?.message || 'Could not update your follow status.');
    } finally {
      followBusyRef.current.delete(item.owner.id);
      setFollowBusy((current) => ({ ...current, [item.owner.id]: false }));
    }
  }

  async function shareReel(item) {
    const shareData = {
      title: `Reel by @${item.owner?.username || 'CliQHeart member'}`,
      text: item.caption || 'Watch this Reel on CliQHeart.',
      url: getReelUrl(item.id),
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareData.url);
        setNotice('Reel link copied.');
      } else {
        setNotice('Sharing is not supported by this browser.');
      }
    } catch (reason) {
      if (reason?.name !== 'AbortError') setNotice(reason?.message || 'Could not share this Reel.');
    }
  }

  if (loading) return <section className="reels-experience" aria-label="Reels"><div className="reels-loading" role="status">Loading Reels…</div></section>;
  if (error && !items.length) return <section className="reels-experience" aria-label="Reels"><div className="reels-empty-state" role="alert">
  <h1>{notFound ? 'Reel not found' : 'Reels are unavailable'}</h1><p>{error}</p>
  {notFound
    ? <Link to="/reels">Back to Reels</Link>
    : <button type="button" onClick={() => loadPage(null, true, reelId)}>Try again</button>}
  </div></section>;
  if (!items.length) return <section className="reels-experience" aria-label="Reels"><div className="reels-empty-state">
    <h1>No Reels yet</h1><p>Explore CliQHeart or share a video to start the feed.</p>
    <div><Link to="/search">Discover people</Link><Link to="/create">Create a Reel</Link></div>
  </div></section>;

  return <section className="reels-experience" aria-label="Reels">
    <header className="reels-topbar">
      <div><h1>Reels</h1><nav aria-label="Reel feed"><button type="button" className="is-selected" aria-current="page">For You</button><button type="button" disabled title="A Following Reels feed is not available yet">Following</button></nav></div>
      <Link className="reels-search" to="/search" aria-label="Search CliQHeart"><Search size={21} /></Link>
    </header>
    <div className="reels-viewport" ref={viewportRef} tabIndex={0} aria-label="Reels feed" onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        event.currentTarget.scrollBy({ top: event.currentTarget.clientHeight, behavior: 'smooth' });
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        event.currentTarget.scrollBy({ top: -event.currentTarget.clientHeight, behavior: 'smooth' });
      }
    }}>
      {items.map((item, index) => <div
        className="reel-snap-slide"
        key={item.id}
        data-reel-index={index}
        ref={(element) => { slideRefs.current[index] = element; }}
      >
        <ReelSlide
          item={item}
          index={index}
          active={index === activeIndex}
          preloadNext={index === activeIndex + 1}
          viewerId={viewer?.id}
          followBusy={Boolean(followBusy[item.owner?.id])}
          onFollow={toggleFollow}
          onShare={shareReel}
          registerVideo={registerVideo}
        />
      </div>)}
      {loadingMore && <div className="reels-next-loading" role="status"><span />Loading next Reel…</div>}
      {error && items.length > 0 && <div className="reels-load-error" role="alert">{error}<button type="button" onClick={() => loadPage(cursor)}>Retry</button></div>}
      {!cursor && <p className="reels-end-note">You’re all caught up.</p>}
    </div>
    {notice && <div className="reels-notice" role="status">
      <span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss message"><ChevronDown size={16} /></button>
    </div>}
  </section>;
}
