import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError, apiRequest, resolveApiUrl, setAccessToken, setSessionRestoredHandler, setUnauthorizedHandler,
} from './api.js';

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.test.invalid/api/v1');
  });

  afterEach(() => {
    setAccessToken(null);
    setSessionRestoredHandler(() => {});
    setUnauthorizedHandler(() => {});
    vi.unstubAllEnvs();
  });

  it('sends the bearer token and JSON payload to the configured endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ following: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    setAccessToken('memory-only-token');

    await expect(apiRequest('users/123/follow', { method: 'POST', body: { enabled: true } }))
      .resolves.toEqual({ following: true });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/users/123/follow');
    expect(options.headers.get('authorization')).toBe('Bearer memory-only-token');
    expect(options.headers.get('content-type')).toBe('application/json');
    expect(options.body).toBe('{"enabled":true}');
  });

  it('uses the Vite same-origin proxy in development and the configured API in production', () => {
    expect(resolveApiUrl('https://api.example.test/api/v1', 'auth/login', true))
      .toBe('/api/v1/auth/login');
    expect(resolveApiUrl('https://api.example.test/api/v1', 'auth/login', false))
      .toBe('https://api.example.test/api/v1/auth/login');
  });

  it('normalizes API errors and clears an expired access token', async () => {
    const unauthorized = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'Authentication required.' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ));
    setAccessToken('expired');
    setUnauthorizedHandler(unauthorized);

    await expect(apiRequest('users/me', { retryAuth: false })).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Authentication required.',
      status: 401,
    });

    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between concurrent requests and retries each request once', async () => {
    let protectedRequests = 0;
    const restored = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).includes('/auth/refresh')) {
        return new Response(JSON.stringify({
          accessToken: 'new-access-token',
          user: { id: 'user-id', username: 'test_user' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      protectedRequests += 1;
      if (options.headers.get('authorization')?.includes('expired-token')) {
        return new Response(JSON.stringify({ error: 'Expired.' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ user: { id: 'user-id' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    setAccessToken('expired-token');
    setSessionRestoredHandler(restored);

    const results = await Promise.all([apiRequest('users/me'), apiRequest('users/me')]);

    expect(results).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'))).toHaveLength(1);
    expect(protectedRequests).toBe(4);
    expect(restored).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('provides a clear message when the network is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network failure'));
    await expect(apiRequest('users/me')).rejects.toEqual(
      expect.objectContaining({
        message: 'Could not communicate with the CliQHeart API. Check that the service is online and its browser CORS settings allow this website.',
        status: 0,
      }),
    );
  });

  it('accepts a successful 204 response without requiring JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiRequest('auth/logout', { method: 'POST', retryAuth: false })).resolves.toBeNull();
  });
});
