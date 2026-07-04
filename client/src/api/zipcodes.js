import { apiFetch } from './client.js';

// Returns { zipCode, center: {lat,lng}, title, geometry } — geometry is a GeoJSON string.
export function lookupZip(zipCode) {
  return apiFetch('/api/zipcodes/lookup', { method: 'POST', body: { zipCode } });
}
