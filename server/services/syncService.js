// Sync pipeline: Gmail → rule filter → Gemini → MongoDB.
import config from '../config/index.js';
import Application from '../models/Application.js';
import ProcessedEmail from '../models/ProcessedEmail.js';
import StageHistory from '../models/StageHistory.js';
import User from '../models/User.js';
import { buildSearchQuery, fetchCandidateEmails } from './gmailService.js';
import { classifyBatch, FatalClassifierError } from './classifier.js';
import { ruleBasedSkipReason } from './emailFilter.js';
import { findMatchingApplication, inferPlatform, isForwardMove } from './matcher.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Incremental syncs re-check the hour before the last one, so mail that arrived mid-sync isn't missed.
const OVERLAP_MS = 60 * 60 * 1000;

const toDate = (ymd) => (ymd ? new Date(`${ymd}T00:00:00`) : null);
const sameId = (a, b) => String(a) === String(b);

/**
 * Applies one classified email to the user's board.
 * `applications` is the user's cards, loaded once per sync and kept up to date here.
 */
export async function applyResult(email, result, { userId, applications }) {
  // A newer "you're still in" email for a rejected company is a new application, not the old one.
  const reopensRejected = (app) =>
    app.stage === 'Rejected' &&
    result.stage &&
    result.stage !== 'Rejected' &&
    (!app.lastEmailAt || email.date > new Date(app.lastEmailAt));

  const candidates = applications.filter((app) => !reopensRejected(app));
  const match = findMatchingApplication(candidates, result.company, result.role);
  const { platform, guessed: platformGuessed } = inferPlatform(email.sender, result.company);

  if (!match) {
    const stage = result.stage || 'Applied';
    const inferredFields = [];
    if (!result.stage) inferredFields.push('stage');
    if (platformGuessed) inferredFields.push('platform');

    const app = await Application.create({
      userId,
      company: result.company,
      role: result.role,
      stage,
      source: 'gmail',
      platform,
      eventDate: toDate(result.event_date),
      link: result.link,
      lastSummary: result.summary,
      lastEmailAt: email.date,
      firstEmailAt: email.date,
      lastMessageId: email.messageId,
      inferredFields,
      aiUpdatedAt: new Date(),
    });
    applications.push(app.toObject());
    await StageHistory.create({ applicationId: app._id, fromStage: null, toStage: stage, changedBy: 'ai' });
    return { status: 'created', applicationId: app._id };
  }

  const app = await Application.findOne({ _id: match._id, userId });
  if (!app) {
    // Deleted while this sync was running: respect that rather than bringing it back.
    applications.splice(applications.indexOf(match), 1);
    return { status: 'unchanged', applicationId: null };
  }
  const fromStage = app.stage;

  // Older emails can only fill gaps. They must never replace newer details or move the stage.
  const isNewer = !app.lastEmailAt || email.date >= app.lastEmailAt;
  if (isNewer) {
    if (result.summary) app.lastSummary = result.summary;
    if (result.event_date) app.eventDate = toDate(result.event_date);
    if (result.link) app.link = result.link;
    app.lastEmailAt = email.date;
    app.lastMessageId = email.messageId;
  } else {
    app.lastSummary ??= result.summary || null;
    app.eventDate ??= toDate(result.event_date);
    app.link ??= result.link;
  }
  app.role ??= result.role;
  app.lastMessageId ??= email.messageId;

  const platformWasGuessed = app.inferredFields.includes('platform') || app.platform === 'unknown';
  if (platformWasGuessed && !platformGuessed) {
    app.platform = platform;
    app.inferredFields = app.inferredFields.filter((f) => f !== 'platform');
  } else if (app.platform === 'unknown' && platform !== 'unknown') {
    app.platform = platform;
  }

  const stageChanged = isNewer && isForwardMove(app.stage, result.stage);
  if (stageChanged) app.stage = result.stage;
  if (app.inferredFields.includes('stage') && (stageChanged || result.stage === app.stage)) {
    app.inferredFields = app.inferredFields.filter((f) => f !== 'stage');
  }

  // Cards from before this field existed fall back to when they were created.
  const firstSeen = email.date < (app.firstEmailAt ?? app.createdAt) ? email.date : null;
  if (!app.isModified()) {
    // An earlier email date isn't news, so it's stored without marking the card as updated.
    if (firstSeen) await Application.updateOne({ _id: app._id, userId }, { firstEmailAt: firstSeen });
    return { status: 'unchanged', applicationId: app._id };
  }
  if (firstSeen) app.firstEmailAt = firstSeen;

  app.aiUpdatedAt = new Date();
  await app.save();
  if (stageChanged) {
    await StageHistory.create({ applicationId: app._id, fromStage, toStage: app.stage, changedBy: 'ai' });
  }
  const index = applications.findIndex((a) => sameId(a._id, app._id));
  applications[index] = app.toObject();
  return { status: 'updated', applicationId: app._id };
}

/**
 * New messages in the same Gmail thread (an invite, a "Recall:", a re-send) are classified
 * together as one item: the newest message plus a short excerpt of the earlier ones.
 */
