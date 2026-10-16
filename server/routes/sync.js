// POST /api/sync starts a background sync; GET /api/sync/status reports its progress.
import { Router } from 'express';
import User from '../models/User.js';
import { getSyncJob, startSync } from '../services/syncJobs.js';

const router = Router();

router.post('/', (req, res) => {
  const days = Number(req.body?.days) || undefined;
  const max = Number(req.body?.max) || undefined;
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
