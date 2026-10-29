import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  );
}

function AuthStatus() {
  const { authError, isAuthenticated, isInitializing, user } = useAuth();
  return <p>{isInitializing ? 'Checking session' : authError ? 'Retry needed' : isAuthenticated ? `@${user.username}` : 'Signed out'}</p>;
}

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="current location">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function refreshRejectedResponse() {
  return new Response(JSON.stringify({ error: 'Refresh session is unavailable.' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

describe('route handling', () => {
  it('restores a browser session from the HttpOnly refresh cookie and verifies the profile', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accessToken: 'restored-access-token',
        user: { id: 'user-id', username: 'test_user' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: 'user-id', username: 'test_user', displayName: 'Test User' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValue(new Response(JSON.stringify({ posts: [], stories: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    render(<AuthProvider><AuthStatus /></AuthProvider>);

    expect(await screen.findByText('@test_user')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/refresh');
    expect(fetchMock.mock.calls[0][1].headers.get('x-session-transport')).toBe('cookie');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
    expect(fetchMock.mock.calls[1][0]).toContain('/users/me');
    expect(fetchMock.mock.calls[1][1].headers.get('authorization')).toContain('restored-access-token');
  });

  it('continues cookie restoration if browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage access denied.');
    });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'restored-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: 'user-id', username: 'test_user' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<AuthProvider><AuthStatus /></AuthProvider>);

    expect(await screen.findByText('@test_user')).toBeInTheDocument();
  });

  it('keeps the session recoverable when the backend returns a non-session 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'Browser origin is not allowed.' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ));
    render(<AuthProvider><AuthStatus /></AuthProvider>);

    expect(await screen.findByText('Retry needed')).toBeInTheDocument();
  });

  it('preserves the full protected URL through login', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/auth/refresh')) return refreshRejectedResponse();
      if (String(url).includes('/auth/login')) {
        return new Response(JSON.stringify({
          accessToken: 'access-token',
          user: { id: 'user-id', username: 'test_user' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url).includes('/users/me')) {
        return new Response(JSON.stringify({
          user: { id: 'user-id', username: 'test_user', displayName: 'Test User' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ conversations: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    render(
      <MemoryRouter initialEntries={['/messages/conversation-1?tab=unread#latest']}>
        <AuthProvider><App /><CurrentLocation /></AuthProvider>
      </MemoryRouter>,
    );
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email or username' }), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('/messages/conversation-1?tab=unread#latest')).toBeInTheDocument();
  });

  it('redirects signed-out visitors from protected pages to login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(refreshRejectedResponse());
    renderApp('/messages/private-conversation');
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
  });

  it('shows the signed-out landing page at the root route', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(refreshRejectedResponse());
    renderApp('/');
    expect(await screen.findByRole('heading', { name: /closer feels/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /get started/i })).toHaveAttribute('href', '/signup');
  });

  it.each(['/explore', '/discover'])('redirects the legacy %s route to Search after sign-in', async (path) => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(refreshRejectedResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accessToken: 'access-token',
        user: { id: 'user-id', username: 'test_user' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: 'user-id', username: 'test_user', displayName: 'Test User' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    renderApp(path);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email or username' }), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument();
  });

  it('requires agreement before registration can be submitted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(refreshRejectedResponse());
    renderApp('/signup');
    expect(await screen.findByRole('heading', { name: 'Find your people.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /terms of service/i }));
    expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled();
  });

  it('shows backend login errors without changing to an authenticated page', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({ error: 'Invalid email/username or password.' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )));
    renderApp('/login');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email or username' }), {
      target: { value: 'someone@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'incorrect' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email/username or password.');
    expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeInTheDocument();
  });

  it('only authenticates after login and the authenticated profile both succeed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(refreshRejectedResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 'user-id', username: 'test_user' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: 'user-id', username: 'test_user', displayName: 'Test User' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    renderApp('/login');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email or username' }), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: /good to see you, test/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Search' })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Discover' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/refresh');
    expect(fetchMock.mock.calls[1][0]).toContain('/auth/login');
    expect(fetchMock.mock.calls[2][0]).toContain('/users/me');
    expect(fetchMock.mock.calls[2][1].headers.get('authorization')).toContain('access-token');
    expect(fetchMock.mock.calls.slice(3).map(([url]) => url)).toEqual(expect.arrayContaining([
      expect.stringContaining('/posts?'),
      expect.stringContaining('/stories'),
    ]));
  });

  it('submits registration, establishes the returned session, and navigates to home', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(refreshRejectedResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: 'Registration successful.',
        accessToken: 'access-token',
        user: { id: 'new-user-id', username: 'new_user' },
      }), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        user: { id: 'new-user-id', username: 'new_user', displayName: 'New User' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValue(new Response(JSON.stringify({ posts: [], stories: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    renderApp('/signup');
    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'New User' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'new_user' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText('Confirm password', { selector: 'input' }), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /terms of service/i }));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('heading', { name: /good to see you, new/i })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[1][0]).toContain('/auth/register');
    expect(fetchMock.mock.calls[2][0]).toContain('/users/me');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      displayName: 'New User',
      username: 'new_user',
      email: 'new@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      agreeToTerms: true,
    });
  });

  it('blocks reserved usernames before sending a registration request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(refreshRejectedResponse());
    renderApp('/signup');
    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Admin' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText('Confirm password', { selector: 'input' }), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /terms of service/i }));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('This username is reserved.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/refresh');
  });

  it('loads profiles by username, switches between real post and Reel grids, and opens post details', async () => {
    const profile = {
      id: 'profile-id',
      username: 'test_user',
      displayName: 'Test User',
      followersCount: 4,
      followingCount: 2,
      postsCount: 1,
      reelsCount: 0,
    };
    const post = {
      id: 'post-id',
      caption: 'A real shared moment',
      owner: { id: profile.id, username: profile.username, displayName: profile.displayName },
      media: { resourceType: 'image', secureUrl: 'https://media.example/post.jpg' },
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const path = String(url);
      if (path.includes('/auth/refresh')) {
        return new Response(JSON.stringify({ accessToken: 'access-token', user: profile }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (path.includes('/users/me') || path.includes('/users/test_user')) {
        return new Response(JSON.stringify({ user: profile }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (path.includes('/users/profile-id/posts')) {
        return new Response(JSON.stringify({ posts: [post] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (path.includes('/users/profile-id/reels')) {
        return new Response(JSON.stringify({ reels: [] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (path.includes('/posts/post-id')) {
        return new Response(JSON.stringify({ post }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    renderApp('/profile/test_user');
    expect(await screen.findByRole('heading', { name: 'test_user' })).toBeInTheDocument();
    const mainNavigation = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(mainNavigation.querySelector('a[href="/profile"]')).toHaveClass('is-active');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/users/test_user'))).toBe(true);
    const postLink = await screen.findByRole('link', { name: /view post by test_user: a real shared moment/i });
    expect(postLink).toHaveAttribute('href', '/post/post-id');
    fireEvent.click(screen.getByRole('tab', { name: /reels/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/users/profile-id/reels'))).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: /posts/i }));
    fireEvent.click(await screen.findByRole('link', { name: /view post by test_user: a real shared moment/i }));
    expect(await screen.findByText('A real shared moment')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/posts/post-id'))).toBe(true);
  });
});
