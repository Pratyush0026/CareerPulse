import { Router } from 'express';
import ProcessedEmail from '../models/ProcessedEmail.js';

const router = Router();

const MAX_ACTIVITY = 100;

// Most recently processed emails, newest first. ?limit= defaults to 20.
router.get('/activity', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), MAX_ACTIVITY);
    const items = await ProcessedEmail.find({ userId: req.userId })
      .sort({ processedAt: -1 })
      .limit(limit)
      .populate('applicationId', 'company role stage')
      .lean();

    res.json(
      items.map((item) => ({
        id: item._id,
        processedAt: item.processedAt,
        isJobRelated: item.isJobRelated,
        stageDetected: item.stageDetected,
        confidence: item.confidence,
        method: item.method || 'ai',
        skipReason: item.skipReason || null,
        company: item.applicationId?.company || null,
        role: item.applicationId?.role || null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

export default router;
