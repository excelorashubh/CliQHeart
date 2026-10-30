import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SearchPage } from './pages.jsx';
import { contentApi, userApi } from './services/api.js';

vi.mock('./context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'viewer-1', username: 'viewer' } }),
}));

function renderSearchPage() {
  return render(<MemoryRouter><SearchPage /></MemoryRouter>);
}

describe('SearchPage', () => {
  it('loads real posts in Explore instead of showing sample content', async () => {
    const search = vi.spyOn(userApi, 'search');
    const posts = vi.spyOn(contentApi, 'posts').mockResolvedValue({ posts: [] });
    const reels = vi.spyOn(contentApi, 'reels').mockResolvedValue({ reels: [] });
    renderSearchPage();

    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Explore' })).toBeInTheDocument();
    expect(await screen.findByText('No media to explore yet')).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
    expect(posts).toHaveBeenCalledOnce();
    expect(reels).toHaveBeenCalledOnce();
  });

  it('renders actual posts and Reels as a thumbnail-only Explore grid', async () => {
    vi.spyOn(contentApi, 'posts').mockResolvedValue({
      posts: [{
        id: 'post-123',
        caption: 'Private caption text',
        owner: { username: 'private_creator' },
        media: { resourceType: 'image', thumbnailUrl: 'https://cdn.example/post.jpg' },
      }, {
        id: 'video-789',
        caption: 'Video post caption',
        owner: { username: 'video_creator' },
        media: { resourceType: 'video', thumbnailUrl: 'https://cdn.example/video.jpg' },
      }],
      nextCursor: null,
    });
    vi.spyOn(contentApi, 'reels').mockResolvedValue({
      reels: [{
        id: 'reel-456',
        caption: 'Reel caption text',
        owner: { username: 'reel_creator' },
        media: { resourceType: 'video', thumbnailUrl: 'https://cdn.example/reel.jpg' },
      }],
      nextCursor: null,
    });
    renderSearchPage();

    const grid = await screen.findByRole('link', { name: 'Open post' }).then((link) => link.parentElement.parentElement);
    expect(grid).toHaveClass('content-feed--explore-grid');
    expect(grid).toHaveClass('content-feed--grid');
    expect(screen.getByRole('link', { name: 'Open post' })).toHaveAttribute('href', '/post/post-123');
    expect(screen.getByRole('link', { name: 'Open Reel' })).toHaveAttribute('href', '/reels/reel-456');
    expect(screen.getByRole('link', { name: 'Open video post' }).querySelector('.content-grid-video')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Reel' }).querySelector('.content-grid-video')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Reel' }).querySelector('img')).toHaveAttribute('src', 'https://cdn.example/reel.jpg');
    expect(screen.queryByText('Private caption text')).not.toBeInTheDocument();
    expect(screen.queryByText('Reel caption text')).not.toBeInTheDocument();
    expect(screen.queryByText('private_creator')).not.toBeInTheDocument();
    expect(screen.queryByText('reel_creator')).not.toBeInTheDocument();
    expect(screen.queryByText('Video post caption')).not.toBeInTheDocument();
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

  it('shows backend hashtag matches alongside people search', async () => {
    vi.spyOn(userApi, 'search').mockResolvedValue({ users: [], nextCursor: null });
    vi.spyOn(contentApi, 'searchHashtags').mockResolvedValue({
      hashtags: [{ name: 'travel', normalizedName: 'travel', usageCount: 9 }],
    });
    renderSearchPage();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search users by name or username' }), {
      target: { value: '#tra' },
    });

    expect(await screen.findByRole('link', { name: /#travel.*9 posts/i })).toHaveAttribute(
      'href',
      '/explore/tags/travel',
    );
    expect(userApi.search).toHaveBeenCalledWith('tra', expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
