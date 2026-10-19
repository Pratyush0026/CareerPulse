import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import CareerProfile, { computeCompleteness } from '../models/CareerProfile.js';
import SkillEvidence, { determineSkillEvidenceLevel } from '../models/SkillEvidence.js';
import JobOpportunity from '../models/JobOpportunity.js';
import ProfileRevision, { recordRevision } from '../models/ProfileRevision.js';
import Recommendation from '../models/Recommendation.js';
import InterviewReflection from '../models/InterviewReflection.js';
import Experiment from '../models/Experiment.js';
import aiLimit from '../middleware/aiLimit.js';
import { validateResumeFile, parseResumeBuffer, ResumeParseError, MAX_RESUME_SIZE_BYTES } from '../services/resumeParser.js';
import {
  extractResumeProfile,
  forgetExtraction,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_SCHEMA_VERSION,
} from '../services/careerDnaService.js';
import { sanitizeProfile } from '../services/profileInput.js';
import { syncEvidenceFromProfile, getSkillEvidenceOverview, addCustomEvidence, updateEvidence } from '../services/evidenceEngine.js';
import { refreshJobFits, jobDemandFor } from '../services/jobFit.js';
import { FatalAiError } from '../services/gemini.js';

const router = Router();

// Files stay in memory and are discarded after parsing; nothing is written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RESUME_SIZE_BYTES, files: 1 } });

function receiveResume(req, res, next) {
  upload.single('resume')(req, res, (err) => {
    if (!err) return next();
    const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    res.status(400).json({
      error: tooBig ? 'File exceeds the 5 MB limit.' : 'The upload failed. Please try again.',
      code: tooBig ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
    });
  });
}

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ error: 'Invalid id.' });

// Evidence and job fit are derived from the profile, so they're refreshed after any change.
async function refreshDerived(userId, profile) {
  if (profile) await syncEvidenceFromProfile(userId, profile);
  await refreshJobFits(userId, 'profile_change');
}

// The evidence change is already saved at this point, so a failed score refresh is logged
// rather than reported as a failed request. It runs again on the next change.
async function refreshFitsSafely(userId) {
  try {
    await refreshJobFits(userId, 'evidence_change');
  } catch (err) {
    console.warn('[career-dna] Job fit refresh failed:', err.message);
  }
}

router.get('/', async (req, res, next) => {
  try {
    const profile = await CareerProfile.findOne({ userId: req.userId });
    res.json({ profile, completeness: computeCompleteness(profile) });
  } catch (err) {
    next(err);
  }
});

