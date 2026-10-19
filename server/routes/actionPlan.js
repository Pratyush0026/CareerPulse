// Phase 4: recommendations, interview notes and job-search experiments.
// Everything is worked out from stored data. The one AI call – practice suggestions from
// interview notes – only runs when the user asks for it.
import { Router } from 'express';
import mongoose from 'mongoose';
import aiLimit from '../middleware/aiLimit.js';
import InterviewReflection from '../models/InterviewReflection.js';
import Experiment from '../models/Experiment.js';
import { listRecommendations, updateRecommendation } from '../services/recommendations.js';
import { interviewOverview, saveReflection, suggestPractice } from '../services/interviews.js';
import { FatalAiError } from '../services/gemini.js';
import { listExperiments, createExperiment, updateExperiment } from '../services/experiments.js';

const router = Router();

const validId = (param) => (req, res, next) =>
  mongoose.isValidObjectId(req.params[param]) ? next() : res.status(400).json({ error: 'Invalid id.' });

// Bad input (400), a conflicting edit (409) and AI trouble (502/503) get a clear message;
// anything else goes to the error handler.
const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof FatalAiError) return res.status(503).json({ error: err.message, code: 'AI_UNAVAILABLE' });
    if ([400, 409, 502].includes(err.status)) return res.status(err.status).json({ error: err.message });
    next(err);
  }
};

router.get('/recommendations', handle(async (req, res) => {
  res.json(await listRecommendations(req.userId));
}));

router.patch('/recommendations/:id', validId('id'), handle(async (req, res) => {
  const rec = await updateRecommendation(req.userId, req.params.id, req.body);
  if (!rec) return res.status(404).json({ error: 'Recommendation not found.' });
  res.json(rec);
}));

router.get('/interviews', handle(async (req, res) => {
  res.json(await interviewOverview(req.userId));
}));

router.put('/interviews/:applicationId', validId('applicationId'), handle(async (req, res) => {
  const reflection = await saveReflection(req.userId, req.params.applicationId, req.body);
  if (!reflection) return res.status(404).json({ error: 'Application not found.' });
  res.json(reflection);
}));

router.post('/interviews/:id/suggestions', validId('id'), aiLimit, handle(async (req, res) => {
  const result = await suggestPractice(req.userId, req.params.id);
  if (!result) return res.status(404).json({ error: 'Notes not found.' });
  res.json({ ...result.reflection.toObject(), reused: result.reused });
}));

router.delete('/interviews/:id', validId('id'), handle(async (req, res) => {
  const result = await InterviewReflection.deleteOne({ _id: req.params.id, userId: req.userId });
  if (!result.deletedCount) return res.status(404).json({ error: 'Notes not found.' });
  res.json({ deleted: true });
}));

router.get('/experiments', handle(async (req, res) => {
  res.json(await listExperiments(req.userId));
}));

router.post('/experiments', handle(async (req, res) => {
  res.status(201).json(await createExperiment(req.userId, req.body));
}));

router.patch('/experiments/:id', validId('id'), handle(async (req, res) => {
  const experiment = await updateExperiment(req.userId, req.params.id, req.body);
  if (!experiment) return res.status(404).json({ error: 'Experiment not found.' });
  res.json(experiment);
}));

router.delete('/experiments/:id', validId('id'), handle(async (req, res) => {
  const result = await Experiment.deleteOne({ _id: req.params.id, userId: req.userId });
  if (!result.deletedCount) return res.status(404).json({ error: 'Experiment not found.' });
  res.json({ deleted: true });
}));

export default router;
