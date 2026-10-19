// Thin fetch wrapper for the CareerPulse API. Vite proxies /api to the Express server.

const SERVER_DOWN =
  'Lost connection to the CareerPulse server. Anything already processed is saved – please try again. ' +
  'If it keeps happening, check that “npm run dev” is still running.';

async function request(path, options = {}) {
  let res;
  const isForm = options.body instanceof FormData;
  const headers = isForm ? { ...(options.headers || {}) } : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const body = isForm ? options.body : options.body ? JSON.stringify(options.body) : undefined;

  try {
    res = await fetch(`/api${path}`, {
      ...options,
      headers,
      body,
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

  // Career DNA
  getCareerDna: () => request('/career-dna'),
  parseResume: (file) => {
    const formData = new FormData();
    formData.append('resume', file);
    return request('/career-dna/parse-resume', { method: 'POST', body: formData });
  },
  saveCareerDna: (body) => request('/career-dna', { method: 'PUT', body }),
  deleteCareerDna: () => request('/career-dna', { method: 'DELETE' }),

  // Phase 2: Career Evidence Engine
  getEvidenceOverview: () => request('/career-dna/evidence'),
  getSkillEvidence: (skillName) => request(`/career-dna/evidence/${encodeURIComponent(skillName)}`),
  addEvidence: (body) => request('/career-dna/evidence', { method: 'POST', body }),
  updateEvidence: (id, body) => request(`/career-dna/evidence/${id}`, { method: 'PATCH', body }),
  deleteEvidence: (id) => request(`/career-dna/evidence/${id}`, { method: 'DELETE' }),
  rebuildEvidence: () => request('/career-dna/evidence/rebuild', { method: 'POST' }),

  // Phase 3: Job DNA & Opportunity Fit
  getAnalyzedJobs: () => request('/career-dna/jobs'),
  getRequirementPatterns: () => request('/career-dna/jobs/patterns'),
  getTrackedApplications: () => request('/career-dna/jobs/applications'),
  getJobDetail: (id) => request(`/career-dna/jobs/${id}`),
  analyzeJob: (body) => request('/career-dna/jobs/analyze', { method: 'POST', body }),
  overrideRequirementMatch: (id, body) =>
    request(`/career-dna/jobs/${id}/override`, { method: 'PATCH', body }),
  deleteAnalyzedJob: (id) => request(`/career-dna/jobs/${id}`, { method: 'DELETE' }),

  // Phase 4: Action plan
  getRecommendations: () => request('/career-dna/plan/recommendations'),
  updateRecommendation: (id, body) => request(`/career-dna/plan/recommendations/${id}`, { method: 'PATCH', body }),
  getInterviews: () => request('/career-dna/plan/interviews'),
  saveInterviewNotes: (applicationId, body) => request(`/career-dna/plan/interviews/${applicationId}`, { method: 'PUT', body }),
  deleteInterviewNotes: (id) => request(`/career-dna/plan/interviews/${id}`, { method: 'DELETE' }),
  suggestPractice: (id) => request(`/career-dna/plan/interviews/${id}/suggestions`, { method: 'POST' }),
  getExperiments: () => request('/career-dna/plan/experiments'),
  createExperiment: (body) => request('/career-dna/plan/experiments', { method: 'POST', body }),
  updateExperiment: (id, body) => request(`/career-dna/plan/experiments/${id}`, { method: 'PATCH', body }),
  deleteExperiment: (id) => request(`/career-dna/plan/experiments/${id}`, { method: 'DELETE' }),
};
