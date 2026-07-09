import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Gates protected content: nothing renders (so the map never initializes)
// until /api/auth/me has confirmed the session.
export default function RequireAuth({ children }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="loading-spinner" />
      </div>
    );
  }

  if (status === 'anon') {
    return <Navigate to="/login" replace />;
  }

  return children;
}
