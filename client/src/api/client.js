// Single fetch wrapper for all JSON API calls.
// Auth is a httpOnly session cookie; credentials:'include' keeps it flowing
// even if the client is ever served from a different origin than the API.
export async function apiFetch(path, { method = 'GET', body, ...opts } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || res.statusText || 'Request failed');
    error.status = res.status;
    error.details = data.details;
    throw error;
  }
  return data;
}
