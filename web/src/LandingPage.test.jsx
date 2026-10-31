import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from './pages.jsx';

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderLandingPage() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe('landing page Android download action', () => {
  it('keeps the download unavailable until a release URL is configured', () => {
    vi.stubEnv('VITE_ANDROID_APP_DOWNLOAD_URL', '');
    renderLandingPage();

    expect(screen.getByRole('button', { name: 'Download Android App' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Android download will be available when a signed production app is published.',
    );
    expect(screen.getByRole('link', { name: /Get started/ })).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('link', { name: /I already have an account/ })).toHaveAttribute('href', '/login');
  });

  it('links to the configured HTTPS production release', () => {
    vi.stubEnv(
      'VITE_ANDROID_APP_DOWNLOAD_URL',
      'https://downloads.example.test/cliqheart.apk',
    );
    renderLandingPage();

    expect(screen.getByRole('link', { name: 'Download CliQHeart Android app' })).toHaveAttribute(
      'href',
      'https://downloads.example.test/cliqheart.apk',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    'http://downloads.example.test/cliqheart.apk',
    'javascript:alert(1)',
    'https://user:password@downloads.example.test/cliqheart.apk',
  ])('does not enable an unsafe or malformed release URL: %s', (url) => {
    vi.stubEnv('VITE_ANDROID_APP_DOWNLOAD_URL', url);
    renderLandingPage();

    expect(screen.getByRole('button', { name: 'Download Android App' })).toBeDisabled();
  });
});
