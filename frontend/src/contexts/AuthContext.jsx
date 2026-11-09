import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, login, logout } from '../services/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [phase, setPhase] = useState('loading');
  const [user, setUser] = useState(null);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(20);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const session = await getCurrentUser();
      setUser(session.user);
      setIdleTimeoutMinutes(session.idleTimeoutMinutes);
      setPhase('authenticated');
    } catch (requestError) {
      if (requestError.status === 401) {
        setUser(null);
        setPhase('anonymous');
        return;
      }
      setError(requestError);
      setPhase('unavailable');
    }
  }, []);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((session) => {
        if (!active) return;
        setUser(session.user);
        setIdleTimeoutMinutes(session.idleTimeoutMinutes);
        setPhase('authenticated');
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError.status === 401) {
          setUser(null);
          setPhase('anonymous');
          return;
        }
        setError(requestError);
        setPhase('unavailable');
      });

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (credentials) => {
    const session = await login(credentials);
    setUser(session.user);
    setIdleTimeoutMinutes(session.idleTimeoutMinutes);
    setError(null);
    setPhase('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
    setPhase('anonymous');
  }, []);

  const value = useMemo(() => ({
    phase,
    user,
    error,
    idleTimeoutMinutes,
    refresh,
    signIn,
    signOut,
  }), [phase, user, error, idleTimeoutMinutes, refresh, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
