import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ReelsExperience } from './ReelsExperience.jsx';
import { contentApi, userApi } from '../services/api.js';
import { getReelPath, getReelUrl } from '../services/reelUrl.js';

vi.mock('../services/api.js', () => ({
  contentApi: {
    reel: vi.fn(),
    reels: vi.fn(),
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
  userApi: { follow: vi.fn(), unfollow: vi.fn() },
}));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'viewer-1', username: 'viewer' } }),
}));

const reel = {
  id: 'reel-1',
  caption: 'An actual Reel caption',
  owner: {
    id: 'creator-1',
    username: 'creator',
    displayName: 'Creator',
    avatarUrl: 'https://media.example/creator.jpg',
  },
  media: {
    resourceType: 'video',
    secureUrl: 'https://media.example/reel.mp4',
    thumbnailUrl: 'https://media.example/reel.jpg',
  },
  isFollowing: false,
};

function LocationOutput() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="current-location">{location.pathname}{location.search}</output>
    <button type="button" onClick={() => navigate(-1)}>Back history</button>
    <button type="button" onClick={() => navigate(1)}>Forward history</button>
  </>;
}

function renderReels(initialEntry = '/reels') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationOutput />
      <Routes>
        <Route path="/reels" element={<ReelsExperience viewer={{ id: 'viewer-1' }} />} />
        <Route path="/reels/:reelId" element={<ReelsExperience viewer={{ id: 'viewer-1' }} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReelsExperience', () => {
  beforeEach(() => {
    contentApi.reels.mockResolvedValue({ reels: [reel], nextCursor: null });
    contentApi.reel.mockResolvedValue({ reel });
    contentApi.like.mockResolvedValue({});
    contentApi.repost.mockResolvedValue({});
    contentApi.saveContent.mockResolvedValue({});
    contentApi.comments.mockResolvedValue({ comments: [], nextCursor: null });
    userApi.follow.mockResolvedValue({ following: true });
    userApi.unfollow.mockResolvedValue({ following: false });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('updates the active Reel URL and follows browser Back and Forward', async () => {
    let observerCallback;
    class TestIntersectionObserver {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      disconnect() {}
    }
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    contentApi.reels.mockResolvedValueOnce({
      reels: [reel, { ...reel, id: 'reel-2', caption: 'Second Reel' }],
      nextCursor: null,
    });

    try {
      renderReels();
      expect(await screen.findByText('An actual Reel caption')).toBeInTheDocument();
      expect(document.querySelector('[data-reel-id="reel-2"]')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/reels/reel-1'));

      act(() => observerCallback([{
        target: document.querySelector('[data-reel-index="1"]'),
        isIntersecting: true,
        intersectionRatio: 0.8,
      }]));
      expect(document.querySelector('[data-reel-id="reel-2"] video')).toHaveAttribute('preload', 'auto');
      await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/reels/reel-2'));

      fireEvent.click(screen.getByRole('button', { name: 'Back history' }));
      await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/reels/reel-1'));
      fireEvent.click(screen.getByRole('button', { name: 'Forward history' }));
      await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/reels/reel-2'));
    } finally {
      vi.unstubAllGlobals();
      if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      else delete HTMLElement.prototype.scrollIntoView;
    }
  });

  it('loads real Reel data and renders working engagement controls', async () => {
    renderReels();

    expect(await screen.findByText('@creator')).toBeInTheDocument();
    expect(contentApi.reels).toHaveBeenCalledWith(10, { signal: expect.any(AbortSignal) });
    expect(screen.getByText('An actual Reel caption')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comments' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repost' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Reel' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });

  it('loads a Reel by its stable ID when opened directly and preserves query parameters', async () => {
    renderReels('/reels/reel-1?source=share');

    expect(await screen.findByText('@creator')).toBeInTheDocument();
    expect(contentApi.reel).toHaveBeenCalledWith('reel-1', { signal: expect.any(AbortSignal) });
    expect(screen.getByTestId('current-location')).toHaveTextContent('/reels/reel-1?source=share');
  });

  it('shows an in-app unavailable state for a Reel that does not exist', async () => {
    contentApi.reel.mockRejectedValueOnce(Object.assign(new Error('Reel not found.'), { status: 404 }));
    renderReels('/reels/missing-reel');

    expect(await screen.findByRole('heading', { name: 'Reel not found' })).toBeInTheDocument();
    expect(screen.getByText('Reel not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Reels' })).toHaveAttribute('href', '/reels');
    expect(screen.getByTestId('current-location')).toHaveTextContent('/reels/missing-reel');
  });

  it('optimistically follows a creator and rolls back if the API fails', async () => {
    userApi.follow.mockRejectedValueOnce(new Error('Follow request failed.'));
    renderReels();

    const follow = await screen.findByRole('button', { name: 'Follow @creator' });
    fireEvent.click(follow);
    expect(await screen.findByText('Follow request failed.')).toBeInTheDocument();
    expect(userApi.follow).toHaveBeenCalledWith('creator-1');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow @creator' })).toBeEnabled());

    userApi.follow.mockResolvedValueOnce({ following: true });
    fireEvent.click(screen.getByRole('button', { name: 'Follow @creator' }));
    expect(await screen.findByRole('button', { name: 'Unfollow @creator' })).toHaveTextContent('Following');
  });

  describe('Reel URL helpers', () => {
    it('uses the canonical plural route and the current frontend origin', () => {
      expect(getReelPath('id/with space')).toBe('/reels/id%2Fwith%20space');
      expect(getReelUrl('reel-1', 'https://cliqhearts.onrender.com')).toBe(
        'https://cliqhearts.onrender.com/reels/reel-1',
      );
    });
  });

  it('shows a real empty-feed state with discovery and creation links', async () => {
    contentApi.reels.mockResolvedValueOnce({ reels: [], nextCursor: null });
    renderReels();

    expect(await screen.findByRole('heading', { name: 'No Reels yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Discover people' })).toHaveAttribute('href', '/search');
    expect(screen.getByRole('link', { name: 'Create a Reel' })).toHaveAttribute('href', '/create');
  });

  it('offers retry after a feed network error', async () => {
    contentApi.reels
      .mockRejectedValueOnce(new Error('Network unavailable.'))
      .mockResolvedValueOnce({ reels: [reel], nextCursor: null });
    renderReels();

    expect(await screen.findByRole('heading', { name: 'Reels are unavailable' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('@creator')).toBeInTheDocument();
    expect(contentApi.reels).toHaveBeenCalledTimes(2);
  });
});
