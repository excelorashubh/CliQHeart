import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ExplorePeoplePage } from './pages.jsx';
import { contentApi, userApi } from './services/api.js';

const person = {
  id: 'person-1',
  username: 'amber_person',
  displayName: 'Amber Person',
  avatarUrl: 'https://images.example/amber.jpg',
  isFollowing: false,
  mutualCount: 1,
  mutualUsernames: ['friend_one'],
};

function renderExplore() {
  return render(<MemoryRouter initialEntries={['/explore/people/']}><ExplorePeoplePage /></MemoryRouter>);
}

afterEach(() => vi.restoreAllMocks());

describe('ExplorePeoplePage', () => {
  it('loads real recommendations and follows or unfollows through the API', async () => {
    vi.spyOn(userApi, 'suggestions').mockResolvedValue({ users: [person], nextCursor: null });
    const follow = vi.spyOn(userApi, 'follow').mockResolvedValue({ following: true });
    const unfollow = vi.spyOn(userApi, 'unfollow').mockResolvedValue({ following: false });

    renderExplore();

    expect(await screen.findByRole('heading', { name: 'Discover people' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '@amber_person' })).toHaveAttribute('href', '/profile/person-1');
    expect(screen.getByText('Followed by friend_one')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() => expect(follow).toHaveBeenCalledWith('person-1'));
    expect(await screen.findByRole('button', { name: 'Following' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Following' }));
    await waitFor(() => expect(unfollow).toHaveBeenCalledWith('person-1'));
    expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });

  it('paginates suggestions without duplicating accounts', async () => {
    vi.spyOn(userApi, 'suggestions')
      .mockResolvedValueOnce({ users: [person], nextCursor: 'amber_person' })
      .mockResolvedValueOnce({
        users: [person, { ...person, id: 'person-2', username: 'second_person' }],
        nextCursor: null,
      });

    renderExplore();
    expect(await screen.findByRole('link', { name: '@amber_person' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more people' }));

    expect(await screen.findByRole('link', { name: '@second_person' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '@amber_person' })).toHaveLength(1);
    expect(userApi.suggestions).toHaveBeenLastCalledWith(expect.objectContaining({
      limit: 20,
      after: 'amber_person',
      signal: expect.any(AbortSignal),
    }));
  });

  it('prevents duplicate follow requests and preserves state when the API fails', async () => {
    vi.spyOn(userApi, 'suggestions').mockResolvedValue({ users: [person], nextCursor: null });
    const follow = vi.spyOn(userApi, 'follow').mockRejectedValue(new Error('Could not follow this person.'));

    renderExplore();
    const followButton = await screen.findByRole('button', { name: 'Follow' });
    fireEvent.click(followButton);
    fireEvent.click(followButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not follow this person.');
    expect(follow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });

  it('loads a real profile preview, keeps it open while entering the card, and closes on Escape', async () => {
    vi.spyOn(userApi, 'suggestions').mockResolvedValue({ users: [person], nextCursor: null });
    vi.spyOn(userApi, 'profile').mockResolvedValue({
      user: {
        ...person,
        bio: 'A real profile bio',
        postsCount: 4,
        followersCount: 12,
        followingCount: 8,
      },
    });
    vi.spyOn(contentApi, 'userPosts').mockResolvedValue({
      posts: [{
        id: 'post-1',
        media: { resourceType: 'image', secureUrl: 'https://images.example/post.jpg' },
      }],
    });

    renderExplore();
    const usernameLink = await screen.findByRole('link', { name: '@amber_person' });
    fireEvent.pointerEnter(usernameLink, { pointerType: 'mouse' });

    const preview = await screen.findByRole('dialog', { name: 'Profile preview for @amber_person' });
    expect(await within(preview).findByText('A real profile bio')).toBeInTheDocument();
    expect(within(preview).getByText('12')).toBeInTheDocument();
    expect(within(preview).getByRole('link', { name: 'Open post by @amber_person' })).toHaveAttribute('href', '/post/post-1');

    fireEvent.pointerLeave(usernameLink);
    fireEvent.pointerEnter(preview);
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    expect(screen.getByRole('dialog', { name: 'Profile preview for @amber_person' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
