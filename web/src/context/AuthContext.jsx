import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  authApi, setAccessToken, setSessionRestoredHandler, setUnauthorizedHandler, userApi,
} from '../services/api.js';

const AuthContext = createContext(null);
const pendingLogoutKey = 'cliqheart.pendingLogout';

function isCompleteUser(user) {
  return typeof user?.id === 'string' && typeof user.username === 'string';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const restoreInFlight = useRef(null);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  const refreshSession = useCallback(() => {
    if (restoreInFlight.current) return restoreInFlight.current;
    const operation = (async () => {
      setLoading(true);
      setAuthError('');
      try {
        if (localStorage.getItem(pendingLogoutKey)) {
          await authApi.logout();
          localStorage.removeItem(pendingLogoutKey);
          clearSession();
          return null;
        }

        const result = await authApi.refresh();
        if (typeof result?.accessToken !== 'string' || !result.accessToken.trim()) {
          throw new Error('The API returned an incomplete refreshed session.');
        }
        setAccessToken(result.accessToken);
        const profile = await userApi.me();
        if (!isCompleteUser(profile?.user)) {
          throw new Error('The API returned an incomplete authenticated profile.');
        }
        setUser(profile.user);
        return profile.user;
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) {
          clearSession();
          setAuthError('');
        } else {
          setAuthError(error.message || 'Could not verify the saved session. Check your connection and retry.');
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

  const establishSession = useCallback(async (result) => {
    if (typeof result?.accessToken !== 'string' || !result.accessToken.trim() || !isCompleteUser(result.user)) {
      throw new Error('The API returned an incomplete authentication response.');
    }
    setAccessToken(result.accessToken);
    try {
      const profile = await userApi.me();
      if (!isCompleteUser(profile?.user)) {
        throw new Error('The API returned an incomplete authenticated profile.');
      }
      setUser(profile.user);
      setAuthError('');
      return profile.user;
    } catch (error) {
      setAccessToken(null);
      throw error;
    }
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
      localStorage.removeItem(pendingLogoutKey);
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
    signIn,
    login: signIn,
    signUp,
    signup: signUp,
    signOut,
    logout: signOut,
    refreshSession,
    updateUser,
    setUser,
  }), [user, loading, authError, signIn, signUp, signOut, refreshSession, updateUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
