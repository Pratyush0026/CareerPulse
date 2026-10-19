// Interview notes the user chooses to write after a round. Nothing here is inferred: a stage
// change only prompts the question, and a rejection is never read as a sign of anything.
import Application from '../models/Application.js';
import StageHistory from '../models/StageHistory.js';
import InterviewReflection from '../models/InterviewReflection.js';
import CareerProfile from '../models/CareerProfile.js';
import { notesHash, suggestFromNotes, InsightsError } from './interviewInsights.js';

export class InterviewInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Assessments rarely come with feedback, so notes are only asked for after interviews.
const ROUNDS = ['Interview'];

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Short, de-duplicated list of what the user typed (case-insensitive).
function list(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((v) => text(v, 120))
    .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .slice(0, 12);
}

/** Applications that reached an interview, newest first, with any notes already written. */
export async function interviewOverview(userId) {
  const [apps, reflections, notedIds] = await Promise.all([
    Application.find({ userId }, { company: 1, role: 1, stage: 1, eventDate: 1, updatedAt: 1 }).lean(),
    InterviewReflection.find({ userId }).sort({ updatedAt: -1 }).limit(50).lean(),
    // Every application with notes, not just the 50 shown, so older notes are never offered as "new".
    InterviewReflection.distinct('applicationId', { userId }),
  ]);

  const rounds = await StageHistory.aggregate([
    { $match: { applicationId: { $in: apps.map((a) => a._id) }, toStage: { $in: ROUNDS } } },
    { $group: { _id: '$applicationId', reachedAt: { $max: '$changedAt' } } },
  ]);
  const reachedAt = new Map(rounds.map((r) => [String(r._id), r.reachedAt]));
  const noted = new Set(notedIds.map(String));

  // An interview counts if the card is still there or went on to an offer or a rejection. A card
  // moved back to Applied or Assessment had the interview move undone, so it isn't asked about.
  const hadInterview = (a) =>
    ['Interview', 'Offer'].includes(a.stage) || (a.stage === 'Rejected' && reachedAt.has(String(a._id)));

  const awaitingNotes = apps
    .filter((a) => hadInterview(a) && !noted.has(String(a._id)))
    .map((a) => ({ ...a, reachedAt: reachedAt.get(String(a._id)) ?? a.updatedAt }))
    .sort((a, b) => b.reachedAt - a.reachedAt)
    .slice(0, 10);

  return { awaitingNotes, reflections, recurringTopics: recurringTopics(reflections) };
}

/** Topics that came up in more than one interview, with where. Shown with the sample size. */
function recurringTopics(reflections) {
  const topics = new Map();
  for (const r of reflections) {
    for (const topic of r.topics) {
      const key = topic.toLowerCase();
      if (!topics.has(key)) topics.set(key, { topic, companies: [] });
      topics.get(key).companies.push(r.company);
    }
  }
  return [...topics.values()]
    .filter((t) => t.companies.length > 1)
    .map((t) => ({ ...t, count: t.companies.length, outOf: reflections.length }))
    .sort((a, b) => b.count - a.count);
}

/** Saves the notes for one application. Saving again updates the same notes. */
export async function saveReflection(userId, applicationId, body = {}) {
  const app = await Application.findOne({ _id: applicationId, userId }, { company: 1, role: 1, stage: 1, eventDate: 1 }).lean();
  if (!app) return null;

  const notes = {
    topics: list(body.topics),
    difficultQuestions: list(body.difficultQuestions),
    feedback: text(body.feedback, 2000),
    practiceAreas: list(body.practiceAreas),
  };
  if (!notes.topics.length && !notes.difficultQuestions.length && !notes.feedback && !notes.practiceAreas.length) {
    throw new InterviewInputError('Add at least one note before saving.');
  }

  // Suggestions made from the old notes no longer fit once those notes change.
  const existing = await InterviewReflection.findOne({ userId, applicationId: app._id }, { insights: 1 }).lean();
  const outdated = existing?.insights && existing.insights.notesHash !== notesHash(notes);

  const save = () =>
    InterviewReflection.findOneAndUpdate(
      { userId, applicationId: app._id },
      {
        $set: { ...notes, company: app.company, role: app.role ?? '' },
        $setOnInsert: { stage: 'Interview', occurredOn: app.eventDate ?? new Date() },
        ...(outdated && { $unset: { insights: '' } }),
      },
      { new: true, upsert: true, runValidators: true }
    );
  try {
    return await save();
  } catch (err) {
    // Two first saves at once: one created the notes, so the other simply updates them.
    if (err.code === 11000) return save();
    throw err;
  }
}

/** Asks Gemini for practice suggestions from one set of notes, and saves them on the notes. */
export async function suggestPractice(userId, reflectionId) {
  const reflection = await InterviewReflection.findOne({ _id: reflectionId, userId });
  if (!reflection) return null;
  const profile = await CareerProfile.findOne({ userId }, { 'goals.primaryRole': 1 }).lean();

  const { insights, reused } = await suggestFromNotes(reflection.toObject(), profile?.goals?.primaryRole);
  if (reused) return { reflection, reused };

  // Gemini takes a few seconds; if the notes were edited meanwhile, these suggestions are for the old ones.
  const saved = await InterviewReflection.findOneAndUpdate(
    { _id: reflection._id, userId, updatedAt: reflection.updatedAt },
    { $set: { insights } },
    { new: true }
  );
  if (!saved) throw new InsightsError('Your notes changed while the suggestions were being made. Please ask again.', 409);
  return { reflection: saved, reused: false };
}
