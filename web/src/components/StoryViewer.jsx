import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check, Copy, Ellipsis, Eye, Heart, MessageCircle, Pause, Play, Send, Share2, Trash2,
  Volume2, VolumeX, X,
} from 'lucide-react';
import { Avatar } from './Brand.jsx';
import { contentApi, messageApi } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const storyDurationMs = 10_000;
const quickReactions = ['❤️', '😂', '😮', '😢', '🔥', '👏', '🥰', '😍'];

function relativeStoryTime(createdAt) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function makeMessageId() {
  return globalThis.crypto?.randomUUID?.() || `story-reply-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Clipboard access is unavailable in this browser.');
}

export function StoryViewer({
  groups,
  groupIndex,
  storyIndex,
  onAdvance,
  onClose,
  onDelete,
}) {
  const { user } = useAuth();
  const group = groups[groupIndex];
  const story = group?.stories[storyIndex];
  const isOwner = Boolean(user?.id && String(user.id) === String(group?.owner?.id));
  const videoRef = useRef(null);
  const touchStartRef = useRef(null);
  const touchSwipedRef = useRef(false);
  const callbackRef = useRef(onAdvance);
  const photoRemainingRef = useRef(storyDurationMs);
  const photoStartedAtRef = useRef(0);
  const replyIdRef = useRef('');
  const hiddenPauseRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoFailed, setVideoFailed] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [viewCount, setViewCount] = useState(null);
  const [viewers, setViewers] = useState([]);
  const [viewCursor, setViewCursor] = useState(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewsBusy, setViewsBusy] = useState(false);

  useEffect(() => {
    callbackRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    if (!story) return undefined;
    let active = true;
    setError('');
    setFeedback('');
    setLiked(false);
    setViewCount(null);
    setViewers([]);
    setViewCursor(null);
    setViewsOpen(false);
    setProgress(0);
    setVideoFailed(false);
    setMediaLoading(true);
    setPaused(false);
    photoRemainingRef.current = storyDurationMs;
    replyIdRef.current = makeMessageId();
    contentApi.viewStory(story.id).then((result) => {
      if (!active) return;
      setLiked(Boolean(result.isLiked));
      setViewCount(Number(result.viewCount) || 0);
    }).catch((reason) => {
      if (active) setError(reason.message || 'Could not record this story view.');
    });
    return () => { active = false; };
  }, [story?.id]);

  const advance = useCallback((direction) => callbackRef.current(direction), []);

  useEffect(() => {
    if (!story || story.media?.resourceType === 'video' || paused || mediaLoading) return undefined;
    photoStartedAtRef.current = Date.now();
    const remaining = photoRemainingRef.current;
    const started = Date.now();
    const timer = window.setTimeout(() => advance(1), remaining);
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - started;
      setProgress(Math.min(1, (storyDurationMs - remaining + elapsed) / storyDurationMs));
    }, 40);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(progressTimer);
    };
  }, [story?.id, paused, mediaLoading, advance]);

  useEffect(() => {
    if (!story?.expiresAt) return undefined;
    const expiresAt = Date.parse(story.expiresAt);
    if (!Number.isFinite(expiresAt)) return undefined;
    const timeout = window.setTimeout(onClose, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [story?.id, story?.expiresAt, onClose]);

  useEffect(() => {
    if (!videoFailed) return undefined;
    const timer = window.setTimeout(() => advance(1), 2_000);
    return () => window.clearTimeout(timer);
  }, [story?.id, videoFailed, advance]);

  useEffect(() => {
    if (!story) return undefined;
    const onVisibilityChange = () => {
      if (document.hidden && !paused) {
        hiddenPauseRef.current = true;
        if (story.media?.resourceType !== 'video') {
          photoRemainingRef.current = Math.max(0, photoRemainingRef.current - (Date.now() - photoStartedAtRef.current));
        }
        setPaused(true);
        videoRef.current?.pause();
      } else if (!document.hidden && hiddenPauseRef.current) {
        hiddenPauseRef.current = false;
        setPaused(false);
        if (story.media?.resourceType === 'video') videoRef.current?.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [story?.id, paused]);

  useEffect(() => {
    if (story?.media?.resourceType === 'video' && videoRef.current) {
      videoRef.current.muted = muted;
      if (paused) videoRef.current.pause();
      else videoRef.current.play().catch(() => setPaused(true));
    }
  }, [story?.id, muted, paused, story?.media?.resourceType]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') advance(1);
      if (event.key === 'ArrowLeft') advance(-1);
      if (event.key === ' ' && !['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) {
        event.preventDefault();
        togglePause();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function loadViewers(after) {
    if (!story || !isOwner || viewsBusy) return;
    setViewsBusy(true);
    setError('');
    try {
      const result = await contentApi.storyViews(story.id, { after });
      setViewCount(Number(result.viewCount) || 0);
      setViewers((current) => after ? [...current, ...result.viewers] : result.viewers);
      setViewCursor(result.nextCursor || null);
    } catch (reason) {
      setError(reason.message || 'Could not load the viewer list.');
    } finally {
      setViewsBusy(false);
    }
  }

  async function toggleLike() {
    if (!story || likeBusy || isOwner) return;
    const nextLiked = !liked;
    setLikeBusy(true);
    setError('');
    try {
      const result = nextLiked
        ? await contentApi.likeStory(story.id)
        : await contentApi.unlikeStory(story.id);
      setLiked(Boolean(result.isLiked));
    } catch (reason) {
      setError(reason.message || 'Could not update the story like.');
    } finally {
      setLikeBusy(false);
    }
  }

  async function sendReaction(emoji) {
    if (!story) return;
    setReactionOpen(false);
    setError('');
    try {
      await contentApi.reactToStory(story.id, emoji);
      setFeedback(`Reaction ${emoji} sent`);
    } catch (reason) {
      setError(reason.message || 'Could not send this reaction.');
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    const text = reply.trim();
    if (!story || !text || replyBusy) return;
    setReplyBusy(true);
    setError('');
    try {
      await messageApi.replyToStory(story.id, text, replyIdRef.current || makeMessageId());
      setReply('');
      replyIdRef.current = makeMessageId();
      setFeedback('Reply sent');
    } catch (reason) {
      setError(reason.message || 'Could not send your reply.');
    } finally {
      setReplyBusy(false);
    }
  }

  async function shareStory() {
    if (!story) return;
    const url = `${window.location.origin}/story/${encodeURIComponent(story.id)}`;
    setError('');
    try {
      if (navigator.share) await navigator.share({ title: `Story from @${group.owner.username}`, url });
      else {
        await copyTextToClipboard(url);
        setFeedback('Story link copied');
      }
    } catch (reason) {
      if (reason?.name === 'AbortError') return;
      try {
        await copyTextToClipboard(url);
        setFeedback('Story link copied');
      } catch {
        setError('Could not share or copy this story link.');
      }
    }
  }

  async function copyStoryLink() {
    if (!story) return;
    try {
      await copyTextToClipboard(`${window.location.origin}/story/${encodeURIComponent(story.id)}`);
      setFeedback('Story link copied');
      setMenuOpen(false);
    } catch {
      setError('Clipboard access is unavailable in this browser.');
    }
  }

  async function reportStory() {
    if (!story) return;
    const reason = window.prompt('Why are you reporting this story?', '');
    if (reason === null) return;
    try {
      await contentApi.reportStory(story.id, reason);
      setFeedback('Story reported');
      setMenuOpen(false);
    } catch (requestError) {
      setError(requestError.message || 'Could not report this story.');
    }
  }

  async function deleteStory() {
    if (!story || !isOwner || !window.confirm('Delete this story?')) return;
    try {
      await contentApi.deleteStory(story.id);
      onDelete(story.id);
    } catch (reason) {
      setError(reason.message || 'Could not delete this story.');
    }
  }

  function togglePause() {
    if (!story) return;
    if (story.media?.resourceType === 'video') {
      if (paused) videoRef.current?.play().catch(() => setError('Video playback could not resume.'));
      else videoRef.current?.pause();
    } else if (!paused) {
      photoRemainingRef.current = Math.max(0, photoRemainingRef.current - (Date.now() - photoStartedAtRef.current));
      setPaused(true);
    } else {
      setPaused(false);
    }
  }

  function handleVideoTime() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    setProgress(Math.min(1, video.currentTime / video.duration));
  }

  function handleMediaClick(event) {
    if (touchSwipedRef.current) {
      touchSwipedRef.current = false;
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    advance(event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
  }

  function handleTouchStart(event) {
    const touch = event.changedTouches[0];
    if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event) {
    const touch = event.changedTouches[0];
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!touch || !start) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY)) {
      touchSwipedRef.current = true;
      advance(deltaX < 0 ? 1 : -1);
    }
  }

  if (!story || !group) return null;
  const isVideo = story.media?.resourceType === 'video';
  const storyTime = relativeStoryTime(story.createdAt);

  return <div className="story-viewer-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="story-viewer" role="dialog" aria-modal="true" aria-label={`Stories from @${group.owner.username}`}>
      <div className="story-viewer-progress" aria-label="Story progress">
        {group.stories.map((item, index) => <span className="story-viewer-progress-track" key={item.id}>
          <span style={{ transform: `scaleX(${index < storyIndex ? 1 : index === storyIndex ? progress : 0})` }} />
        </span>)}
      </div>
      <header className="story-viewer-header">
        <Link className="story-viewer-owner-link" to={`/profile/${encodeURIComponent(group.owner.id)}`} onClick={onClose} aria-label={`View @${group.owner.username} profile`}>
          <Avatar name={group.owner.displayName} src={group.owner.avatarUrl} size="small" />
          <span className="story-viewer-owner-copy">
            <strong>{group.owner.displayName || `@${group.owner.username}`}</strong>
            <span>@{group.owner.username}{storyTime && <time dateTime={story.createdAt}> · {storyTime}</time>}</span>
          </span>
        </Link>
        <div className="story-viewer-controls">
          {isOwner && <Link className="story-viewer-add" to="/create?kind=story" onClick={onClose}>Add another story</Link>}
          {isVideo && <button type="button" className="story-viewer-icon" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute story' : 'Mute story'} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>}
          <button type="button" className="story-viewer-icon" onClick={togglePause} aria-label={paused ? 'Resume story' : 'Pause story'} title={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <button type="button" className="story-viewer-icon" onClick={() => setMenuOpen((value) => !value)} aria-label="Story options" title="Story options"><Ellipsis size={20} /></button>
          <button type="button" className="story-viewer-icon" onClick={onClose} aria-label="Close story viewer"><X size={20} /></button>
        </div>
      </header>
      {menuOpen && <div className="story-viewer-menu" role="menu">
        <button type="button" role="menuitem" onClick={copyStoryLink}><Copy size={15} /> Copy story link</button>
        {!isOwner && <button type="button" role="menuitem" onClick={reportStory}>Report story</button>}
        {isOwner && <button type="button" role="menuitem" onClick={deleteStory}><Trash2 size={15} /> Delete story</button>}
      </div>}
      <article className="story-viewer-item" aria-busy={mediaLoading} onClick={handleMediaClick} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {mediaLoading && <div className="story-viewer-media-loading" role="status">Loading story…</div>}
        {isVideo
          ? <video
            ref={videoRef}
            key={story.id}
            src={story.media.secureUrl}
            poster={story.media.thumbnailUrl}
            playsInline
            muted={muted}
            autoPlay
            preload="auto"
            onTimeUpdate={handleVideoTime}
            onLoadedMetadata={(event) => {
              setMediaLoading(false);
              handleVideoTime(event);
            }}
            onEnded={() => advance(1)}
            onError={() => {
              setMediaLoading(false);
              setError('This story video could not be played. Skipping shortly.');
              setVideoFailed(true);
            }}
            onPause={() => setPaused(true)}
            onPlay={() => setPaused(false)}
          />
          : <img
            src={story.media?.secureUrl || story.media?.thumbnailUrl}
            alt={story.caption || `Story from ${group.owner.username}`}
            onLoad={() => setMediaLoading(false)}
            onError={() => {
              setMediaLoading(false);
              setError('This story photo could not be loaded.');
            }}
          />}
        {story.caption && <p>{story.caption}</p>}
        {paused && <button type="button" className="story-viewer-center-play" onClick={(event) => { event.stopPropagation(); togglePause(); }} aria-label="Resume story"><Play size={34} fill="currentColor" /></button>}
      </article>
      <button className="story-viewer-tap story-viewer-tap--previous" type="button" onClick={() => advance(-1)} aria-label="Previous story" />
      <button className="story-viewer-tap story-viewer-tap--next" type="button" onClick={() => advance(1)} aria-label="Next story" />
      {isOwner && <button type="button" className="story-viewer-views" onClick={() => {
        setViewsOpen((value) => !value);
        if (!viewsOpen) loadViewers();
      }} aria-label={`${viewCount ?? 0} story views`}>
        <Eye size={16} /> {viewCount ?? '—'} views
      </button>}
      {viewsOpen && isOwner && <aside className="story-viewer-viewers" aria-label="Story viewers">
        <strong>Viewed by {viewCount ?? 0}</strong>
        {viewers.map((viewer) => <Link className="story-viewer-viewer" key={viewer.id} to={`/profile/${encodeURIComponent(viewer.id)}`} onClick={onClose}>
          <Avatar name={viewer.displayName} src={viewer.avatarUrl} size="small" />
          <span><strong>{viewer.displayName}</strong><small>@{viewer.username}</small></span>
        </Link>)}
        {viewsBusy && <span>Loading viewers…</span>}
        {!viewsBusy && viewers.length === 0 && <span>No viewers yet.</span>}
        {viewCursor && <button type="button" onClick={() => loadViewers(viewCursor)} disabled={viewsBusy}>Load more</button>}
      </aside>}
      <footer className="story-viewer-engagement">
        {isOwner
          ? <span className="story-viewer-owner-hint"><Eye size={16} /> Your story</span>
          : <form onSubmit={sendReply}>
            <input value={reply} onChange={(event) => setReply(event.target.value)} maxLength={1000} placeholder={`Reply to @${group.owner.username}...`} aria-label={`Reply to @${group.owner.username}`} />
            <button type="submit" disabled={!reply.trim() || replyBusy} aria-label="Send story reply">{replyBusy ? <Check size={18} /> : <Send size={18} />}</button>
          </form>}
        {!isOwner && <button type="button" className={`story-viewer-action${liked ? ' is-liked' : ''}`} onClick={toggleLike} disabled={likeBusy} aria-label={liked ? 'Unlike story' : 'Like story'} title={liked ? 'Unlike' : 'Like'}>
          <Heart size={22} fill={liked ? 'currentColor' : 'none'} />
        </button>}
        <button type="button" className="story-viewer-action" onClick={shareStory} aria-label="Share story" title="Share story"><Share2 size={20} /></button>
        {!isOwner && <div className="story-viewer-reaction-wrap">
          <button type="button" className="story-viewer-action" onClick={() => setReactionOpen((value) => !value)} aria-label="React to story" title="React"><MessageCircle size={20} /></button>
          {reactionOpen && <div className="story-viewer-reactions" aria-label="Choose a reaction">
            {quickReactions.map((emoji) => <button key={emoji} type="button" onClick={() => sendReaction(emoji)} aria-label={`Send ${emoji} reaction`}>{emoji}</button>)}
          </div>}
        </div>}
      </footer>
      {feedback && <div className="story-viewer-feedback" role="status">{feedback}</div>}
      {error && <div className="story-viewer-error" role="alert">{error}</div>}
    </section>
  </div>;
}
