import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatePage } from './pages.jsx';
import { contentApi, mediaApi } from './services/api.js';

vi.mock('./components/MediaUploader.jsx', () => ({
  MediaUploader: ({ purpose, onReady }) => <button
    type="button"
    onClick={() => onReady({ id: `media-${purpose}`, resourceType: purpose === 'reel' ? 'video' : 'image' })}
  >Use verified upload</button>,
}));

describe('CreatePage', () => {
  beforeEach(() => {
    vi.spyOn(mediaApi, 'remove').mockResolvedValue(null);
    vi.spyOn(contentApi, 'createPost').mockResolvedValue({ post: { id: 'post-id' } });
    vi.spyOn(contentApi, 'createStory').mockResolvedValue({ story: { id: 'story-id' } });
    vi.spyOn(contentApi, 'createReel').mockResolvedValue({ reel: { id: 'reel-id' } });
  });

  it('publishes the selected media and caption as a post', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Use verified upload' }));
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'A real moment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(contentApi.createPost).toHaveBeenCalledWith({
      mediaId: 'media-post',
      caption: 'A real moment',
    }));
  });

  it('uses the story endpoint and story caption limit selection', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Story' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use verified upload' }));
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'A short story' } });
    fireEvent.click(screen.getByRole('button', { name: 'Share story' }));

    await waitFor(() => expect(contentApi.createStory).toHaveBeenCalledWith({
      mediaId: 'media-story',
      caption: 'A short story',
    }));
  });

  it('publishes the video selection through the Reel endpoint', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Reel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use verified upload' }));
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'A short video' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(contentApi.createReel).toHaveBeenCalledWith({
      mediaId: 'media-reel',
      caption: 'A short video',
    }));
  });
});
