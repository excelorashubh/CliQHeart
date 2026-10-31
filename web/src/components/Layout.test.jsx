import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from './Layout.jsx';
import { notificationApi } from '../services/api.js';

const { signOut, setUnreadNotificationCount, navState } = vi.hoisted(() => ({
  signOut: vi.fn(),
  setUnreadNotificationCount: vi.fn(),
  navState: { unreadCount: 7, unreadMessageCount: 3, accountType: undefined },
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
    unreadMessageCount: navState.unreadMessageCount,
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
  navState.unreadMessageCount = 3;
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

  it('uses the Remix send icon for Messages and Chats while preserving unread badges and routes', () => {
    vi.spyOn(notificationApi, 'unreadCount').mockResolvedValue({ unreadCount: 0 });
    renderLayout();

    const messages = within(screen.getByRole('navigation', { name: 'Main navigation' }))
      .getByRole('link', { name: 'Messages' });
    const chats = within(screen.getByRole('navigation', { name: 'Mobile navigation' }))
      .getByRole('link', { name: 'Chats' });
    const expectedPath = 'M19.4999 2.00098C20.0944 2.00063 20.6989 2.15072 21.2499 2.46875C22.924 3.43525 23.4977 5.57598 22.5312 7.25001L15.0311 20.2403C14.0646 21.9142 11.9238 22.488 10.2498 21.5215C9.41372 21.0387 8.85157 20.2605 8.61994 19.3975L7.1209 13.8028L15.8905 8.73927C16.3687 8.46311 16.5327 7.85126 16.2567 7.37306C15.9805 6.89505 15.3686 6.73096 14.8905 7.00685L6.12089 12.0713L2.02515 7.97462C0.658428 6.60771 0.658787 4.39204 2.02515 3.02539C2.65731 2.39319 3.53383 2.00021 4.49978 2L19.4999 2.00098Z';

    for (const link of [messages, chats]) {
      expect(link).toHaveAttribute('href', '/messages');
      expect(link.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
      expect(link.querySelector('svg path')).toHaveAttribute('d', expectedPath);
      expect(within(link).getByText('3')).toBeInTheDocument();
    }
  });

  it('uses the heart home and rounded-square play icons for Home and Reels navigation', () => {
    vi.spyOn(notificationApi, 'unreadCount').mockResolvedValue({ unreadCount: 0 });
    renderLayout();

    const mainNavigation = screen.getByRole('navigation', { name: 'Main navigation' });
    const mobileNavigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    const desktopHome = within(mainNavigation).getByRole('link', { name: 'Home' });
    const mobileHome = within(mobileNavigation).getByRole('link', { name: 'Home' });
    const desktopReels = within(mainNavigation).getByRole('link', { name: 'Reels' });
    const mobileReels = within(mobileNavigation).getByRole('link', { name: 'Reels' });

    for (const link of [desktopHome, mobileHome]) {
      expect(link).toHaveAttribute('href', '/');
      expect(link.querySelectorAll('svg path')).toHaveLength(2);
      expect(link.querySelector('svg path').getAttribute('d')).toContain('12.223');
    }

    for (const link of [desktopReels, mobileReels]) {
      expect(link).toHaveAttribute('href', '/reels');
      expect(link.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
      expect(link.querySelector('svg rect')).toHaveAttribute('x', '2');
      expect(link.querySelector('svg rect')).toHaveAttribute('y', '3');
      expect(link.querySelector('svg rect')).toHaveAttribute('width', '20');
      expect(link.querySelector('svg rect')).toHaveAttribute('height', '18');
      expect(link.querySelector('svg rect')).toHaveAttribute('rx', '4');
      expect(link.querySelector('svg rect')).toHaveAttribute('fill', '#E65D73');
      expect(link.querySelector('svg path')).toHaveAttribute('fill', '#FFFFFF');
    }
  });

  it('keeps Home and Reels selected states tied to their existing routes', () => {
    vi.spyOn(notificationApi, 'unreadCount').mockResolvedValue({ unreadCount: 0 });
    const firstRender = renderLayout('/');
    let mobileNavigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(mobileNavigation).getByRole('link', { name: 'Home' })).toHaveClass('is-active');
    expect(within(mobileNavigation).getByRole('link', { name: 'Reels' })).not.toHaveClass('is-active');

    firstRender.unmount();
    renderLayout('/reels');
    mobileNavigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(mobileNavigation).getByRole('link', { name: 'Home' })).not.toHaveClass('is-active');
    expect(within(mobileNavigation).getByRole('link', { name: 'Reels' })).toHaveClass('is-active');
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
