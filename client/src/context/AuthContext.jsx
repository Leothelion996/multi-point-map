import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as authApi from '../api/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // status: 'loading' | 'authed' | 'anon'
  const [auth, setAuth] = useState({ status: 'loading', username: null });

  useEffect(() => {
    let cancelled = false;
    authApi.me()
      .then(({ username }) => { if (!cancelled) setAuth({ status: 'authed', username }); })
      .catch(() => { if (!cancelled) setAuth({ status: 'anon', username: null }); });
    return () => { cancelled = true; };
  }, []);

  const setUser = useCallback((username) => {
    setAuth({ status: 'authed', username });
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAuth({ status: 'anon', username: null });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...auth, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
