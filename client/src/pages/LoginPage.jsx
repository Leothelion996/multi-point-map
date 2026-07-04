import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Map as MapIcon } from 'react-feather';
import { hasUsers, login, register } from '../api/auth.js';
import { useAuth } from '../context/AuthContext.jsx';

// Port of login.html: shows create-account mode when no users exist yet
// (registration is otherwise closed server-side), login mode after that.
export default function LoginPage() {
  const { status, setUser } = useAuth();
  const navigate = useNavigate();

  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasUsers()
      .then((data) => { if (!cancelled && !data.hasUsers) setIsRegisterMode(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (status === 'authed') {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const action = isRegisterMode ? register : login;
      const data = await action(username.trim(), password);
      setUser(data.username);
      navigate('/');
    } catch (err) {
      setError(err.status ? err.message : 'Could not connect to server');
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = submitting
    ? (isRegisterMode ? 'Creating...' : 'Signing in...')
    : (isRegisterMode ? 'Create account' : 'Sign in');

  return (
    <div className="bg-gray-50 min-h-screen flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-sm">
        <div className="flex items-center justify-center mb-6">
          <MapIcon className="text-blue-600 h-7 w-7" />
          <span className="ml-2 text-xl font-semibold text-gray-900">CustomMaps Pro</span>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <h2 className="text-lg font-medium text-gray-800 mb-5">
            {isRegisterMode ? 'Create your account' : 'Sign in'}
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md focus:outline-none transition-colors disabled:opacity-50"
            >
              {submitLabel}
            </button>
          </div>
        </form>

        {isRegisterMode && (
          <div className="mt-4 text-center text-sm text-gray-500">
            No account yet. Create one to get started.
          </div>
        )}
      </div>
    </div>
  );
}