// Returns a draft for the user to review. Nothing is saved here.
router.post('/parse-resume', aiLimit, receiveResume, async (req, res, next) => {
  try {
    const { ext } = validateResumeFile(req.file);
    const text = await parseResumeBuffer(req.file.buffer, ext);
    const { draft, reused } = await extractResumeProfile(req.userId, text);
    res.json({
      draft,
      extraction: {
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        promptVersion: EXTRACTION_PROMPT_VERSION,
        extractedAt: new Date(),
        fileType: ext.slice(1),
      },
      reused,
    });
  } catch (err) {
    if (err instanceof ResumeParseError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof FatalAiError) return res.status(503).json({ error: err.message, code: 'AI_UNAVAILABLE' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  } finally {
    if (req.file) req.file.buffer = null;
  }
});

router.put('/', async (req, res, next) => {
  try {
    const data = sanitizeProfile(req.body);
    const { score, breakdown } = computeCompleteness(data);
    const update = { ...data, completenessScore: score, completenessBreakdown: breakdown, lastEditedAt: new Date() };

    const extraction = req.body?.extraction;
    const fromResume = extraction?.promptVersion === EXTRACTION_PROMPT_VERSION;
    if (fromResume) {
      update.extraction = {
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        promptVersion: EXTRACTION_PROMPT_VERSION,
        extractedAt: new Date(extraction.extractedAt ?? Date.now()),
        fileType: ['pdf', 'docx'].includes(extraction.fileType) ? extraction.fileType : null,
      };
    }

    const profile = await CareerProfile.findOneAndUpdate(
      { userId: req.userId },
      { $set: update, $inc: { version: 1 }, $setOnInsert: { userId: req.userId } },
      { new: true, upsert: true, runValidators: true }
    );

    try {
      await recordRevision(profile, fromResume ? 'resume_review' : profile.version === 1 ? 'created' : 'edit');
    } catch (err) {
      console.warn('[career-dna] Saving profile history failed:', err.message);
    }

    try {
      await refreshDerived(req.userId, profile);
    } catch (err) {
      // The profile itself is saved; evidence is rebuilt again on the next save or rebuild.
      console.warn('[career-dna] Evidence refresh failed:', err.message);
    }
    res.json({ profile, completeness: computeCompleteness(profile) });
  } catch (err) {
    if (err.status === 400 || err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Deletes everything Career DNA has stored for this account.
router.delete('/', async (req, res, next) => {
  try {
    const scope = { userId: req.userId };
    const [profile, evidence, jobs, revisions, recommendations, interviewNotes, experiments] = await Promise.all([
      CareerProfile.deleteOne(scope),
      SkillEvidence.deleteMany(scope),
      JobOpportunity.deleteMany(scope),
      ProfileRevision.deleteMany(scope),
      Recommendation.deleteMany(scope),
      InterviewReflection.deleteMany(scope),
      Experiment.deleteMany(scope),
    ]);
    forgetExtraction(req.userId);
    res.json({
      deleted: {
        profiles: profile.deletedCount,
        evidence: evidence.deletedCount,
        jobs: jobs.deletedCount,
        revisions: revisions.deletedCount,
        recommendations: recommendations.deletedCount,
        interviewNotes: interviewNotes.deletedCount,
        experiments: experiments.deletedCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/evidence', async (req, res, next) => {
  try {
    res.json(await getSkillEvidenceOverview(req.userId));
  } catch (err) {
    next(err);
  }
});

router.get('/evidence/:skillName', async (req, res, next) => {
  try {
    const skill = String(req.params.skillName).slice(0, 80);
    const [records, jobDemand] = await Promise.all([
      SkillEvidence.find({ userId: req.userId, canonicalSkill: skill }).sort({ dateObserved: -1 }).lean(),
      jobDemandFor(req.userId, skill),
    ]);
    res.json({ skill, ...determineSkillEvidenceLevel(records), evidence: records, jobDemand });
  } catch (err) {
    next(err);
  }
});

router.post('/evidence', async (req, res, next) => {
  try {
    const created = await addCustomEvidence(req.userId, req.body);
    await refreshFitsSafely(req.userId);
    res.status(201).json({ created, overview: await getSkillEvidenceOverview(req.userId) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

router.post('/evidence/rebuild', async (req, res, next) => {
  try {
    const profile = await CareerProfile.findOne({ userId: req.userId });
    if (!profile) return res.status(404).json({ error: 'Create your Career DNA profile first.' });
    await refreshDerived(req.userId, profile);
    res.json({ overview: await getSkillEvidenceOverview(req.userId) });
  } catch (err) {
    next(err);
  }
});

router.patch('/evidence/:id', validId, async (req, res, next) => {
  try {
    const updated = await updateEvidence(req.userId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Evidence record not found.' });
    await refreshFitsSafely(req.userId);
    res.json({ updated, overview: await getSkillEvidenceOverview(req.userId) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Only hand-added evidence can be deleted. Profile-derived evidence is marked as wrong
// instead, otherwise the next rebuild would simply bring it back.
router.delete('/evidence/:id', validId, async (req, res, next) => {
  try {
    const record = await SkillEvidence.findOne({ _id: req.params.id, userId: req.userId });
    if (!record) return res.status(404).json({ error: 'Evidence record not found.' });
    if (record.origin !== 'user') {
      return res.status(400).json({ error: 'This evidence comes from your profile. Mark it as wrong, or edit your profile instead.' });
    }
    await record.deleteOne();
    await refreshFitsSafely(req.userId);
    res.json({ deleted: true, overview: await getSkillEvidenceOverview(req.userId) });
  } catch (err) {
    next(err);
  }
});

export default router;
