import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StoryViewer } from './StoryViewer.jsx';
import { contentApi, messageApi } from '../services/api.js';

const { signedInUser } = vi.hoisted(() => ({
  signedInUser: { id: 'viewer-id', username: 'viewer', displayName: 'Viewer Name' },
}));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: signedInUser }),
}));

const story = {
  id: 'story-id',
  createdAt: new Date().toISOString(),
  caption: 'A real story',
  owner: {
    id: 'owner-id',
    username: 'story_owner',
    displayName: 'Story Owner',
    avatarUrl: 'https://images.example/owner.jpg',
  },
  media: {
    resourceType: 'image',
    secureUrl: 'https://images.example/story.jpg',
    thumbnailUrl: 'https://images.example/story-thumb.jpg',
  },
};

function renderViewer(overrides = {}) {
  const onAdvance = vi.fn();
  render(<MemoryRouter><StoryViewer
    groups={[{ owner: story.owner, stories: [story] }]}
    groupIndex={0}
    storyIndex={0}
    onAdvance={onAdvance}
    onClose={vi.fn()}
    onDelete={vi.fn()}
    {...overrides}
  /></MemoryRouter>);
  return onAdvance;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('StoryViewer', () => {
  it('uses the story owner identity and profile link, not the signed-in viewer identity', () => {
    vi.spyOn(contentApi, 'viewStory').mockResolvedValue({ viewCount: 0, isLiked: false });
    renderViewer();

    expect(screen.getByText('Story Owner')).toBeInTheDocument();
    expect(screen.getByText('@story_owner')).toBeInTheDocument();
    expect(screen.queryByText('Viewer Name')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View @story_owner profile' })).toHaveAttribute('href', '/profile/owner-id');
  });

  it('advances photo stories after ten seconds and pauses without losing remaining time', async () => {
    vi.useFakeTimers();
    vi.spyOn(contentApi, 'viewStory').mockResolvedValue({ viewCount: 0, isLiked: false });
    const advance = renderViewer();

    await act(async () => { await Promise.resolve(); });
    fireEvent.load(screen.getByAltText('A real story'));
    await act(async () => { vi.advanceTimersByTime(4_000); });
    fireEvent.click(screen.getByRole('button', { name: 'Pause story' }));
    await act(async () => { vi.advanceTimersByTime(12_000); });
    expect(advance).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Resume story' })[0]);
    await act(async () => { vi.advanceTimersByTime(5_999); });
    expect(advance).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(advance).toHaveBeenCalledWith(1);
  });

  it('restores persisted liked state and sends story replies through messaging', async () => {
    vi.spyOn(contentApi, 'viewStory').mockResolvedValue({ viewCount: 1, isLiked: true });
    const unlike = vi.spyOn(contentApi, 'unlikeStory').mockResolvedValue({ isLiked: false });
    vi.spyOn(messageApi, 'replyToStory').mockResolvedValue({ sent: true });
    renderViewer();

    expect(await screen.findByRole('button', { name: 'Unlike story' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unlike story' }));
    await waitFor(() => expect(unlike).toHaveBeenCalledWith('story-id'));
    expect(await screen.findByRole('button', { name: 'Like story' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply to @story_owner' }), { target: { value: 'Hello!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send story reply' }));

    await waitFor(() => expect(messageApi.replyToStory).toHaveBeenCalledWith(
      'story-id',
      'Hello!',
      expect.any(String),
    ));
    expect(await screen.findByText('Reply sent')).toBeInTheDocument();
  });

  it('uses video duration for progress and advances only when playback ends', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(contentApi, 'viewStory').mockResolvedValue({ viewCount: 0, isLiked: false });
    const videoStory = {
      ...story,
      media: { resourceType: 'video', secureUrl: 'https://images.example/story.mp4' },
    };
    const advance = renderViewer({
      groups: [{ owner: story.owner, stories: [videoStory] }],
    });
    const video = document.querySelector('.story-viewer-item video');
    Object.defineProperties(video, {
      duration: { configurable: true, value: 8 },
      currentTime: { configurable: true, value: 4 },
    });
    fireEvent.loadedMetadata(video);
    fireEvent.timeUpdate(video);

    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(advance).not.toHaveBeenCalled();
    expect(document.querySelector('.story-viewer-progress-track > span')).toHaveStyle({ transform: 'scaleX(0.5)' });
    fireEvent.ended(video);
    expect(advance).toHaveBeenCalledWith(1);
  });
});
