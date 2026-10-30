import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContentFeed } from './Content.jsx';
import { contentApi } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  contentApi: {
    deletePost: vi.fn(),
    deleteReel: vi.fn(),
    posts: vi.fn(),
    reels: vi.fn(),
    savePost: vi.fn(),
    unsavePost: vi.fn(),
    like: vi.fn(),
    unlike: vi.fn(),
    repost: vi.fn(),
    undoRepost: vi.fn(),
    saveContent: vi.fn(),
    unsaveContent: vi.fn(),
    comments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    likeComment: vi.fn(),
    unlikeComment: vi.fn(),
  },
  userApi: {},
}));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'viewer-1', username: 'viewer' } }),
}));

const makePost = (id, resourceType = 'image') => ({
  id,
  caption: `Caption for ${id}`,
  createdAt: new Date('2026-10-28T10:00:00Z').toISOString(),
  owner: { id: `owner-${id}`, username: `creator-${id}`, displayName: `Creator ${id}` },
  media: {
    resourceType,
    secureUrl: `https://media.example/${id}.${resourceType === 'video' ? 'mp4' : 'jpg'}`,
    thumbnailUrl: `https://media.example/${id}.jpg`,
  },
  isSaved: false,
});

const originalNavigatorDescriptors = {
  clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
  share: Object.getOwnPropertyDescriptor(navigator, 'share'),
};

function renderHomeFeed() {
  return render(
    <MemoryRouter>
      <ContentFeed includeReels showSuggestedLabels />
    </MemoryRouter>,
  );
}

describe('Home feed interactions', () => {
  beforeEach(() => {
    contentApi.posts.mockResolvedValue({ posts: [makePost('post-1')], nextCursor: null });
    contentApi.reels.mockResolvedValue({ reels: [], nextCursor: null });
    contentApi.savePost.mockResolvedValue({});
    contentApi.unsavePost.mockResolvedValue({});
    contentApi.like.mockResolvedValue({});
    contentApi.unlike.mockResolvedValue({});
    contentApi.repost.mockResolvedValue({});
    contentApi.undoRepost.mockResolvedValue({});
    contentApi.saveContent.mockResolvedValue({});
    contentApi.unsaveContent.mockResolvedValue({});
    contentApi.comments.mockResolvedValue({ comments: [], nextCursor: null });
    contentApi.createComment.mockImplementation(async (_kind, _id, text) => ({
      comment: { id: 'comment-1', text, author: { id: 'viewer-1', username: 'viewer' } },
    }));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [key, descriptor] of Object.entries(originalNavigatorDescriptors)) {
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else delete navigator[key];
    }
  });

  it('places persistent engagement actions below the media', async () => {
    renderHomeFeed();
    const card = await screen.findByText('Caption for post-1').then((caption) => caption.closest('.content-card'));
    const media = card.querySelector('.content-card-media');
    const actions = card.querySelector('.content-engagement-actions');
    const caption = card.querySelector('.content-card-caption-block');

    expect(media.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(actions).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Like',
      'Comments',
      'Repost',
      'Share post',
      'Save post',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(await screen.findByRole('button', { name: /^Unlike/ })).toHaveAttribute('aria-pressed', 'true');
    expect(contentApi.like).toHaveBeenCalledWith('posts', 'post-1');
  });

  it('optimistically saves a post and rolls back when the API fails', async () => {
    contentApi.saveContent.mockRejectedValueOnce(new Error('Save failed.'));
    renderHomeFeed();
    const saveButton = await screen.findByRole('button', { name: 'Save post' });
    fireEvent.click(saveButton);

    expect(await screen.findByRole('button', { name: 'Remove saved post' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed.');
    expect(screen.getByRole('button', { name: 'Save post' })).toBeInTheDocument();
  });

  it('opens comments and posts non-empty comment text to the API', async () => {
    renderHomeFeed();
    fireEvent.click(await screen.findByRole('button', { name: 'Comments' }));
    expect(await screen.findByText('No comments yet. Start the conversation.')).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Write a comment' });
    fireEvent.change(input, { target: { value: 'A real comment 🙂' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(contentApi.createComment).toHaveBeenCalledWith('posts', 'post-1', 'A real comment 🙂', undefined));
    expect(await screen.findByText('A real comment 🙂')).toBeInTheDocument();
  });

  it('copies a canonical post link when native sharing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    renderHomeFeed();

    fireEvent.click(await screen.findByRole('button', { name: 'Share post' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/post/post-1`,
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('Post link copied.');
  });

  it('updates the visible mute control and offers retry after playback failure', async () => {
    contentApi.posts.mockResolvedValue({
      posts: [makePost('video-1', 'video')],
      nextCursor: null,
    });
    renderHomeFeed();
    const video = await screen.findByLabelText('Video by @creator-video-1');

    fireEvent.click(screen.getByRole('button', { name: 'Unmute video' }));
    await waitFor(() => expect(video).toHaveProperty('muted', false));
    expect(screen.getByRole('button', { name: 'Mute video' })).toBeInTheDocument();

    fireEvent.error(video);
    expect(await screen.findByRole('alert')).toHaveTextContent('Video playback failed.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
  });

  it('autoplays only videos meeting the visibility threshold and pauses them when they leave', async () => {
    const observers = [];
    class TestIntersectionObserver {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.target = null;
        observers.push(this);
      }
      observe(target) { this.target = target; }
      disconnect() {}
      trigger(ratio) {
        this.callback([{
          target: this.target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        }]);
      }
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    contentApi.posts.mockResolvedValue({
      posts: [makePost('video-1', 'video'), makePost('video-2', 'video')],
      nextCursor: null,
    });
    renderHomeFeed();

    await screen.findByLabelText('Video by @creator-video-1');
    await screen.findByLabelText('Video by @creator-video-2');
    await waitFor(() => expect(observers).toHaveLength(2));
    expect(observers[0].options.threshold).toContain(0.6);

    act(() => observers[0].trigger(0.59));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    act(() => observers[0].trigger(0.6));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));

    act(() => observers[1].trigger(0.75));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    const [firstVideo, secondVideo] = document.querySelectorAll('.content-card-video-wrap video');
    expect(firstVideo.pause).toHaveBeenCalled();
    expect(secondVideo).toHaveProperty('muted', true);

    act(() => observers[1].trigger(0));
    expect(secondVideo.pause).toHaveBeenCalled();
  });

  it('does not autoplay when reduced motion is enabled', async () => {
    class TestIntersectionObserver {
      constructor(callback) { this.callback = callback; }
      observe(target) { this.target = target; }
      disconnect() {}
      trigger() {
        this.callback([{
          target: this.target,
          isIntersecting: true,
          intersectionRatio: 1,
        }]);
      }
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    window.matchMedia = globalThis.matchMedia;
    contentApi.posts.mockResolvedValue({ posts: [makePost('video-1', 'video')], nextCursor: null });
    renderHomeFeed();

    await screen.findByLabelText('Video by @creator-video-1');
    await act(async () => Promise.resolve());
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});
