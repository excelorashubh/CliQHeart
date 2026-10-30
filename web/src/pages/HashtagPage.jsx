import { useEffect, useRef, useState } from 'react';
import { Hash, Play } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState } from '../components/Feedback.jsx';
import { contentApi } from '../services/api.js';
import { getReelPath } from '../services/reelUrl.js';

export function HashtagPage() {
  const { tag = '' } = useParams();
  const [hashtag, setHashtag] = useState(null);
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const pageRequest = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    pageRequest.current?.abort();
    pageRequest.current = controller;
    setLoading(true);
    setError('');
    setHashtag(null);
    setItems([]);
    setNextCursor(null);
    contentApi.hashtag(tag, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setHashtag(result.hashtag);
      setItems(result.items || []);
      setNextCursor(result.nextCursor || null);
    }).catch((reason) => {
      if (!controller.signal.aborted && reason.status === 404) {
        setHashtag({ name: tag, usageCount: 0 });
      } else if (!controller.signal.aborted && reason.name !== 'AbortError') {
        setError(reason.message || 'Could not load this hashtag.');
      }
    }).finally(() => {
      if (pageRequest.current === controller) pageRequest.current = null;
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      if (pageRequest.current === controller) pageRequest.current = null;
    };
  }, [tag, reloadKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore || pageRequest.current) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setLoadingMore(true);
    setMoreError('');
    try {
      const result = await contentApi.hashtag(tag, { after: nextCursor, signal: controller.signal });
      if (!controller.signal.aborted) {
        setItems((current) => {
          const known = new Set(current.map((item) => `${item.contentType}:${item.id}`));
          return [...current, ...(result.items || []).filter((item) => !known.has(`${item.contentType}:${item.id}`))];
        });
        setNextCursor(result.nextCursor || null);
      }
    } catch (reason) {
      if (!controller.signal.aborted && reason.name !== 'AbortError') {
        setMoreError(reason.message || 'Could not load more hashtag content.');
      }
    } finally {
      if (pageRequest.current === controller) pageRequest.current = null;
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  return <main className="page-content hashtag-page">
    <header className="page-heading hashtag-page-heading">
      <div>
        <p className="eyebrow">EXPLORE A TOPIC</p>
        <h1>#{hashtag?.name || tag}</h1>
        {!loading && hashtag && <p className="heading-subtitle">{hashtag.usageCount} {hashtag.usageCount === 1 ? 'post' : 'posts'} and Reels</p>}
      </div>
      <Link to="/search" className="button button--outline">Back to Explore</Link>
    </header>
    {loading && <div className="hashtag-media-grid" aria-label="Loading hashtag content" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => <span className="hashtag-media-placeholder" key={index} />)}
    </div>}
    {!loading && error && <ErrorState error={error} onRetry={() => setReloadKey((key) => key + 1)} />}
    {!loading && !error && items.length === 0 && <EmptyState
      title={`No content for #${hashtag?.name || tag}`}
      description="Public posts and Reels using this hashtag will appear here."
      icon={Hash}
    />}
    {!loading && !error && items.length > 0 && <div className="hashtag-media-grid" aria-label={`Content tagged #${hashtag?.name || tag}`}>
      {items.map((item) => {
        const isReel = item.contentType === 'reel';
        const isVideo = item.media?.resourceType === 'video';
        const thumbnail = item.media?.thumbnailUrl || (!isVideo ? item.media?.secureUrl : null);
        const href = isReel ? getReelPath(item.id) : `/post/${encodeURIComponent(item.id)}`;
        return <Link
          className="hashtag-media-item"
          key={`${item.contentType}:${item.id}`}
          to={href}
          aria-label={`Open ${isReel ? 'Reel' : 'post'} tagged #${hashtag?.name || tag}`}
        >
          {thumbnail
            ? <img src={thumbnail} alt="" loading="lazy" />
            : <span className="hashtag-media-placeholder" aria-hidden="true" />}
          {(isReel || isVideo) && <span className="hashtag-media-indicator" aria-label={isReel ? 'Reel' : 'Video'}><Play size={14} fill="currentColor" /></span>}
        </Link>;
      })}
    </div>}
    {moreError && <p className="inline-error" role="alert">{moreError}</p>}
    {nextCursor && <button className="button button--outline load-more" type="button" onClick={loadMore} disabled={loadingMore}>
      {loadingMore ? 'Loading…' : 'Load more'}
    </button>}
  </main>;
}
