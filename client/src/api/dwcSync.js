import { apiFetch } from './client.js';

// DWC sync-run trigger + polling endpoints (server/dwc/routes.js).
const base = '/api/dwc/sync-runs';

export function triggerSync() {
  return apiFetch(base, { method: 'POST' });
}

export function fetchSyncRun(id) {
  return apiFetch(`${base}/${id}`);
}

export function fetchSyncRuns({ limit } = {}) {
  return apiFetch(`${base}${limit ? `?limit=${limit}` : ''}`);
}

export function fetchSyncRunResults(id) {
  return apiFetch(`${base}/${id}/results`);
}

export function checkDoctor(doctorId) {
  return apiFetch(`/api/dwc/doctors/${doctorId}/check`, { method: 'POST' });
}

export function retryFailed(runId) {
  return apiFetch(`${base}/${runId}/retry-failed`, { method: 'POST' });
}
