import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  completeOfficerMfaEnrollment as completeOfficerEnrollment,
  getCurrentUser,
  login,
  logout,
} from '../services/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [phase, setPhase] = useState('loading');
  const [user, setUser] = useState(null);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(20);
  const [error, setError] = useState(null);
  const [pendingMfaEnrollment, setPendingMfaEnrollment] = useState(null);

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
    const result = await login(credentials);
    if (result.mfaEnrollmentRequired) {
      setPendingMfaEnrollment({
        token: result.enrollmentToken,
        user: result.user,
        expiresInMinutes: result.enrollmentExpiresInMinutes,
        totpSecret: result.totpSecret,
        otpauthUri: result.otpauthUri,
      });
      return { mfaEnrollmentRequired: true };
    }
    if (result.mfaRequired) {
      return { mfaRequired: true };
    }
    const session = result;
    setUser(session.user);
    setIdleTimeoutMinutes(session.idleTimeoutMinutes);
    setPendingMfaEnrollment(null);
    setError(null);
    setPhase('authenticated');
  }, []);

  const completeMfaEnrollment = useCallback(async ({ totpCode }) => {
    if (!pendingMfaEnrollment) {
      throw new Error('The authenticator enrollment has expired. Sign in again to restart.');
    }
    const session = await completeOfficerEnrollment({
      enrollmentToken: pendingMfaEnrollment.token,
      totpCode,
    });
    setUser(session.user);
    setIdleTimeoutMinutes(session.idleTimeoutMinutes);
    setPendingMfaEnrollment(null);
    setError(null);
    setPhase('authenticated');
    return session;
  }, [pendingMfaEnrollment]);

  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
    setPendingMfaEnrollment(null);
    setPhase('anonymous');
  }, []);

  const value = useMemo(() => ({
    phase,
    user,
    error,
    idleTimeoutMinutes,
    pendingMfaEnrollment,
    refresh,
    retry: refresh,
    signIn,
    completeMfaEnrollment,
    signOut,
  }), [
    phase,
    user,
    error,
    idleTimeoutMinutes,
    pendingMfaEnrollment,
    refresh,
    signIn,
    completeMfaEnrollment,
    signOut,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
