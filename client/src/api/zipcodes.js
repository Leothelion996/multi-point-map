import { apiFetch } from './client.js';

// Returns { zipCode, center: {lat,lng}, title, geometry } — geometry is a GeoJSON string.
export function lookupZip(zipCode) {
  return apiFetch('/api/zipcodes/lookup', { method: 'POST', body: { zipCode } });
}

// Batch variant: up to 250 ZIPs per call. Returns
// { results: { [zipCode]: <same shape as lookupZip> }, notFound: [zipCode] }.
export function lookupZipsBatch(zipCodes) {
  return apiFetch('/api/zipcodes/lookup-batch', { method: 'POST', body: { zipCodes } });
}

// Returns { colors: { [zipCode]: hexColor }, defaultColor } — precomputed
// graph-coloring assignment for CA ZIPs (90001-96162) so adjacent ZIP
// polygons never share a color on the Panel Stock Analysis map.
export function fetchZipColors() {
  return apiFetch('/api/zipcodes/colors');
}
