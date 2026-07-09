import { apiFetch } from './client.js';

// Returns { googleMapsApiKey }. Requires auth (401 when not logged in).
export function getConfig() {
  return apiFetch('/api/config');
}
