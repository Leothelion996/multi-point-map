import { apiFetch } from './client.js';

// Admin-only user management (server/dwc/routes.js).
const base = '/api/dwc/users';

export function fetchUsers() {
  return apiFetch(base);
}

export function createUser(payload) {
  // payload: {username, password, role}
  return apiFetch(base, { method: 'POST', body: payload });
}

export function updateUserRole(id, role) {
  return apiFetch(`${base}/${id}/role`, { method: 'PUT', body: { role } });
}
