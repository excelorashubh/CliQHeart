import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatePage } from './pages.jsx';
import { contentApi, mediaApi } from './services/api.js';

vi.mock('./components/MediaUploader.jsx', () => ({
  MediaUploader: ({ purpose, onReady }) => <button
    type="button"
    onClick={() => onReady({
      id: `media-${purpose}`,
      resourceType: purpose === 'reel' ? 'video' : 'image',
      secureUrl: 'https://media.example/upload.jpg',
    })}
  >Use verified upload</button>,
}));

vi.mock('./context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'user-id', username: 'test_user', displayName: 'Test User' } }),
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
    fireEvent.change(screen.getByPlaceholderText('Add a location'), { target: { value: 'Lisbon' } });
    fireEvent.change(screen.getByPlaceholderText('Describe this media for people using screen readers'), {
      target: { value: 'Friends at the coast' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(contentApi.createPost).toHaveBeenCalledWith({
      mediaId: 'media-post',
      caption: 'A real moment',
      location: 'Lisbon',
      altText: 'Friends at the coast',
    }));
    expect(await screen.findByRole('link', { name: 'View published post' })).toHaveAttribute('href', '/post/post-id');
  });

  it('uses the signed-in profile identity in the preview', () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getAllByText('@test_user')).toHaveLength(2);
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

  it('opens the story composer when linked from the home story row', () => {
    render(<MemoryRouter initialEntries={['/create?kind=story']}><CreatePage /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: 'Story' })).toHaveAttribute('aria-selected', 'true');
  });

  it('asks before discarding unsaved composer changes', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Reel' }));

    expect(window.confirm).toHaveBeenCalledWith('Discard this upload and your unsaved changes?');
    expect(screen.getByRole('tab', { name: 'Post' })).toHaveAttribute('aria-selected', 'true');
  });

  it('publishes the video selection through the Reel endpoint', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Reel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use verified upload' }));
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'A short video' } });
    fireEvent.change(screen.getByPlaceholderText('Add a location'), { target: { value: 'Studio' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /AI-generated or altered content/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(contentApi.createReel).toHaveBeenCalledWith({
      mediaId: 'media-reel',
      caption: 'A short video',
      location: 'Studio',
      aiDisclosure: true,
    }));
  });

  it('prevents a rapid duplicate publish submission', async () => {
    let resolvePublish;
    contentApi.createPost.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePublish = resolve;
    }));
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Use verified upload' }));
    const form = screen.getByRole('button', { name: 'Publish' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(contentApi.createPost).toHaveBeenCalledTimes(1);
    resolvePublish({ post: { id: 'post-id' } });
    expect(await screen.findByRole('link', { name: 'View published post' })).toBeInTheDocument();
  });

  it('shows safe field-level API validation details when publishing fails', async () => {
    contentApi.createPost.mockRejectedValueOnce(Object.assign(
      new Error('Invalid content request.'),
      { details: [{ field: 'mediaId', message: 'Invalid input' }] },
    ));
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Use verified upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid content request. mediaId: Invalid input',
    );
  });
});
