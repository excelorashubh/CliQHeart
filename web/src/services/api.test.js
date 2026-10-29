import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError, apiRequest, authApi, professionalApi, resolveApiUrl, setAccessToken, setSessionRestoredHandler, setUnauthorizedHandler,
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

  it('uses the configured API host in development and production', () => {
    expect(resolveApiUrl('https://api.example.test/api/v1', 'auth/login'))
      .toBe('https://api.example.test/api/v1/auth/login');
    expect(resolveApiUrl('https://api.example.test/api/v1', 'auth/login'))
      .toBe('https://api.example.test/api/v1/auth/login');
  });

  it('sends login to the deployed backend with cookie credentials and the existing JSON body', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://cliqheart.onrender.com/api/v1');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        accessToken: 'access-token',
        user: { id: 'user-id', username: 'test_user' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await authApi.login({ identifier: 'test@example.com', password: 'Password123!' });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://cliqheart.onrender.com/api/v1/auth/login',
    );
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
    expect(fetchMock.mock.calls[0][1].headers.get('x-session-transport')).toBe('cookie');
    expect(fetchMock.mock.calls[0][1].body).toBe(
      '{"identifier":"test@example.com","password":"Password123!"}',
    );
  });

  it('sends the selected account type to the authenticated onboarding API and explains a missing deployed route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    ));

    await expect(professionalApi.saveOnboardingStep({ step: 'type', accountType: 'BUSINESS' }))
      .rejects.toMatchObject({
        status: 404,
        message: 'The professional account service was not found. The backend may need its professional-account update deployed.',
      });

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test.invalid/api/v1/professional/onboarding');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchMock.mock.calls[0][1].body).toBe('{"step":"type","accountType":"BUSINESS"}');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
  });

  it.each([
    [400, 'Some professional account details are invalid. Review the form and try again.'],
    [401, 'Your session could not be verified. Sign in again and retry.'],
    [403, 'Your account is not permitted to change this professional setting.'],
    [409, 'This account has changed. Refresh the page and try again.'],
    [503, 'The professional account service is temporarily unavailable. Try again shortly.'],
  ])('shows a recoverable professional-specific message for HTTP %s', async (status, message) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'Internal infrastructure details.' }),
      { status, headers: { 'content-type': 'application/json' } },
    ));

    await expect(professionalApi.saveOnboardingStep(
      { step: 'type', accountType: 'CREATOR' },
    )).rejects.toMatchObject({ status, message });
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

  it('respects Retry-After on HTTP 429 without automatically retrying', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'Too many sign-in attempts.' }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '12',
        },
      },
    ));

    await expect(authApi.login({ identifier: 'person', password: 'secret' }))
      .rejects.toMatchObject({
        name: 'ApiError',
        status: 429,
        retryAfterSeconds: 12,
        message: 'Too many sign-in attempts. Try again in 12 seconds.',
      });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, 'You cannot access this profile.'],
    [503, 'Database is temporarily unavailable.'],
  ])('preserves the server message for HTTP %s rather than mapping it to a rate-limit error', async (status, message) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: message }),
      { status, headers: { 'content-type': 'application/json' } },
    ));

    await expect(apiRequest('users/me', { retryAuth: false }))
      .rejects.toMatchObject({ status, message, retryAfterSeconds: null });
  });

  it('does not clear a saved session when refresh is forbidden for an origin/configuration issue', async () => {
    const unauthorized = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Authentication required.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Browser origin is not allowed.' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'user-id' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    setAccessToken('possibly-valid-token');
    setUnauthorizedHandler(unauthorized);

    await expect(apiRequest('users/me')).rejects.toMatchObject({ status: 403 });
    await expect(apiRequest('users/me', { retryAuth: false })).resolves.toEqual({ user: { id: 'user-id' } });

    expect(unauthorized).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[2][1].headers.get('authorization')).toBeTruthy();
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

  it('keeps the in-memory session when refresh temporarily fails', async () => {
    const unauthorized = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Access token is invalid or expired.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Temporarily unavailable.' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }));
    setAccessToken('possibly-valid-session-token');
    setUnauthorizedHandler(unauthorized);

    await expect(apiRequest('users/me')).rejects.toMatchObject({ status: 503 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorized).not.toHaveBeenCalled();
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
