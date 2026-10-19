import crypto from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import JobOpportunity, { fitHistoryPush } from '../models/JobOpportunity.js';
import CareerProfile from '../models/CareerProfile.js';
import Application from '../models/Application.js';
import aiLimit from '../middleware/aiLimit.js';
import { extractJobRequirements, summarizeFit, MATCH_STATUSES, JOB_PROMPT_VERSION } from '../services/jobDnaService.js';
import { loadCandidate, fitFor, requirementPatterns } from '../services/jobFit.js';
import { getSkillEvidenceOverview } from '../services/evidenceEngine.js';
import { FatalAiError } from '../services/gemini.js';

const router = Router();

const MIN_JD_CHARS = 80;
const MAX_JD_CHARS = 20000;
const APPLICATION_FIELDS = 'company role stage platform link';

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ error: 'Invalid id.' });

const hashDescription = (text) =>
  crypto.createHash('sha256').update(text.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const jobs = await JobOpportunity.find({ userId: req.userId })
      .select('company role applicationId source createdAt updatedAt fitAnalysis.overallFitScore fitAnalysis.fitTier fitAnalysis.scoringBreakdown')
      .populate('applicationId', APPLICATION_FIELDS)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// The user's tracked applications, for linking a job description to one. The link and
// message ID let the user open the original email or job page to copy the description.
router.get('/applications', async (req, res, next) => {
  try {
    const apps = await Application.find({ userId: req.userId })
      .select('company role stage platform link lastMessageId createdAt')
      .sort({ updatedAt: -1 })
      .limit(300)
      .lean();
    res.json(apps);
  } catch (err) {
    next(err);
  }
});

router.get('/patterns', async (req, res, next) => {
  try {
    const overview = await getSkillEvidenceOverview(req.userId);
    const levels = new Map(overview.map((s) => [s.skill, s.level]));
    res.json(await requirementPatterns(req.userId, levels));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', validId, async (req, res, next) => {
  try {
    const job = await JobOpportunity.findOne({ _id: req.params.id, userId: req.userId })
      .populate('applicationId', APPLICATION_FIELDS)
      .lean();
    if (!job) return res.status(404).json({ error: 'Analysis not found.' });
    res.json(job);
  } catch (err) {
    next(err);
  }
});

router.post('/analyze', aiLimit, async (req, res, next) => {
  try {
    const description = text(req.body?.rawJobDescription, MAX_JD_CHARS + 1);
    if (description.length < MIN_JD_CHARS) {
      return res.status(400).json({ error: 'Paste the full job description – at least a few sentences.' });
    }
    if (description.length > MAX_JD_CHARS) {
      return res.status(400).json({ error: 'That description is too long. Paste just the role details and requirements.' });
    }

    // Only the user's own applications can be linked.
    let application = null;
    const { applicationId } = req.body ?? {};
    if (applicationId) {
      if (!mongoose.isValidObjectId(applicationId)) return res.status(400).json({ error: 'Invalid application.' });
      application = await Application.findOne({ _id: applicationId, userId: req.userId });
      if (!application) return res.status(404).json({ error: 'That application wasn’t found.' });
    }

    const company = text(req.body?.company, 120) || application?.company || 'Unknown company';
    const role = text(req.body?.role, 120) || application?.role || 'Untitled role';
    const descriptionHash = hashDescription(description);

    // The same description was analysed before: reuse its requirements instead of calling the AI again.
    const existing = await JobOpportunity.findOne({ userId: req.userId, descriptionHash });
    const extractedRequirements =
      existing?.promptVersion === JOB_PROMPT_VERSION
        ? existing.extractedRequirements.toObject()
        : await extractJobRequirements(description, { company, role });

    const candidate = await loadCandidate(req.userId);
    const linkedApplicationId = application?._id ?? existing?.applicationId ?? null;
    const fields = {
      company,
      role,
      applicationId: linkedApplicationId,
      source: linkedApplicationId ? 'linked_application' : 'manual_paste',
      rawJobDescription: description,
      promptVersion: JOB_PROMPT_VERSION,
      extractedRequirements,
    };
    fields.fitAnalysis = fitFor({ extractedRequirements, fitAnalysis: existing?.fitAnalysis }, candidate);
    const push = fitHistoryPush(existing?.fitHistory, fields.fitAnalysis, 'analysed', candidate.profile?.version);

    const job = await JobOpportunity.findOneAndUpdate(
      { userId: req.userId, descriptionHash },
      { $set: fields, $setOnInsert: { userId: req.userId, descriptionHash }, ...(push && { $push: push }) },
      { new: true, upsert: true, runValidators: true }
    ).populate('applicationId', APPLICATION_FIELDS);

    res.status(existing ? 200 : 201).json({ ...job.toObject(), reused: Boolean(existing) });
  } catch (err) {
    if (err instanceof FatalAiError) return res.status(503).json({ error: err.message, code: 'AI_UNAVAILABLE' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Correct the system's verdict on one requirement. userStatus null removes the correction.
router.patch('/:id/override', validId, async (req, res, next) => {
  try {
    const { matchId, userStatus = null } = req.body ?? {};
    if (userStatus !== null && !MATCH_STATUSES.includes(userStatus)) {
      return res.status(400).json({ error: 'Invalid match status.' });
    }

    const job = await JobOpportunity.findOne({ _id: req.params.id, userId: req.userId });
    if (!job) return res.status(404).json({ error: 'Analysis not found.' });
    const match = job.fitAnalysis.requirementMatches.id(matchId);
    if (!match) return res.status(400).json({ error: 'That requirement wasn’t found in this analysis.' });

    match.userOverride = userStatus
      ? { isOverridden: true, userStatus, userNote: text(req.body.userNote, 500) }
      : { isOverridden: false, userStatus: null, userNote: '' };

    Object.assign(job.fitAnalysis, summarizeFit(job.fitAnalysis.requirementMatches));
    const profile = await CareerProfile.findOne({ userId: req.userId }, { version: 1 }).lean();
    const push = fitHistoryPush(job.fitHistory, job.fitAnalysis, 'correction', profile?.version);

    const updated = await JobOpportunity.findOneAndUpdate(
      { _id: job._id, userId: req.userId },
      { $set: { fitAnalysis: job.fitAnalysis.toObject() }, ...(push && { $push: push }) },
      { new: true, runValidators: true }
    ).populate('applicationId', APPLICATION_FIELDS);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', validId, async (req, res, next) => {
  try {
    const result = await JobOpportunity.deleteOne({ _id: req.params.id, userId: req.userId });
    if (!result.deletedCount) return res.status(404).json({ error: 'Analysis not found.' });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
