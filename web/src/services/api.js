let accessToken = null;
let unauthorizedHandler = () => {};
let sessionRestoredHandler = () => {};
let refreshInFlight = null;

export function setAccessToken(token) {
  accessToken = token || null;
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export function setSessionRestoredHandler(handler) {
  sessionRestoredHandler = handler;
}

export class ApiError extends Error {
  constructor(message, status, details, field, retryAfterSeconds = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.field = field;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt)
    ? null
    : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}

function isConfirmedInvalidSession(error) {
  return error?.status === 401 ||
    (error?.status === 403 && error.message === 'Account is not available.');
}

function professionalErrorMessage(status, errorMessage) {
  const message = typeof errorMessage === 'string' ? errorMessage : '';
  if (status === 400) return 'Some professional account details are invalid. Review the form and try again.';
  if (status === 401) return 'Your session could not be verified. Sign in again and retry.';
  if (status === 403) return 'Your account is not permitted to change this professional setting.';
  if (status === 404) {
    if (/user not found/i.test(message)) {
      return 'Your CliQHeart account could not be found. Sign in again and retry.';
    }
    if (message && !/^not found$/i.test(message.trim())) return message;
    return 'The professional account service was not found. The backend may need its professional-account update deployed.';
  }
  if (status === 409) {
    if (/already professional|complete.*onboarding|promotion draft not found/i.test(message)) return message;
    return 'This account has changed. Refresh the page and try again.';
  }
  if (status === 429) return message || 'Too many requests. Wait before trying again.';
  if (status >= 500) return 'The professional account service is temporarily unavailable. Try again shortly.';
  return message || `Professional account request failed (${status}).`;
}

export function resolveApiUrl(apiBaseUrl, path) {
  const normalizedPath = path.replace(/^\/+/, '');
  return `${apiBaseUrl}/${normalizedPath}`;
}

export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, signal, headers: extraHeaders, retryAuth = true } = options;
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!apiBaseUrl) throw new ApiError('Set VITE_API_BASE_URL in web/.env before connecting.', 0);
  if (!/^https?:\/\//i.test(apiBaseUrl)) {
    throw new ApiError('VITE_API_BASE_URL must be an HTTP(S) URL.', 0);
  }

  const headers = new Headers({ Accept: 'application/json' });
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  let response;
  try {
    response = await fetch(resolveApiUrl(apiBaseUrl, path), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'include',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timedOut) throw new ApiError('The request timed out. Please try again.', 0);
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(
      'Could not communicate with the CliQHeart API. Check that the service is online and its browser CORS settings allow this website.',
      0,
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;
  const isAuthEndpoint = path.replace(/^\/+/, '').startsWith('auth/');
  if (response.status === 401 && retryAuth && !isAuthEndpoint && accessToken) {
    try {
      const session = await refreshAccessToken();
      if (typeof session.accessToken !== 'string' || !session.accessToken) {
        throw new ApiError('The API returned an incomplete refreshed session.', 502);
      }
      setAccessToken(session.accessToken);
      sessionRestoredHandler(session.user);
      return apiRequest(path, { ...options, retryAuth: false });
    } catch (reason) {
      if (isConfirmedInvalidSession(reason)) {
        setAccessToken(null);
        unauthorizedHandler();
      }
      throw reason;
    }
  }
  if (!response.ok) {
    if (response.status === 401 && accessToken && !isAuthEndpoint) {
      setAccessToken(null);
      unauthorizedHandler();
    }
    const retryAfterSeconds = response.status === 429
      ? parseRetryAfter(response.headers.get('retry-after'))
      : null;
    const isProfessionalEndpoint = path.replace(/^\/+/, '').startsWith('professional/');
    let message = isProfessionalEndpoint
      ? professionalErrorMessage(response.status, data?.error)
      : typeof data?.error === 'string'
        ? data.error
        : response.status === 429
        ? 'Too many requests.'
        : response.status >= 500
          ? 'CliQHeart is temporarily unavailable. Please try again shortly.'
          : `Request failed (${response.status}).`;
    if (response.status === 429 && retryAfterSeconds !== null) {
      message += ` Try again in ${retryAfterSeconds} seconds.`;
    }
    throw new ApiError(message, response.status, data?.details, data?.field, retryAfterSeconds);
  }
  if (response.status === 204) return null;
  if (!contentType.includes('application/json')) {
    throw new ApiError('The API returned an unexpected response.', 502);
  }
  return data;
}

function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = authApi.refresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

const cookieTransportHeaders = { 'X-Session-Transport': 'cookie' };

export const authApi = {
  login: (credentials) => apiRequest('auth/login', { method: 'POST', body: credentials, headers: cookieTransportHeaders }),
  register: (details) => apiRequest('auth/register', { method: 'POST', body: details, headers: cookieTransportHeaders }),
  usernameAvailability: (username, { signal } = {}) => apiRequest(
    `auth/username-availability?${new URLSearchParams({ username })}`,
    { signal, retryAuth: false },
  ),
  refresh: () => apiRequest('auth/refresh', { method: 'POST', headers: cookieTransportHeaders, retryAuth: false }),
  logout: () => apiRequest('auth/logout', { method: 'POST', headers: cookieTransportHeaders, retryAuth: false }),
};

export const userApi = {
  me: (options) => apiRequest('users/me', options),
  updateMe: (body) => apiRequest('users/me', { method: 'PATCH', body }),
  deleteAccount: (body) => apiRequest('users/me', { method: 'DELETE', body }),
  deleteProfilePhoto: () => apiRequest('users/me', {
    method: 'PATCH',
    body: { avatarMediaId: null },
  }),
  profile: (id, options) => apiRequest(`users/${encodeURIComponent(id)}`, options),
  profileByUsername: (username, options) => apiRequest(
    `users/by-username/${encodeURIComponent(username)}`,
    options,
  ),
  search: (query, { after, signal } = {}) => {
    const params = new URLSearchParams({ q: query });
    if (after) params.set('after', after);
    return apiRequest(`users/search?${params}`, { signal });
  },
  suggestions: ({ limit = 5, after, signal } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set('after', after);
    return apiRequest(
      `users/suggestions?${params}`,
      { signal },
    );
  },
  follow: (id) => apiRequest(`users/${encodeURIComponent(id)}/follow`, { method: 'POST' }),
  unfollow: (id) => apiRequest(`users/${encodeURIComponent(id)}/follow`, { method: 'DELETE' }),
  relation: (id, relation, after) => {
    const params = new URLSearchParams();
    if (after) params.set('after', after);
    return apiRequest(`users/${encodeURIComponent(id)}/${relation}?${params}`);
  },
  savedPosts: ({ after, signal } = {}) => {
    const params = new URLSearchParams();
    if (after) params.set('after', after);
    return apiRequest(`users/me/saved?${params}`, { signal });
  },
  taggedPosts: (id, { after, signal } = {}) => {
    const params = new URLSearchParams();
    if (after) params.set('after', after);
    return apiRequest(`users/${encodeURIComponent(id)}/tagged?${params}`, { signal });
  },
};

export const professionalApi = {
  me: (options) => apiRequest('professional/me', options),
  saveOnboardingStep: (body) => apiRequest('professional/onboarding', { method: 'PATCH', body }),
  convert: (body) => apiRequest('professional/convert', { method: 'POST', body }),
  updateProfile: (body) => apiRequest('professional/profile', { method: 'PATCH', body }),
  switchToPersonal: () => apiRequest('professional/switch-to-personal', { method: 'POST', body: {} }),
  dashboard: (days = 30, options = {}) => apiRequest(`professional/dashboard?${new URLSearchParams({ days: String(days) })}`, options),
  campaigns: (options) => apiRequest('professional/campaigns', options),
  createCampaign: (body) => apiRequest('professional/campaigns', { method: 'POST', body }),
  updateCampaign: (id, body) => apiRequest(`professional/campaigns/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteCampaign: (id) => apiRequest(`professional/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const mediaApi = {
  signature: (purpose, resourceType) => apiRequest('media/signature', {
    method: 'POST',
    body: { purpose, resourceType },
  }),
  confirm: (id) => apiRequest(`media/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
  }),
  remove: (id) => apiRequest(`media/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
};

export const contentApi = {
  posts: (limit = 30, { after, ...options } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set('after', after);
    return apiRequest(`posts?${params}`, options);
  },
  userPosts: (id, limit = 30, options = {}) => apiRequest(
    `users/${encodeURIComponent(id)}/posts?${new URLSearchParams({ limit: String(limit) })}`,
    options,
  ),
  userReels: (id, limit = 30, options = {}) => apiRequest(
    `users/${encodeURIComponent(id)}/reels?${new URLSearchParams({ limit: String(limit) })}`,
    options,
  ),
  post: (id, options) => apiRequest(`posts/${encodeURIComponent(id)}`, options),
  reel: (id, options) => apiRequest(`reels/${encodeURIComponent(id)}`, options),
  createPost: (body) => apiRequest('posts', { method: 'POST', body }),
  deletePost: (id) => apiRequest(`posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  stories: (options = {}) => apiRequest('stories', options),
  createStory: (body) => apiRequest('stories', { method: 'POST', body }),
  deleteStory: (id) => apiRequest(`stories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reels: (limit = 30, { after, ...options } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set('after', after);
    return apiRequest(`reels?${params}`, options);
  },
  createReel: (body) => apiRequest('reels', { method: 'POST', body }),
  deleteReel: (id) => apiRequest(`reels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  savePost: (id) => apiRequest(`posts/${encodeURIComponent(id)}/save`, { method: 'POST' }),
  unsavePost: (id) => apiRequest(`posts/${encodeURIComponent(id)}/save`, { method: 'DELETE' }),
  tagUser: (postId, userId) => apiRequest(`posts/${encodeURIComponent(postId)}/tags`, {
    method: 'POST',
    body: { userId },
  }),
  removeMyTag: (postId) => apiRequest(`posts/${encodeURIComponent(postId)}/tags/me`, { method: 'DELETE' }),
};

export const notificationApi = {
  list: ({ after, signal } = {}) => {
    const params = new URLSearchParams();
    if (after) params.set('after', after);
    return apiRequest(`notifications?${params}`, { signal });
  },
  unreadCount: (options = {}) => apiRequest('notifications/unread-count', options),
  markRead: (id) => apiRequest(`notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
  markAllRead: () => apiRequest('notifications/read-all', { method: 'PATCH' }),
};

export const messageApi = {
  conversations: () => apiRequest('conversations'),
  createConversation: (participantId) => apiRequest('conversations', { method: 'POST', body: { participantId } }),
  messages: (id, options = {}) => {
    const params = new URLSearchParams();
    if (options.before) params.set('before', options.before);
    if (options.limit) params.set('limit', String(options.limit));
    return apiRequest(`conversations/${encodeURIComponent(id)}/messages?${params}`, { signal: options.signal });
  },
  send: (id, text) => apiRequest(`conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text } }),
};
