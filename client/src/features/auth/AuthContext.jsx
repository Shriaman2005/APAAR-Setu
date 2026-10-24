import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setCsrfToken } from '../../services/apiClient';

// Holds the signed-in user for the UI. This is NOT a security boundary: the server checks
// identity, role and scope on every request.
const AuthContext = createContext(null);

export const ROLE_HOME = {
  COLLEGE_OPERATOR: '/college',
  COLLEGE_HEAD: '/college',
  AICTE_NATIONAL_OFFICER: '/aicte',
  AICTE_REGIONAL_OFFICER: '/aicte',
  AICTE_SYSTEM_ADMIN: '/admin',
  DEGREE_AWARDING_BODY: '/issuer',
  VERIFIER: '/verifier',
  STUDENT: '/student',
};

export const ROLE_LABELS = {
  COLLEGE_OPERATOR: 'College Operator (Maker)',
  COLLEGE_HEAD: 'College Head (Checker)',
  AICTE_NATIONAL_OFFICER: 'AICTE National Officer',
  AICTE_REGIONAL_OFFICER: 'AICTE Regional Officer',
  AICTE_SYSTEM_ADMIN: 'AICTE System Administrator',
  DEGREE_AWARDING_BODY: 'Degree-Awarding Body',
  VERIFIER: 'Verifier',
  STUDENT: 'Student',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready
  const [sessionMessage, setSessionMessage] = useState(null);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api('/auth/me');
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setStatus('ready');
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Any API call that comes back 401 (expired session, disabled account) signs the UI out.
  useEffect(() => {
    function handleUnauthorized(event) {
      setUser(null);
      setCsrfToken(null);
      setSessionMessage(event.detail?.code === 'SESSION_REVOKED'
        ? 'Your session is no longer valid. Please sign in again.'
        : 'Your session has ended. Please sign in again.');
    }
    window.addEventListener('apaar:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('apaar:unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    setCsrfToken(data.csrfToken);
    setUser(data.user);
    setSessionMessage(null);
    return data.user;
  }, []);

  // Only clears local state after the server confirms the session was destroyed.
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setCsrfToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, status, login, logout, refreshUser, sessionMessage, setCsrfToken }),
    [user, status, login, logout, refreshUser, sessionMessage]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
