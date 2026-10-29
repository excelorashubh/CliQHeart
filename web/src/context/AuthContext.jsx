import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError, authApi, setAccessToken, setSessionRestoredHandler, setUnauthorizedHandler,
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
  }), [user, loading, authError, authRetryAfterSeconds, signIn, signUp, signOut, refreshSession, updateUser, unreadNotificationCount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
