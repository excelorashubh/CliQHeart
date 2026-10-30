import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HashtagPage } from './HashtagPage.jsx';
import { contentApi } from '../services/api.js';

function renderPage() {
  return render(<MemoryRouter initialEntries={['/explore/tags/travel']}>
    <Routes><Route path="/explore/tags/:tag" element={<HashtagPage />} /></Routes>
  </MemoryRouter>);
}

describe('HashtagPage', () => {
  it('renders actual tagged Posts and Reels in a thumbnail grid with original links', async () => {
    vi.spyOn(contentApi, 'hashtag').mockResolvedValue({
      hashtag: { name: 'travel', usageCount: 2 },
      items: [{
        id: 'post-1',
        contentType: 'post',
        media: { resourceType: 'image', thumbnailUrl: 'https://media.example/post.jpg' },
      }, {
        id: 'reel-1',
        contentType: 'reel',
        media: { resourceType: 'video', thumbnailUrl: 'https://media.example/reel.jpg' },
      }],
      nextCursor: null,
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: '#travel' })).toBeInTheDocument();
    expect(screen.getByText('2 posts and Reels')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open post tagged #travel' })).toHaveAttribute('href', '/post/post-1');
    expect(screen.getByRole('link', { name: 'Open Reel tagged #travel' })).toHaveAttribute('href', '/reels/reel-1');
    expect(screen.getByRole('link', { name: 'Open Reel tagged #travel' }).querySelector('img')).toHaveAttribute('src', 'https://media.example/reel.jpg');
    expect(screen.queryByText('media.example')).not.toBeInTheDocument();
  });

  it('loads the next cursor page and appends unique content', async () => {
    const fetchTag = vi.spyOn(contentApi, 'hashtag')
      .mockResolvedValueOnce({
        hashtag: { name: 'travel', usageCount: 2 },
        items: [{ id: 'post-1', contentType: 'post', media: { resourceType: 'image', thumbnailUrl: 'https://media.example/1.jpg' } }],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'reel-2', contentType: 'reel', media: { resourceType: 'video', thumbnailUrl: 'https://media.example/2.jpg' } }],
        nextCursor: null,
      });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(fetchTag).toHaveBeenLastCalledWith('travel', {
      after: 'cursor-1',
      signal: expect.any(AbortSignal),
    }));
    expect(await screen.findByRole('link', { name: 'Open Reel tagged #travel' })).toHaveAttribute('href', '/reels/reel-2');
  });
});
