import { Router } from 'express';
import mongoose from 'mongoose';
import Application, { STAGES, PLATFORMS } from '../models/Application.js';
import StageHistory from '../models/StageHistory.js';
import ProcessedEmail from '../models/ProcessedEmail.js';
import JobOpportunity from '../models/JobOpportunity.js';
import InterviewReflection from '../models/InterviewReflection.js';

const router = Router();

const EDITABLE = ['company', 'role', 'stage', 'platform', 'eventDate', 'link', 'lastSummary'];

function pickEditable(body) {
  const out = {};
  for (const key of EDITABLE) if (body[key] !== undefined) out[key] = body[key] === '' ? null : body[key];
  return out;
}

const REQUIRED = ['company', 'stage', 'platform'];

function validate(fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && typeof value !== 'string') return `${key} must be text`;
  }
  // Emptying these would leave a card with no column or no name.
  for (const key of REQUIRED) if (key in fields && !fields[key]?.trim()) return `${key} can't be empty`;
  if (fields.eventDate && Number.isNaN(Date.parse(fields.eventDate))) return 'eventDate must be a date';
  if (fields.stage && !STAGES.includes(fields.stage)) return `stage must be one of: ${STAGES.join(', ')}`;
  if (fields.platform && !PLATFORMS.includes(fields.platform)) return `platform must be one of: ${PLATFORMS.join(', ')}`;
  // Links are opened from the dashboard, so anything other than a web address is refused.
  if (fields.link && !/^https?:\/\//i.test(String(fields.link))) return 'link must start with http:// or https://';
  return null;
}

const validId = (req, res, next) =>
  mongoose.isValidObjectId(req.params.id) ? next() : res.status(400).json({ error: 'Invalid application id' });

router.get('/', async (req, res, next) => {
  try {
    res.json(await Application.find({ userId: req.userId }).sort({ updatedAt: -1 }));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const fields = pickEditable(req.body);
    const error = validate({ company: null, ...fields });
    if (error) return res.status(400).json({ error });

    // Only a stage you chose yourself should stop older emails from moving the card.
    const lastEmailAt = fields.stage ? new Date() : null;
    const app = await Application.create({ stage: 'Applied', ...fields, userId: req.userId, source: 'manual', lastEmailAt });
    await StageHistory.create({ applicationId: app._id, fromStage: null, toStage: app.stage, changedBy: 'manual' });
    res.status(201).json(app);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', validId, async (req, res, next) => {
  try {
    const fields = pickEditable(req.body);
    const error = validate(fields);
    if (error) return res.status(400).json({ error });

    const app = await Application.findOne({ _id: req.params.id, userId: req.userId });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const fromStage = app.stage;
    Object.assign(app, fields);
    app.inferredFields = (app.inferredFields || []).filter((f) => fields[f] === undefined);
    // A stage you set yourself counts as the newest information, so older emails can't undo it.
    // Other edits (a role typo, a link) mustn't stop a later-synced interview email moving the card on.
    if (fields.stage && fields.stage !== fromStage) app.lastEmailAt = new Date();
    await app.save();

    if (fields.stage && fields.stage !== fromStage) {
      await StageHistory.create({ applicationId: app._id, fromStage, toStage: fields.stage, changedBy: 'manual' });
    }
    res.json(app);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', validId, async (req, res, next) => {
  try {
    const app = await Application.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!app) return res.status(404).json({ error: 'Application not found' });
    await StageHistory.deleteMany({ applicationId: app._id });
    // Keep the processed-email records so a later sync doesn't bring the card back.
    await ProcessedEmail.updateMany({ applicationId: app._id }, { applicationId: null });
    // Job analyses stay, they just stop pointing at the deleted card.
    await JobOpportunity.updateMany({ userId: req.userId, applicationId: app._id }, { applicationId: null, source: 'manual_paste' });
    // Interview notes are the user's own writing, so they stay (they keep the company and role).
    await InterviewReflection.updateMany({ userId: req.userId, applicationId: app._id }, { applicationId: null });
    res.json({ deleted: true, id: app._id });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/history', validId, async (req, res, next) => {
  try {
    const owns = await Application.exists({ _id: req.params.id, userId: req.userId });
    if (!owns) return res.status(404).json({ error: 'Application not found' });
    res.json(await StageHistory.find({ applicationId: req.params.id }).sort({ changedAt: 1 }));
  } catch (err) {
    next(err);
  }
});

export default router;
