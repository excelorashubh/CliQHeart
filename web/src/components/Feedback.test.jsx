import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorState } from './Feedback.jsx';

describe('ErrorState', () => {
  it('disables retry actions until the server Retry-After cooldown expires', async () => {
    const retry = vi.fn();
    render(<ErrorState
      error="Too many requests. Try again in 1 seconds."
      onRetry={retry}
    />);

    const blockedButton = screen.getByRole('button', { name: 'Try again in 1s' });
    expect(blockedButton).toBeDisabled();
    fireEvent.click(blockedButton);
    expect(retry).not.toHaveBeenCalled();

    const retryButton = await screen.findByRole('button', { name: 'Try again' }, { timeout: 2500 });
    expect(retryButton).toBeEnabled();
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledOnce();
  });
});
