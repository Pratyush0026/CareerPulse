// POST /api/sync starts a background sync; GET /api/sync/status reports its progress.
import { Router } from 'express';
import config from '../config/index.js';
import User from '../models/User.js';
import { getSyncJob, startSync } from '../services/syncJobs.js';

const router = Router();

// Optional overrides can only narrow a sync, never go past the configured limits (each email costs AI time).
const withinLimit = (value, limit) => {
  const n = Math.floor(Number(value));
  return n > 0 ? Math.min(n, limit) : undefined;
};

router.post('/', (req, res) => {
  const days = withinLimit(req.body?.days, config.sync.days);
  const max = withinLimit(req.body?.max, config.sync.maxEmails);
  res.status(202).json(startSync(req.userId, { days, max }));
});

router.get('/status', async (req, res, next) => {
  try {
    const user = await User.findById(req.userId, { lastSyncAt: 1, lastCompleteSyncAt: 1 }).lean();
    res.json({
      job: getSyncJob(req.userId),
      lastSyncAt: user?.lastSyncAt ?? null,
      lastCompleteSyncAt: user?.lastCompleteSyncAt ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
