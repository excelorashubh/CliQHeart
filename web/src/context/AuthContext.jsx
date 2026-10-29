import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  ApiError, authApi, getAccessToken, messageApi, renewAccessToken, setAccessToken,
  setSessionRestoredHandler, setUnauthorizedHandler,
} from '../services/api.js';

const AuthContext = createContext(null);
const pendingLogoutKey = 'cliqheart.pendingLogout';

function logAuthDiagnostic(event, status) {
  if (!import.meta.env.DEV) return;
  console.debug('[CliQHeart auth]', event, ...(status ? [`HTTP ${status}`] : []));
}

function hasPendingLogout() {
  try {
    return localStorage.getItem(pendingLogoutKey) === 'true';
  } catch {
    logAuthDiagnostic('browser storage unavailable; continuing cookie restoration');
    return false;
  }
}

function clearPendingLogout() {
  try {
    localStorage.removeItem(pendingLogoutKey);
  } catch {
    logAuthDiagnostic('could not clear the pending logout marker');
  }
}

function isCompleteUser(user) {
  return typeof user?.id === 'string' && typeof user.username === 'string';
}

function isConfirmedInvalidSession(error) {
  return error?.status === 401 ||
    (error?.status === 403 && error.message === 'Account is not available.');
}

function getSessionErrorMessage(error) {
  if (error?.status === 429) {
    return 'Session verification was rate limited. Your saved sign-in has not been discarded.';
  }
  if (error?.status === 0) {
    return 'Could not reach CliQHeart. Your saved sign-in has not been discarded; check your connection and try again.';
  }
  if (error?.status >= 500) {
    return 'CliQHeart is temporarily unavailable. Your saved sign-in has not been discarded; try again shortly.';
  }
  return error?.message || 'Could not verify the saved session. Check your connection and retry.';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [realtimeSocket, setRealtimeSocket] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('disconnected');
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authRetryAfterSeconds, setAuthRetryAfterSeconds] = useState(0);
  const restoreInFlight = useRef(null);
  const authRetryAt = useRef(0);
  const cooldownActive = authRetryAfterSeconds > 0;

  useEffect(() => {
    if (!cooldownActive) return undefined;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((authRetryAt.current - Date.now()) / 1000));
      setAuthRetryAfterSeconds(remaining);
      if (remaining === 0) authRetryAt.current = 0;
    }, 250);
    return () => window.clearInterval(timer);
  }, [cooldownActive]);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setUnreadNotificationCount(0);
    setUnreadMessageCount(0);
    setAuthRetryAfterSeconds(0);
    authRetryAt.current = 0;
  }, []);

  const refreshSession = useCallback(() => {
    if (restoreInFlight.current) return restoreInFlight.current;
    const retryAfterSeconds = Math.max(0, Math.ceil((authRetryAt.current - Date.now()) / 1000));
    if (retryAfterSeconds > 0) {
      return Promise.reject(new ApiError(
        'Session verification is rate limited.',
        429,
        undefined,
        undefined,
        retryAfterSeconds,
      ));
    }
    const operation = (async () => {
      setLoading(true);
      setAuthError('');
      setAuthRetryAfterSeconds(0);
      try {
        if (hasPendingLogout()) {
          logAuthDiagnostic('retrying pending logout');
          await authApi.logout();
          clearPendingLogout();
          clearSession();
          return null;
        }

        logAuthDiagnostic('restoring browser session');
        const result = await authApi.refresh();
        if (typeof result?.accessToken !== 'string' || !result.accessToken.trim() || !isCompleteUser(result.user)) {
          throw new Error('The API returned an incomplete refreshed session.');
        }
        setAccessToken(result.accessToken);
        setUser(result.user);
        logAuthDiagnostic('browser session restored');
        return result.user;
      } catch (error) {
        logAuthDiagnostic(
          isConfirmedInvalidSession(error)
            ? 'no valid browser session'
            : 'session restoration unavailable',
          error?.status,
        );
        if (isConfirmedInvalidSession(error)) {
          clearSession();
          setAuthError('');
        } else {
          const retryAfter = error?.status === 429 ? error.retryAfterSeconds : null;
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            authRetryAt.current = Date.now() + retryAfter * 1000;
            setAuthRetryAfterSeconds(retryAfter);
          }
          setAuthError(getSessionErrorMessage(error));
        }
        throw error;
      } finally {
        setLoading(false);
        restoreInFlight.current = null;
      }
    })();
    restoreInFlight.current = operation;
    return operation;
  }, [clearSession]);

  useEffect(() => {
    if (!user?.id || import.meta.env.MODE === 'test') {
      setRealtimeSocket(null);
      setRealtimeStatus('disconnected');
      return undefined;
    }
    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(apiBaseUrl)) {
      setRealtimeStatus('disconnected');
      return undefined;
    }
    const socket = io(new URL(apiBaseUrl).origin, {
      autoConnect: false,
      withCredentials: true,
      auth: (callback) => callback({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    let renewingSocketAuth = false;
    let lastSocketRefreshAt = 0;
    let socketRefreshTimer = null;
    const refreshSocketAuth = () => {
      if (socketRefreshTimer) window.clearTimeout(socketRefreshTimer);
      socketRefreshTimer = null;
      if (renewingSocketAuth || Date.now() - lastSocketRefreshAt < 10000) return;
      renewingSocketAuth = true;
      lastSocketRefreshAt = Date.now();
      renewAccessToken()
        .then(() => socket.connect())
        .catch((error) => {
          if (isConfirmedInvalidSession(error)) {
            setAccessToken(null);
            clearSession();
            setAuthError('');
          } else {
            console.error('Could not renew the real-time connection.', error);
            socketRefreshTimer = window.setTimeout(refreshSocketAuth, 10000);
          }
        })
        .finally(() => { renewingSocketAuth = false; });
    };
    const updateUnreadCount = (payload) => {
      if (Number.isFinite(payload?.count)) setUnreadMessageCount(Math.max(0, payload.count));
    };
    const refreshUnreadCount = () => {
      messageApi.unreadCount().then((result) => {
        if (Number.isFinite(result?.unreadCount)) setUnreadMessageCount(Math.max(0, result.unreadCount));
      }).catch((error) => {
        if (error?.status !== 401) console.error('Could not refresh message unread count.', error);
      });
    };
    const onConnect = () => {
      setRealtimeStatus('connected');
      refreshUnreadCount();
    };
    const onDisconnect = (reason) => {
      setRealtimeStatus('reconnecting');
      if (reason === 'io server disconnect') refreshSocketAuth();
    };
    const onConnectError = (error) => {
      setRealtimeStatus('reconnecting');
      if (/authentication required|invalid token|expired/i.test(error?.message || '')) refreshSocketAuth();
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('unread:update', updateUnreadCount);
    setRealtimeSocket(socket);
    setRealtimeStatus('connecting');
    socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('unread:update', updateUnreadCount);
      if (socketRefreshTimer) window.clearTimeout(socketRefreshTimer);
      socket.disconnect();
      setRealtimeSocket(null);
      setRealtimeStatus('disconnected');
    };
  }, [user?.id]);

  const establishSession = useCallback((result) => {
    if (typeof result?.accessToken !== 'string' || !result.accessToken.trim() || !isCompleteUser(result.user)) {
      throw new Error('The API returned an incomplete authentication response.');
    }
    setAccessToken(result.accessToken);
    setUser(result.user);
    setAuthError('');
    setAuthRetryAfterSeconds(0);
    authRetryAt.current = 0;
    clearPendingLogout();
    return result.user;
  }, []);

  const signIn = useCallback(async (identifier, password) => {
    const result = await authApi.login({ identifier, password });
    return establishSession(result);
  }, [establishSession]);

  const signUp = useCallback(async (details) => {
    const result = await authApi.register(details);
    return establishSession(result);
  }, [establishSession]);

  const updateUser = useCallback((nextUser) => {
    setUser((current) => ({ ...current, ...nextUser }));
  }, []);

  const signOut = useCallback(async () => {
    let remoteRevoked = false;
    let remoteError = '';
    try {
      localStorage.setItem(pendingLogoutKey, 'true');
    } catch {
      remoteError = 'This browser could not save the pending logout marker.';
    }
    try {
      await authApi.logout();
      remoteRevoked = true;
      clearPendingLogout();
    } catch (error) {
      remoteError = error.message || 'The server could not confirm session revocation.';
    } finally {
      clearSession();
      setAuthError('');
    }
    return { remoteRevoked, error: remoteError };
  }, [clearSession]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      setAuthError('');
    });
    setSessionRestoredHandler((refreshedUser) => {
      if (isCompleteUser(refreshedUser)) setUser(refreshedUser);
    });
    refreshSession().catch(() => {});
    return () => {
      setUnauthorizedHandler(() => {});
      setSessionRestoredHandler(() => {});
    };
  }, [clearSession, refreshSession]);

  const value = useMemo(() => ({
    user,
    isAuthenticated: Boolean(user),
    loading,
    isInitializing: loading,
    isLoading: loading,
    authError,
    authRetryAfterSeconds,
    signIn,
    login: signIn,
    signUp,
    signup: signUp,
    signOut,
    logout: signOut,
    refreshSession,
    updateUser,
    setUser,
    unreadNotificationCount,
    setUnreadNotificationCount,
    unreadMessageCount,
    setUnreadMessageCount,
    realtimeSocket,
    realtimeStatus,
  }), [user, loading, authError, authRetryAfterSeconds, signIn, signUp, signOut, refreshSession, updateUser, unreadNotificationCount, unreadMessageCount, realtimeSocket, realtimeStatus]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
