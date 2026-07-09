import { apiFetch } from './client.js';

// groupType is 'locations' or 'zipcodes' — the server keys all group routes
// under /api/:groupType/groups with the type as a discriminator.
const base = (groupType) => `/api/${groupType}/groups`;

export function fetchGroups(groupType) {
  return apiFetch(base(groupType));
}

export function fetchGroup(groupType, groupId) {
  return apiFetch(`${base(groupType)}/${groupId}`);
}

export function createGroup(groupType, name, locations = []) {
  return apiFetch(base(groupType), { method: 'POST', body: { name, locations } });
}

export function updateGroup(groupType, groupId, payload) {
  return apiFetch(`${base(groupType)}/${groupId}`, { method: 'PUT', body: payload });
}

export function deleteGroup(groupType, groupId) {
  return apiFetch(`${base(groupType)}/${groupId}`, { method: 'DELETE' });
}

export function addLocation(groupType, groupId, location) {
  return apiFetch(`${base(groupType)}/${groupId}/locations`, { method: 'POST', body: location });
}

export function updateLocation(groupType, groupId, locationId, payload) {
  return apiFetch(`${base(groupType)}/${groupId}/locations/${locationId}`, { method: 'PUT', body: payload });
}

export function reorderLocations(groupType, groupId, locationIds) {
  return apiFetch(`${base(groupType)}/${groupId}/locations/reorder`, { method: 'PUT', body: { locationIds } });
}

export function deleteLocation(groupType, groupId, locationId) {
  return apiFetch(`${base(groupType)}/${groupId}/locations/${locationId}`, { method: 'DELETE' });
}
