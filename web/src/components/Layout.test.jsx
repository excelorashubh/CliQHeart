import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from './Layout.jsx';
import { notificationApi } from '../services/api.js';

const { signOut, setUnreadNotificationCount, navState } = vi.hoisted(() => ({
  signOut: vi.fn(),
  setUnreadNotificationCount: vi.fn(),
  navState: { unreadCount: 7, accountType: undefined },
}));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: {
      id: 'viewer-id',
      username: 'viewer',
      displayName: 'Viewer User',
      avatarUrl: 'https://images.example/viewer.jpg',
      accountType: navState.accountType,
    },
    signOut,
    unreadNotificationCount: navState.unreadCount,
    setUnreadNotificationCount,
  }),
}));

function renderLayout(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppLayout><p>Page content</p></AppLayout>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  setUnreadNotificationCount.mockReset();
  navState.unreadCount = 7;
  navState.accountType = undefined;
});

describe('mobile navigation', () => {
  it('renders exactly Home, Search, Reels, Chats, and Profile in bottom navigation order', () => {
    vi.spyOn(notificationApi, 'unreadCount').mockResolvedValue({ unreadCount: 7 });
    renderLayout();

    const mobileNav = screen.getByRole('navigation', { name: 'Mobile navigation' });
    const links = within(mobileNav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Home',
      'Search',
      'Reels',
      'Chats',
      'Profile',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/search',
      '/reels',
      '/messages',
      '/profile',
    ]);
    expect(within(mobileNav).getByRole('link', { name: 'Profile' }).querySelector('img'))
      .toHaveAttribute('src', 'https://images.example/viewer.jpg');
    expect(within(mobileNav).queryByRole('link', { name: 'Create post' })).not.toBeInTheDocument();
    expect(within(mobileNav).queryByRole('link', { name: /^Notifications/ })).not.toBeInTheDocument();
  });

  it('puts Create and real unread Notifications in the mobile header and highlights active routes', async () => {
    const unreadCount = vi.spyOn(notificationApi, 'unreadCount').mockResolvedValue({ unreadCount: 7 });
    renderLayout('/messages/conversation-1');

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'CliQHeart home' })).toHaveAttribute('href', '/');
    expect(within(header).getByRole('link', { name: 'Create post' })).toHaveAttribute('href', '/create');
    const notifications = within(header).getByRole('link', { name: 'Notifications, 7 unread' });
    expect(notifications).toHaveAttribute('href', '/notifications');
    expect(await within(notifications).findByText('7')).toBeInTheDocument();
    expect(unreadCount).toHaveBeenCalledOnce();
    expect(within(screen.getByRole('navigation', { name: 'Mobile navigation' }))
      .getByRole('link', { name: 'Chats' })).toHaveClass('is-active');
  });

  it('does not fabricate a notification badge when the unread count is zero', () => {
    navState.unreadCount = 0;
    vi.spyOn(notificationApi, 'unreadCount').mockResolvedValue({ unreadCount: 0 });
    renderLayout('/notifications');

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Notifications' })).toHaveClass('is-active');
    expect(within(header).queryByText('7')).not.toBeInTheDocument();
  });

  it.each(['CREATOR', 'BUSINESS'])('shows saved %s accounts the real Dashboard link', (accountType) => {
    navState.accountType = accountType;
    vi.spyOn(notificationApi, 'unreadCount').mockResolvedValue({ unreadCount: 0 });
    renderLayout('/professional/dashboard');

    const mainNavigation = screen.getByRole('navigation', { name: 'Main navigation' });
    const dashboard = within(mainNavigation).getByRole('link', { name: 'Dashboard' });
    expect(dashboard).toHaveAttribute('href', '/professional/dashboard');
    expect(dashboard).toHaveClass('is-active');
  });

  it.each(['PERSONAL', undefined])('keeps Dashboard hidden for account type %s', (accountType) => {
    navState.accountType = accountType;
    vi.spyOn(notificationApi, 'unreadCount').mockResolvedValue({ unreadCount: 0 });
    renderLayout();

    expect(within(screen.getByRole('navigation', { name: 'Main navigation' }))
      .queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });
});
