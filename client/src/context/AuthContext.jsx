import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as authApi from '../api/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // status: 'loading' | 'authed' | 'anon'; role: 'admin' | 'staff' | 'viewer' | null
  const [auth, setAuth] = useState({ status: 'loading', username: null, role: null });

  useEffect(() => {
    let cancelled = false;
    authApi.me()
      .then(({ username, role }) => {
        if (!cancelled) setAuth({ status: 'authed', username, role: role ?? null });
      })
      .catch(() => { if (!cancelled) setAuth({ status: 'anon', username: null, role: null }); });
    return () => { cancelled = true; };
  }, []);

  const setUser = useCallback((username, role = null) => {
    setAuth({ status: 'authed', username, role });
    // Login/register responses may not carry role; /api/auth/me is the
    // client's source of truth for it, so backfill when it's missing.
    if (!role) {
      authApi.me()
        .then(({ username: name, role: fetchedRole }) => {
          setAuth({ status: 'authed', username: name, role: fetchedRole ?? null });
        })
        .catch(() => {});
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAuth({ status: 'anon', username: null, role: null });
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
