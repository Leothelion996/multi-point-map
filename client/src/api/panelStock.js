import { apiFetch } from './client.js';

// Returns [{ id, title, fileName, specialties, rows, duplicateZips, createdAt, updatedAt }]
export function fetchPanelStockUploads() {
  return apiFetch('/api/panel-stock/uploads');
}

export function fetchPanelStockUpload(id) {
  return apiFetch(`/api/panel-stock/uploads/${id}`);
}

export function createPanelStockUpload({ title, fileName, specialties, rows, duplicateZips }) {
  return apiFetch('/api/panel-stock/uploads', {
    method: 'POST',
    body: { title, fileName, specialties, rows, duplicateZips }
  });
}

export function deletePanelStockUpload(id) {
  return apiFetch(`/api/panel-stock/uploads/${id}`, { method: 'DELETE' });
}
