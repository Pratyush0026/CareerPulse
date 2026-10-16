// Runs syncs in the background (one per user) so the dashboard can poll their progress.
import crypto from 'node:crypto';
import { runSync } from './syncService.js';
import { ReconnectRequiredError } from './gmailService.js';
import { FatalClassifierError } from './classifier.js';

const KEEP_FINISHED_MS = 10 * 60 * 1000;

// Share of the progress bar each phase covers. Classifying is by far the slowest part.
const PHASE_RANGE = {
  searching: [0, 5],
  downloading: [5, 35],
  classifying: [35, 98],
};

const jobs = new Map();

function percentFor({ phase, done, total }) {
  const [from, to] = PHASE_RANGE[phase] ?? [0, 0];
  const share = total ? Math.min(done / total, 1) : 0;
  return Math.round(from + (to - from) * share);
}

function errorCode(err) {
  if (err instanceof ReconnectRequiredError) return 'RECONNECT_GMAIL';
  if (err instanceof FatalClassifierError) return 'GEMINI_CONFIG';
  return 'SYNC_FAILED';
}

export function getSyncJob(userId) {
  return jobs.get(String(userId)) ?? null;
}

/** Starts a sync for the user, or returns the one that's already running. */
export function startSync(userId, options = {}) {
  const key = String(userId);
  const running = jobs.get(key);
  if (running?.status === 'running') return running;

  const job = {
    id: crypto.randomUUID(),
    status: 'running',
    phase: 'searching',
    done: 0,
    total: 0,
    percent: 0,
    startedAt: new Date(),
    finishedAt: null,
    summary: null,
    error: null,
  };
  jobs.set(key, job);

  const onProgress = (progress) => {
    Object.assign(job, progress, { percent: Math.max(job.percent, percentFor(progress)) });
  };

  runSync({ userId, ...options, onProgress })
    .then((summary) => Object.assign(job, { status: 'done', phase: 'done', percent: 100, summary }))
    .catch((err) => {
      console.error('[sync] Failed:', err.message);
      Object.assign(job, { status: 'failed', error: { message: err.message, code: errorCode(err) } });
    })
    .finally(() => {
      job.finishedAt = new Date();
      setTimeout(() => jobs.get(key) === job && jobs.delete(key), KEEP_FINISHED_MS).unref();
    });

  return job;
}
