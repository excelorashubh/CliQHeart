import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './pages.jsx';
import { contentApi, userApi } from './services/api.js';

const { currentUser } = vi.hoisted(() => ({
  currentUser: {
    id: 'current-user',
    username: 'current_user',
    displayName: 'Current User',
    avatarUrl: 'https://images.example/current.jpg',
  },
}));

vi.mock('./context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: currentUser }),
}));

const feedPost = (id, username, isFollowing) => ({
  id,
  owner: {
    id: `${id}-owner`,
    username,
    displayName: username,
    avatarUrl: `https://images.example/${username}.jpg`,
  },
  media: {
    resourceType: 'image',
    secureUrl: `https://images.example/${id}.jpg`,
  },
  caption: `A post by ${username}`,
  createdAt: '2026-10-28T15:00:00.000Z',
  isFollowing,
  isSaved: false,
});

function renderHome() {
  return render(<MemoryRouter><HomePage /></MemoryRouter>);
}

afterEach(() => vi.restoreAllMocks());

describe('HomePage feed experience', () => {
  it('loads stories above real posts and only labels non-followed authors as suggested', async () => {
    vi.spyOn(contentApi, 'stories').mockResolvedValue({
      stories: [{
        id: 'story-1',
        owner: { id: 'friend-id', username: 'friend', displayName: 'Friend', avatarUrl: '' },
        media: { resourceType: 'image', secureUrl: 'https://images.example/story.jpg' },
        caption: 'Hello from a story',
      }],
    });
    const postApi = vi.spyOn(contentApi, 'posts').mockResolvedValue({
      posts: [feedPost('suggested-post', 'new_person', false), feedPost('following-post', 'followed_person', true)],
      nextCursor: null,
    });
    vi.spyOn(contentApi, 'reels').mockResolvedValue({
      reels: [{
        ...feedPost('reel-1', 'reel_author', true),
        createdAt: '2026-10-29T10:00:00.000Z',
        feedType: 'reels',
        media: { resourceType: 'video', secureUrl: 'https://images.example/reel.mp4' },
      }],
      nextCursor: null,
    });
    vi.spyOn(userApi, 'suggestions').mockResolvedValue({ users: [] });

    const { container } = renderHome();

    const storyButton = await screen.findByRole('button', { name: '@friend' });
    await screen.findByText('For you');
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/explore/people/');
    const suggestedLabels = container.querySelectorAll('.content-suggested-label');
    expect(suggestedLabels).toHaveLength(1);
    expect(storyButton.compareDocumentPosition(suggestedLabels[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('A post by new_person')).toBeInTheDocument();
    expect(screen.getByText('A post by followed_person')).toBeInTheDocument();
    expect(screen.getByText('Reel')).toBeInTheDocument();
    expect(container.querySelector('video')).not.toHaveProperty('autoplay', true);
    expect(screen.getAllByText('Suggested for you')).toHaveLength(2);
    expect(postApi).toHaveBeenCalledWith(30, expect.objectContaining({ signal: expect.any(AbortSignal) }));

    fireEvent.click(storyButton);
    expect(screen.getByRole('dialog', { name: 'Stories from @friend' })).toBeInTheDocument();
    expect(screen.getByAltText('Hello from a story')).toHaveAttribute(
      'src',
      'https://images.example/story.jpg',
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('follows a real suggested account and removes it from the suggestion list after success', async () => {
    vi.spyOn(contentApi, 'stories').mockResolvedValue({ stories: [] });
    vi.spyOn(contentApi, 'posts').mockResolvedValue({ posts: [], nextCursor: null });
    vi.spyOn(contentApi, 'reels').mockResolvedValue({ reels: [], nextCursor: null });
    vi.spyOn(userApi, 'suggestions').mockResolvedValue({
      users: [{
        id: 'suggestion-id',
        username: 'suggested_person',
        displayName: 'Suggested Person',
        avatarUrl: 'https://images.example/suggested.jpg',
        isFollowing: false,
      }],
    });
    const follow = vi.spyOn(userApi, 'follow').mockResolvedValue({ following: true });

    renderHome();
    const person = await screen.findByText('@suggested_person');
    const card = person.closest('.home-suggestion');
    expect(card).not.toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Follow' }));

    await waitFor(() => expect(follow).toHaveBeenCalledWith('suggestion-id'));
    await waitFor(() => expect(screen.queryByText('@suggested_person')).not.toBeInTheDocument());
  });

  it('loads the next feed page without duplicating existing posts', async () => {
    vi.spyOn(contentApi, 'stories').mockResolvedValue({ stories: [] });
    vi.spyOn(contentApi, 'reels').mockResolvedValue({ reels: [], nextCursor: null });
    const postApi = vi.spyOn(contentApi, 'posts')
      .mockResolvedValueOnce({ posts: [feedPost('first-post', 'first_author', false)], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ posts: [feedPost('second-post', 'second_author', false)], nextCursor: null });
    vi.spyOn(userApi, 'suggestions').mockResolvedValue({ users: [] });

    renderHome();
    expect(await screen.findByText('A post by first_author')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('A post by second_author')).toBeInTheDocument();
    expect(postApi).toHaveBeenLastCalledWith(30, { after: 'cursor-1' });
  });
});
