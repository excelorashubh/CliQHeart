import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SearchPage } from './pages.jsx';
import { contentApi, userApi } from './services/api.js';

function renderSearchPage() {
  return render(<MemoryRouter><SearchPage /></MemoryRouter>);
}

describe('SearchPage', () => {
  it('loads real posts in Explore instead of showing sample content', async () => {
    const search = vi.spyOn(userApi, 'search');
    const posts = vi.spyOn(contentApi, 'posts').mockResolvedValue({ posts: [] });
    renderSearchPage();

    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Explore' })).toBeInTheDocument();
    expect(await screen.findByText('No posts to show yet')).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
    expect(posts).toHaveBeenCalledOnce();
  });

  it('debounces user search and reflects follow status from the API', async () => {
    const search = vi.spyOn(userApi, 'search').mockResolvedValue({
      users: [{
        id: 'person-1',
        displayName: 'Taylor Person',
        username: 'taylor_person',
        avatarUrl: null,
        bio: 'Hello there',
        isFollowing: true,
      }],
      nextCursor: null,
    });
    const unfollow = vi.spyOn(userApi, 'unfollow').mockResolvedValue({ following: false });
    renderSearchPage();
    const input = screen.getByRole('searchbox', { name: 'Search users by name or username' });

    fireEvent.change(input, { target: { value: 'ta' } });
    fireEvent.change(input, { target: { value: 'tay' } });

    expect(await screen.findByText('Taylor Person')).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('tay', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole('link', { name: /Taylor Person @taylor_person/ })).toHaveAttribute('href', '/profile/person-1');
    fireEvent.click(screen.getByRole('button', { name: 'Following' }));
    await waitFor(() => expect(unfollow).toHaveBeenCalledWith('person-1'));
    expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });

  it('shows an empty result for a successful search with no matching users', async () => {
    vi.spyOn(userApi, 'search').mockResolvedValue({ users: [], nextCursor: null });
    renderSearchPage();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search users by name or username' }), {
      target: { value: 'nobody' },
    });

    expect(await screen.findByText('No people found')).toBeInTheDocument();
  });

  it('shows an error and retries a failed user search', async () => {
    const search = vi.spyOn(userApi, 'search')
      .mockRejectedValueOnce(new Error('Search is unavailable.'))
      .mockResolvedValueOnce({ users: [], nextCursor: null });
    renderSearchPage();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search users by name or username' }), {
      target: { value: 'person' },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Search is unavailable.');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No people found')).toBeInTheDocument();
  });

  it('does not render a previous query result while the next query is loading', async () => {
    const search = vi.spyOn(userApi, 'search')
      .mockResolvedValueOnce({
        users: [{ id: 'old', displayName: 'Old Result', username: 'old_result', isFollowing: false }],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        users: [{ id: 'new', displayName: 'New Result', username: 'new_result', isFollowing: false }],
        nextCursor: null,
      });
    renderSearchPage();
    const input = screen.getByRole('searchbox', { name: 'Search users by name or username' });

    fireEvent.change(input, { target: { value: 'old' } });
    expect(await screen.findByText('Old Result')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'new' } });

    expect(screen.queryByText('Old Result')).not.toBeInTheDocument();
    expect(await screen.findByText('New Result')).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });
});
