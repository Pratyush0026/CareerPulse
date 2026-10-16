import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const POLL_MS = 1500;
const MAX_FAILED_POLLS = 5;

const interrupted = (job, message) => ({
  ...job,
  status: 'failed',
  error: { code: 'SERVER_DOWN', message },
});

/**
 * Starts a server-side sync and polls it until it finishes.
 * A sync that was already running (e.g. before a page refresh) is picked up again.
 */
export function useSyncJob({ enabled, onFinish }) {
  const [job, setJob] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [lastCompleteSyncAt, setLastCompleteSyncAt] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const jobRef = useRef(job);
  jobRef.current = job;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const applyStatus = useCallback((status) => {
    setLastSyncAt(status.lastSyncAt);
    setLastCompleteSyncAt(status.lastCompleteSyncAt);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setJob(null);
      setLoaded(false);
      return undefined;
    }
    let cancelled = false;
    api
      .syncStatus()
      .then((status) => {
        if (cancelled) return;
        applyStatus(status);
        if (status.job?.status === 'running') setJob(status.job);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [enabled, applyStatus]);

  const running = job?.status === 'running';
  const jobId = job?.id;

  useEffect(() => {
    if (!running) return undefined;
    let timer;
    let failures = 0;
    let stopped = false;

    const finish = (finished) => {
      setJob(finished);
      onFinishRef.current?.(finished);
    };

    const poll = async () => {
      try {
        const status = await api.syncStatus();
        if (stopped) return;
        failures = 0;

        if (status.job?.id !== jobId) {
          finish(interrupted(jobRef.current, 'The server restarted during the sync. Everything processed so far is saved.'));
          return;
        }
        if (status.job.status !== 'running') {
          applyStatus(status);
          finish(status.job);
          return;
        }
        setJob(status.job);
      } catch (err) {
        if (stopped) return;
        if (++failures >= MAX_FAILED_POLLS) {
          finish(interrupted(jobRef.current, err.message));
          return;
        }
      }
      timer = setTimeout(poll, POLL_MS);
    };

    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [running, jobId, applyStatus]);

  const start = useCallback(async () => {
    const started = await api.startSync();
    setJob(started);
    return started;
  }, []);

  return { job, running, start, loaded, lastSyncAt, lastCompleteSyncAt };
}
