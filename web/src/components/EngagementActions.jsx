import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bookmark, Heart, MessageCircle, Repeat2, Send, Trash2,
} from 'lucide-react';
import { Avatar } from './Brand.jsx';
import { contentApi } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const maximumCommentLength = 2200;

function compactCount(value) {
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
    .format(Math.max(0, Number(value) || 0));
}

function commentDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

export function EngagementActions({ item, kind, onShare, onSavedChange, vertical = false, likeButtonRef }) {
  const { user } = useAuth();
  const contentKind = kind === 'reels' ? 'reels' : 'posts';
  const [liked, setLiked] = useState(Boolean(item.isLiked));
  const [likeCount, setLikeCount] = useState(Number.isFinite(item.likeCount) ? item.likeCount : null);
  const [commentCount, setCommentCount] = useState(Number.isFinite(item.commentCount) ? item.commentCount : null);
  const [repostCount, setRepostCount] = useState(Number.isFinite(item.repostCount) ? item.repostCount : null);
  const [reposted, setReposted] = useState(Boolean(item.isReposted));
  const [saved, setSaved] = useState(Boolean(item.isSaved));
  const [busy, setBusy] = useState({});
  const busyRef = useRef(new Set());
  const initializedItemState = useRef(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);

  useEffect(() => {
    if (!initializedItemState.current) {
      initializedItemState.current = true;
      return;
    }
    setLiked(Boolean(item.isLiked));
    setLikeCount(Number.isFinite(item.likeCount) ? item.likeCount : null);
    setCommentCount(Number.isFinite(item.commentCount) ? item.commentCount : null);
    setRepostCount(Number.isFinite(item.repostCount) ? item.repostCount : null);
    setReposted(Boolean(item.isReposted));
    setSaved(Boolean(item.isSaved));
  }, [item.id, item.isLiked, item.likeCount, item.commentCount, item.repostCount, item.isReposted, item.isSaved]);

  async function optimisticAction(key, apply, request, rollback, message, reconcile) {
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    setBusy((current) => ({ ...current, [key]: true }));
    setError('');
    apply();
    try {
      const result = await request();
      reconcile?.(result);
      return true;
    } catch (reason) {
      rollback();
      setError(reason?.message || message);
      return false;
    } finally {
      busyRef.current.delete(key);
      setBusy((current) => ({ ...current, [key]: false }));
    }
  }

  function toggleLike() {
    const previous = liked;
    const next = !previous;
    const previousCount = likeCount;
    void optimisticAction(
      'like',
      () => { setLiked(next); setLikeCount(previousCount === null ? (next ? 1 : null) : Math.max(0, previousCount + (next ? 1 : -1))); },
      () => next ? contentApi.like(contentKind, item.id) : contentApi.unlike(contentKind, item.id),
      () => { setLiked(previous); setLikeCount(previousCount); },
      'Could not update your like.',
      (result) => {
        if (Number.isFinite(result?.likeCount)) setLikeCount(result.likeCount);
      },
    );
  }

  function toggleSaved() {
    const previous = saved;
    const next = !previous;
    void optimisticAction(
      'save',
      () => setSaved(next),
      () => next ? contentApi.saveContent(contentKind, item.id) : contentApi.unsaveContent(contentKind, item.id),
      () => setSaved(previous),
      'Could not update saved content.',
    ).then((succeeded) => { if (succeeded) onSavedChange?.(next); });
  }

  function toggleRepost() {
    const previous = reposted;
    const next = !previous;
    void optimisticAction(
      'repost',
      () => { setReposted(next); setRepostCount((count) => count === null ? (next ? 1 : null) : Math.max(0, count + (next ? 1 : -1))); },
      () => next ? contentApi.repost(contentKind, item.id) : contentApi.undoRepost(contentKind, item.id),
      () => { setReposted(previous); setRepostCount((count) => count === null ? (previous ? 1 : null) : Math.max(0, count + (previous ? 1 : -1))); },
      'Could not update your repost.',
      (result) => {
        if (Number.isFinite(result?.repostCount)) setRepostCount(result.repostCount);
      },
    ).then((succeeded) => {
      if (succeeded) setNotice(next ? 'Reposted to your profile.' : 'Repost removed.');
    });
  }

  const buttonClass = `content-engagement-button${vertical ? ' reel-action' : ''}`;
  const contentLabel = kind === 'reels' ? 'Reel' : 'post';
  return <>
    <div className={`content-engagement-actions${vertical ? ' content-engagement-actions--vertical' : ''}`}>
      <button ref={likeButtonRef} type="button" className={`${buttonClass}${liked ? ' is-liked' : ''}`} onClick={toggleLike} disabled={Boolean(busy.like)} aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked}>
        <Heart size={vertical ? 25 : 23} fill={liked ? 'currentColor' : 'none'} />{likeCount !== null && compactCount(likeCount)}
      </button>
      <button type="button" className={buttonClass} onClick={() => { setError(''); setCommentsOpen(true); }} aria-label="Comments">
        <MessageCircle size={vertical ? 25 : 23} />{commentCount !== null && compactCount(commentCount)}
      </button>
      <button type="button" className={`${buttonClass}${reposted ? ' is-reposted' : ''}`} onClick={toggleRepost} disabled={Boolean(busy.repost)} aria-label={reposted ? 'Undo repost' : 'Repost'} aria-pressed={reposted}>
        <Repeat2 size={vertical ? 24 : 23} />{repostCount !== null && compactCount(repostCount)}
      </button>
      {onShare && <button type="button" className={buttonClass} onClick={() => onShare(item)} aria-label={kind === 'reels' ? 'Share Reel' : 'Share post'}>
        <Send size={vertical ? 24 : 22} />
      </button>}
      <button type="button" className={`${buttonClass} content-engagement-save${saved ? ' is-saved' : ''}`} onClick={toggleSaved} disabled={Boolean(busy.save)} aria-label={saved ? `Remove saved ${contentLabel}` : `Save ${contentLabel}`} aria-pressed={saved}>
        <Bookmark size={vertical ? 23 : 22} fill={saved ? 'currentColor' : 'none'} />
      </button>
    </div>
    {notice && <p className="content-action-notice" role="status">{notice}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {commentsOpen && <CommentsPanel
      item={item}
      kind={contentKind}
      viewerId={user?.id}
      onClose={() => setCommentsOpen(false)}
      onCommentCount={(count, delta) => setCommentCount((current) =>
        Number.isFinite(count) ? count : Math.max(0, (current || 0) + delta))}
    />}
  </>;
}

