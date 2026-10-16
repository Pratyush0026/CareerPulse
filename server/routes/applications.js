import { Router } from 'express';
import mongoose from 'mongoose';
import Application, { STAGES, PLATFORMS } from '../models/Application.js';
import StageHistory from '../models/StageHistory.js';
import ProcessedEmail from '../models/ProcessedEmail.js';

const router = Router();

const EDITABLE = ['company', 'role', 'stage', 'platform', 'eventDate', 'link', 'lastSummary'];

function pickEditable(body) {
  const out = {};
  for (const key of EDITABLE) if (body[key] !== undefined) out[key] = body[key] === '' ? null : body[key];
  return out;
}

function validate(fields) {
  if (fields.stage && !STAGES.includes(fields.stage)) return `stage must be one of: ${STAGES.join(', ')}`;
  if (fields.platform && !PLATFORMS.includes(fields.platform)) return `platform must be one of: ${PLATFORMS.join(', ')}`;
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
    if (!fields.company?.trim()) return res.status(400).json({ error: 'company is required' });
    const error = validate(fields);
    if (error) return res.status(400).json({ error });

    const app = await Application.create({ stage: 'Applied', ...fields, userId: req.userId, source: 'manual', lastEmailAt: new Date() });
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
    // Your edit counts as the newest information, so older emails can't undo it.
    app.lastEmailAt = new Date();
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
