import { apiFetch } from './client.js';

export function login(username, password) {
  return apiFetch('/api/auth/login', { method: 'POST', body: { username, password } });
}

export function register(username, password) {
  return apiFetch('/api/auth/register', { method: 'POST', body: { username, password } });
}

export function logout() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export function me() {
  return apiFetch('/api/auth/me');
}

export function hasUsers() {
  return apiFetch('/api/auth/has-users');
}