function CommentsPanel({ item, kind, viewerId, onClose, onCommentCount }) {
  const [comments, setComments] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingComment, setEditingComment] = useState(null);
  const [editText, setEditText] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const commentLikeBusy = useRef(new Set());
  const textareaRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    contentApi.comments(kind, item.id, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setComments(result.comments || []);
      setCursor(result.nextCursor || null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason?.message || 'Could not load comments.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [item.id, kind]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  async function submitComment(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value || value.length > maximumCommentLength || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await contentApi.createComment(kind, item.id, value, replyTo?.id);
      const created = result.comment;
      if (!created) throw new Error('The API returned no comment.');
      setComments((current) => [...current, created]);
      setText('');
      setReplyTo(null);
      onCommentCount(result.commentCount, 1);
    } catch (reason) {
      setError(reason?.message || 'Could not send your comment.');
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await contentApi.comments(kind, item.id, { after: cursor });
      setComments((current) => [...current, ...(result.comments || [])]);
      setCursor(result.nextCursor || null);
    } catch (reason) {
      setError(reason?.message || 'Could not load more comments.');
    } finally {
      setLoadingMore(false);
    }
  }

  function beginReply(comment) {
    setReplyTo(comment);
    textareaRef.current?.focus();
  }

  function beginEdit(comment) {
    setEditingComment(comment);
    setEditText(comment.text);
  }

  async function saveEdit() {
    const value = editText.trim();
    if (!editingComment || !value || value.length > maximumCommentLength || editBusy) return;
    setEditBusy(true);
    setError('');
    try {
      const result = await contentApi.updateComment(editingComment.id, value);
      const updated = result.comment;
      if (!updated) throw new Error('The API returned no updated comment.');
      setComments((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setEditingComment(null);
    } catch (reason) {
      setError(reason?.message || 'Could not update your comment.');
    } finally {
      setEditBusy(false);
    }
  }

  async function removeComment(comment) {
    if (comment.author?.id !== viewerId || !window.confirm('Delete this comment?')) return;
    setError('');
    try {
      const result = await contentApi.deleteComment(comment.id);
      setComments((current) => current.filter((entry) => entry.id !== comment.id));
      onCommentCount(result.commentCount, -1);
    } catch (reason) {
      setError(reason?.message || 'Could not delete the comment.');
    }
  }

  async function toggleCommentLike(comment) {
    if (commentLikeBusy.current.has(comment.id)) return;
    commentLikeBusy.current.add(comment.id);
    const previous = Boolean(comment.isLiked);
    setComments((current) => current.map((entry) => entry.id === comment.id
      ? { ...entry, isLiked: !previous, likeCount: Math.max(0, (entry.likeCount || 0) + (previous ? -1 : 1)) }
      : entry));
    try {
      const result = await (previous ? contentApi.unlikeComment(comment.id) : contentApi.likeComment(comment.id));
      if (Number.isFinite(result?.likeCount)) {
        setComments((current) => current.map((entry) => entry.id === comment.id
          ? { ...entry, isLiked: result.liked, likeCount: result.likeCount }
          : entry));
      }
    } catch (reason) {
      setComments((current) => current.map((entry) => entry.id === comment.id
        ? { ...entry, isLiked: previous, likeCount: Math.max(0, (entry.likeCount || 0) + (previous ? 1 : -1)) }
        : entry));
      setError(reason?.message || 'Could not update comment like.');
    } finally {
      commentLikeBusy.current.delete(comment.id);
    }
  }

  return <div className="modal-backdrop comments-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="modal-card comments-panel" role="dialog" aria-modal="true" aria-labelledby="comments-title">
      <header className="modal-header">
        <h2 id="comments-title">Comments</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close comments">×</button>
      </header>
      <div className="comments-list" aria-live="polite">
        {loading && <p role="status">Loading comments…</p>}
        {!loading && !error && comments.length === 0 && <p className="comments-empty">No comments yet. Start the conversation.</p>}
        {comments.filter((comment) => !comment.parentCommentId).map((comment) => <article className="comment-item" key={comment.id}>
          <Link className="comment-avatar" to={`/profile/${encodeURIComponent(comment.author?.id || '')}`} onClick={onClose} aria-label={`View @${comment.author?.username || 'member'} profile`}>
            <Avatar name={comment.author?.displayName || comment.author?.username} src={comment.author?.avatarUrl} size="small" />
          </Link>
          <div className="comment-content">
            <p><Link to={`/profile/${encodeURIComponent(comment.author?.id || '')}`} onClick={onClose}><strong>@{comment.author?.username || 'member'}</strong></Link> {comment.text}</p>
            <div className="comment-meta"><time dateTime={comment.createdAt}>{commentDate(comment.createdAt)}</time>
              <button type="button" onClick={() => beginReply(comment)}>Reply</button>
              {comment.author?.id === viewerId && <>
                <button type="button" onClick={() => beginEdit(comment)} aria-label="Edit comment">Edit</button>
                <button type="button" onClick={() => removeComment(comment)} aria-label="Delete comment"><Trash2 size={13} /></button>
              </>}
              <button type="button" onClick={() => toggleCommentLike(comment)} aria-label={comment.isLiked ? 'Unlike comment' : 'Like comment'}>{comment.isLiked ? '♥' : '♡'} {compactCount(comment.likeCount)}</button>
            </div>
            {comments.filter((reply) => reply.parentCommentId === comment.id).map((reply) => <div className="comment-reply" key={reply.id}>
              <Link to={`/profile/${encodeURIComponent(reply.author?.id || '')}`} onClick={onClose}><Avatar name={reply.author?.username} src={reply.author?.avatarUrl} size="small" /></Link>
              <div className="comment-reply-content"><p><Link to={`/profile/${encodeURIComponent(reply.author?.id || '')}`} onClick={onClose}><strong>@{reply.author?.username || 'member'}</strong></Link> {reply.text}</p>
                <div className="comment-meta">
                  <button type="button" onClick={() => toggleCommentLike(reply)} aria-label={reply.isLiked ? 'Unlike reply' : 'Like reply'}>{reply.isLiked ? '♥' : '♡'} {compactCount(reply.likeCount)}</button>
                  {reply.author?.id === viewerId && <>
                    <button type="button" onClick={() => beginEdit(reply)} aria-label="Edit reply">Edit</button>
                    <button type="button" onClick={() => removeComment(reply)} aria-label="Delete reply"><Trash2 size={13} /></button>
                  </>}
                </div>
              </div>
            </div>)}
          </div>
        </article>)}
        {error && <p className="form-error" role="alert">{error}</p>}
        {cursor && <button type="button" className="button button--outline load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more comments'}</button>}
      </div>
      <form className="comment-composer" onSubmit={submitComment}>
        {editingComment && <div className="comment-edit-form">
          <label htmlFor={`comment-edit-${item.id}`}>Edit your comment</label>
          <textarea id={`comment-edit-${item.id}`} value={editText} onChange={(event) => setEditText(event.target.value)} maxLength={maximumCommentLength} rows={2} />
          <div className="comment-composer-footer"><span>{editText.length}/{maximumCommentLength}</span><div>
            <button type="button" className="button button--outline" onClick={() => setEditingComment(null)}>Cancel</button>
            <button type="button" className="button button--primary" onClick={saveEdit} disabled={!editText.trim() || editBusy}>{editBusy ? 'Saving…' : 'Save'}</button>
          </div></div>
        </div>}
        {replyTo && <p className="replying-to">Replying to @{replyTo.author?.username || 'member'} <button type="button" onClick={() => setReplyTo(null)}>Cancel</button></p>}
        <label className="sr-only" htmlFor={`comment-text-${item.id}`}>Write a comment</label>
        <textarea id={`comment-text-${item.id}`} ref={textareaRef} value={text} onChange={(event) => setText(event.target.value)} maxLength={maximumCommentLength} placeholder="Add a comment…" rows={2} />
        <div className="comment-composer-footer"><span>{text.length}/{maximumCommentLength}</span><button className="button button--primary" type="submit" disabled={!text.trim() || submitting}>{submitting ? 'Posting…' : 'Post'}</button></div>
      </form>
    </section>
  </div>;
}
