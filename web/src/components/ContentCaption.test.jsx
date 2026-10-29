import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ContentCaption } from './Content.jsx';

afterEach(() => vi.restoreAllMocks());

function mockCaptionHeights() {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function getScrollHeight() {
    return this.textContent.length > 100 ? 100 : 40;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function getClientHeight() {
    if (this.classList.contains('is-collapsed')) return 60;
    return this.textContent.length > 100 ? 100 : 40;
  });
}

describe('ContentCaption', () => {
  it('only offers expansion when the caption exceeds the preview', () => {
    mockCaptionHeights();
    render(<>
      <ContentCaption username="short" caption="A short caption." postId="short-post" />
      <ContentCaption username="long" caption={'A long caption. '.repeat(15)} postId="long-post" />
    </>);

    expect(screen.queryByRole('button', { name: 'Read more for post by @short' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read more for post by @long' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands and collapses captions independently', () => {
    mockCaptionHeights();
    const caption = 'A long caption. '.repeat(15);
    render(<>
      <ContentCaption username="first" caption={caption} postId="first-post" />
      <ContentCaption username="second" caption={caption} postId="second-post" />
    </>);

    fireEvent.click(screen.getByRole('button', { name: 'Read more for post by @first' }));
    const firstPost = document.querySelector('[data-post-id="first-post"]');
    const secondPost = document.querySelector('[data-post-id="second-post"]');

    expect(within(firstPost).getByRole('button', { name: 'Show less for post by @first' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(secondPost).getByRole('button', { name: 'Read more for post by @second' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(within(firstPost).getByRole('button', { name: 'Show less for post by @first' }));
    expect(within(firstPost).getByRole('button', { name: 'Read more for post by @first' })).toHaveAttribute('aria-expanded', 'false');
  });
});