function groupByThread(emails) {
  const threads = new Map();
  for (const email of emails) {
    const key = email.threadId || email.messageId;
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(email);
  }

  return [...threads.values()]
    .map((messages) => {
      const latest = messages[messages.length - 1];
      if (messages.length === 1) return { email: latest, messages };

      const body = [...messages]
        .reverse()
        .map((m, i) => `[${m.date.toLocaleString('en-IN')}] ${m.subject}\n${m.body.slice(0, i === 0 ? 1000 : 300)}`)
        .join('\n---\n');
      return { email: { ...latest, body }, messages };
    })
    .sort((a, b) => a.email.date - b.email.date);
}

async function findProcessed(userId, ids) {
  if (!ids.length) return new Set();
  const docs = await ProcessedEmail.find({ userId, messageId: { $in: ids } }, { messageId: 1 }).lean();
  return new Set(docs.map((d) => d.messageId));
}

async function markProcessed(records) {
  try {
    await ProcessedEmail.insertMany(records, { ordered: false });
  } catch (err) {
    if (err.code !== 11000 && !err.writeErrors?.every((e) => e.code === 11000)) throw err;
  }
}

/**
 * Runs one sync for a user. `onProgress` receives `{ phase, done, total }` as work moves
 * through searching → downloading → classifying.
 */
export async function runSync({ userId, days = config.sync.days, max = config.sync.maxEmails, onProgress = () => {} }) {
  const startedAt = new Date();
  const user = await User.findById(userId);
  if (!user) throw new Error('Account not found');

  const canResume = user.lastCompleteSyncAt && startedAt - user.lastCompleteSyncAt < days * DAY_MS;
  const since = canResume ? new Date(user.lastCompleteSyncAt.getTime() - OVERLAP_MS) : null;

  const summary = {
    mode: since ? 'incremental' : 'full',
    emailsFetched: 0,
    processed: 0,
    skippedByRules: 0,
    jobRelatedFound: 0,
    created: 0,
    updated: 0,
    skippedLowConfidence: 0,
    errors: 0,
    stoppedReason: null,
    remaining: 0,
  };

  onProgress({ phase: 'searching', done: 0, total: 0 });
  const { emails, remaining } = await fetchCandidateEmails({
    userId,
    query: buildSearchQuery({ days, since }),
    max,
    findProcessed: (ids) => findProcessed(userId, ids),
    onProgress: (done, total) => onProgress({ phase: 'downloading', done, total }),
  });
  summary.emailsFetched = emails.length;
  summary.remaining = remaining;

  const toClassify = [];
  const skipped = [];
  for (const email of emails) {
    const reason = ruleBasedSkipReason(email);
    if (reason) {
      skipped.push({ userId, messageId: email.messageId, isJobRelated: false, confidence: 1, method: 'rule', skipReason: reason });
    } else {
      toClassify.push(email);
    }
  }
  await markProcessed(skipped);
  summary.skippedByRules = skipped.length;
  summary.processed = skipped.length;

  const items = groupByThread(toClassify);
  const applications = await Application.find({ userId }).lean();

  const handleResult = async ({ email, messages }, result) => {
    if (result.is_job_related) summary.jobRelatedFound++;
    const confident = result.is_job_related && result.company && result.confidence >= config.sync.minConfidence;
    if (result.is_job_related && !confident) summary.skippedLowConfidence++;

    let applicationId = null;
    if (confident) {
      try {
        const outcome = await applyResult(email, result, { userId, applications });
        applicationId = outcome.applicationId;
        if (outcome.status !== 'unchanged') summary[outcome.status]++;
      } catch (err) {
        // Bad data from the model would fail on every sync, so record the email and move on.
        if (err.name !== 'ValidationError' && err.name !== 'CastError') throw err;
        summary.errors++;
        console.error(`[sync] Invalid AI result for ${email.messageId}: ${err.message}`);
      }
    }

    await markProcessed(
      messages.map((m) => ({
        userId,
        messageId: m.messageId,
        applicationId,
        isJobRelated: result.is_job_related,
        stageDetected: result.stage,
        confidence: result.confidence,
        method: 'ai',
      }))
    );
    summary.processed += messages.length;
  };

  const size = config.sync.batchSize;
  let classified = 0;
  onProgress({ phase: 'classifying', done: 0, total: toClassify.length });

  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    let results;
    try {
      results = await classifyBatch(batch.map((item) => item.email));
    } catch (err) {
      if (!(err instanceof FatalClassifierError)) throw err;
      summary.stoppedReason = err.message;
      summary.remaining += items.slice(i).reduce((n, item) => n + item.messages.length, 0);
      break;
    }

    for (const [j, item] of batch.entries()) {
      if (!results[j]) {
        summary.errors++;
        continue;
      }
      try {
        await handleResult(item, results[j]);
      } catch (err) {
        summary.errors++;
        console.error(`[sync] Failed to save ${item.email.messageId}:`, err.message);
      }
    }
    classified += batch.reduce((n, item) => n + item.messages.length, 0);
    onProgress({ phase: 'classifying', done: classified, total: toClassify.length });
  }

  const complete = !summary.stoppedReason && !summary.remaining && !summary.errors;
  await User.updateOne(
    { _id: userId },
    { $set: { lastSyncAt: startedAt, lastCompleteSyncAt: complete ? startedAt : null } }
  );

  summary.durationSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[sync] ${user.email} (${summary.mode}):`, summary);
  return summary;
}
