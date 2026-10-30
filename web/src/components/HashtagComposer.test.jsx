import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HashtagComposer } from './HashtagComposer.jsx';
import { HashtagText } from './HashtagText.jsx';
import { contentApi } from '../services/api.js';

function ComposerHarness({ initialCaption = '' }) {
  const [caption, setCaption] = useState(initialCaption);
  return <HashtagComposer caption={caption} onChange={setCaption} />;
}

describe('hashtag composition and captions', () => {
  beforeEach(() => {
    vi.spyOn(contentApi, 'searchHashtags').mockResolvedValue({ hashtags: [] });
    vi.spyOn(contentApi, 'trendingHashtags').mockResolvedValue({ hashtags: [] });
  });

  it('searches and inserts a real suggestion, and removes selected hashtags', async () => {
    contentApi.searchHashtags.mockResolvedValue({
      hashtags: [{ name: 'Travel', normalizedName: 'travel', usageCount: 12 }],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><ComposerHarness initialCaption="Trip " /></MemoryRouter>);
    await user.type(screen.getByLabelText('Caption'), '#tra');
    expect(await screen.findByRole('option', { name: /#Travel.*12 posts/i })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /#Travel/ }));
    expect(screen.getByLabelText('Caption')).toHaveValue('Trip #travel ');
    fireEvent.click(screen.getByRole('button', { name: 'Remove hashtag travel' }));
    expect(screen.getByLabelText('Caption')).toHaveValue('Trip  ');
  });

  it('offers creation of an unknown valid hashtag', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ComposerHarness /></MemoryRouter>);
    await user.type(screen.getByLabelText('Caption'), '#CliQHeart');

    await user.click(await screen.findByRole('option', { name: /Create #CliQHeart/i }));
    expect(screen.getByLabelText('Caption')).toHaveValue('#cliqheart ');
  });

  it('renders caption hashtags as links without changing surrounding text', () => {
    const { container } = render(<MemoryRouter><p><HashtagText>{'A line\n#Travel and #Gaming!'}</HashtagText></p></MemoryRouter>);
    expect(screen.getByRole('link', { name: '#Travel' })).toHaveAttribute('href', '/explore/tags/travel');
    expect(screen.getByRole('link', { name: '#Gaming' })).toHaveAttribute('href', '/explore/tags/gaming');
    expect(container.textContent).toBe('A line\n#Travel and #Gaming!');
  });
});
