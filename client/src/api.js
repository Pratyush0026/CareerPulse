// Thin fetch wrapper for the CareerPulse API. Vite proxies /api to the Express server.

const SERVER_DOWN =
  'Lost connection to the CareerPulse server. Anything already processed is saved – please try again. ' +
  'If it keeps happening, check that “npm run dev” is still running.';

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw Object.assign(new Error(SERVER_DOWN), { code: 'SERVER_DOWN' });
  }

  // The API always answers with JSON, so a plain-text error came from the Vite proxy.
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  if (!res.ok && !isJson) {
    throw Object.assign(new Error(SERVER_DOWN), { code: 'SERVER_DOWN', status: res.status });
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'NOT_LOGGED_IN') api.onLoggedOut?.();
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { code: data.code, status: res.status });
  }
  return data;
}

export const api = {
  connectUrl: '/api/auth/google',
  onLoggedOut: null,

  authStatus: () => request('/auth/status'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  disconnect: () => request('/auth/disconnect', { method: 'POST' }),

  startSync: () => request('/sync', { method: 'POST' }),
  syncStatus: () => request('/sync/status'),

  listApplications: () => request('/applications'),
  createApplication: (body) => request('/applications', { method: 'POST', body }),
  updateApplication: (id, body) => request(`/applications/${id}`, { method: 'PATCH', body }),
  deleteApplication: (id) => request(`/applications/${id}`, { method: 'DELETE' }),

  activity: (limit = 20) => request(`/activity?limit=${limit}`),
};
