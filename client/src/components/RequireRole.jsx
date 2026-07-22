import { useAuth } from '../context/AuthContext.jsx';

// Action-level role gating (hides controls a role can't use) — UX only.
// The server's requireRole middleware is the actual security boundary.
// Not a route-level blocker: Viewers still reach role-gated pages read-only.
export default function RequireRole({ allow, children, fallback = null }) {
  const { role } = useAuth();
  if (!allow.includes(role)) return fallback;
  return children;
}
