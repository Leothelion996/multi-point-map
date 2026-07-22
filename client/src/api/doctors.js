import { apiFetch } from './client.js';

// DWC doctor roster + per-doctor DWC locations (server/dwc/routes.js).
const base = '/api/dwc/doctors';

export function fetchDoctors({ includeInactive = false } = {}) {
  return apiFetch(`${base}${includeInactive ? '?includeInactive=true' : ''}`);
}

export function fetchDoctor(id) {
  return apiFetch(`${base}/${id}`);
}

export function createDoctor(payload) {
  return apiFetch(base, { method: 'POST', body: payload });
}

export function updateDoctor(id, payload) {
  return apiFetch(`${base}/${id}`, { method: 'PUT', body: payload });
}

export function setDoctorActive(id, isActive) {
  return apiFetch(`${base}/${id}/active`, { method: 'PATCH', body: { isActive } });
}

export function deleteDoctor(id) {
  return apiFetch(`${base}/${id}`, { method: 'DELETE' });
}

export function fetchDoctorLocations(doctorId, { includeInactive = false } = {}) {
  return apiFetch(`${base}/${doctorId}/locations${includeInactive ? '?includeInactive=true' : ''}`);
}

export function patchLocationGeocode(locationId, payload) {
  // payload: {lat, lng, formattedAddress} on success, {status:'failed', error} on failure
  return apiFetch(`/api/dwc/locations/${locationId}/geocode`, { method: 'PATCH', body: payload });
}

export function patchLocationClassification(locationId, classification) {
  return apiFetch(`/api/dwc/locations/${locationId}/classification`, {
    method: 'PATCH',
    body: { classification }
  });
}

export function clearLocationClassificationOverride(locationId) {
  return apiFetch(`/api/dwc/locations/${locationId}/classification-override`, { method: 'DELETE' });
}
