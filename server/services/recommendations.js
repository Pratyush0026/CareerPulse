// Works out the user's next steps from what's already stored: requirements that keep coming up
// in their saved jobs, upcoming interviews, areas they asked to practise, and missing basics.
// It's plain code, so every reason shown can be traced back to records – no AI involved.
import Recommendation, { FINAL_STATUSES, PRIORITIES } from '../models/Recommendation.js';
import CareerProfile from '../models/CareerProfile.js';
import Application from '../models/Application.js';
import StageHistory from '../models/StageHistory.js';
import JobOpportunity from '../models/JobOpportunity.js';
import InterviewReflection from '../models/InterviewReflection.js';
import { getSkillEvidenceOverview } from './evidenceEngine.js';
import { requirementPatterns } from './jobFit.js';
import { skillsMatch } from './skillNormalizer.js';

export class RecommendationInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_DAYS = 14;
const RECENT_STAGE_DAYS = 7;
// Undated rounds are only a nudge; the most recent few are enough.
const MAX_UNDATED_ROUNDS = 3;
const STRENGTH = { 'Strong evidence of match': 2, 'Partial evidence': 1 };
const MIN_JOBS = 3;
const SHOWN_LEVELS = ['Supported by a project or experience', 'Assessment-validated'];
const LEVEL_WORDING = {
  Mentioned: 'only on your resume',
  'User-confirmed': 'confirmed by you, but not shown in a project or role',
  'Needs more evidence': 'nothing yet',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const keyPart = (text) => String(text).trim().toLowerCase();
const startOfDay = (date) => new Date(new Date(date).toDateString());
const shortDate = (date) => new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const priorityFor = (score) => (score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low');
const statusOf = (m) => (m.userOverride?.isOverridden && m.userOverride.userStatus ? m.userOverride.userStatus : m.matchStatus);

// The best verdict Job fit reached for this skill in any saved job, after the user's corrections.
function bestVerdict(skill, analyses) {
  let best = 0;
  for (const job of analyses) {
    for (const m of job.fitAnalysis?.requirementMatches ?? []) {
      if (m.requirementType !== 'skill' || !skillsMatch(m.requirement, skill)) continue;
      best = Math.max(best, STRENGTH[statusOf(m)] ?? 0);
    }
  }
  return best;
}

function fromRecurringRequirements({ patterns, jobCount }, profile, analyses) {
  const targetRole = profile?.goals?.primaryRole || null;
  const toImprove = profile?.goals?.skillsToImprove ?? [];

  return patterns
    .map((p) => ({ ...p, verdict: SHOWN_LEVELS.includes(p.level) ? STRENGTH['Strong evidence of match'] : bestVerdict(p.skill, analyses) }))
    .filter((p) => p.verdict < STRENGTH['Strong evidence of match'])
    .map((p) => {
      const listed = p.level === 'Mentioned' || p.level === 'User-confirmed';
      const touched = !listed && p.verdict === STRENGTH['Partial evidence'];
      const wanted = toImprove.some((s) => skillsMatch(s, p.skill));
      const demand = `${p.skill} is asked for in ${p.mentionedIn} of your ${jobCount} saved jobs${p.requiredIn ? ` (required in ${p.requiredIn})` : ''}.`;
      const base = {
        skill: p.skill,
        targetRole,
        score: Math.min(100, 30 + Math.round((p.mentionedIn / jobCount) * 40) + p.requiredIn * 5 + (wanted ? 15 : 0)),
        evidence: [
          `Asked for in ${p.mentionedIn} of ${jobCount} saved jobs, required in ${p.requiredIn}`,
          `On your profile now: ${touched ? 'related work, not named' : LEVEL_WORDING[p.level] ?? p.level}`,
          ...(wanted ? ['You listed it as a skill you want to improve'] : []),
        ],
        uncertainty: jobCount < 6 ? `Based on ${plural(jobCount, 'saved job')}, which is a small sample. The pattern may change as you save more.` : '',
      };

      return listed || touched
        ? {
            ...base,
            key: `show_evidence:${keyPart(p.skill)}`,
            kind: 'show_evidence',
            title: `Show ${p.skill} in a project or role`,
            why: listed
              ? `${demand} Your profile lists it, but nothing on it shows you using it, so job fit can only give it partial credit.`
              : `${demand} Your profile touches on related work but never names it, so job fit can only give it partial credit.`,
            completionCondition: `${p.skill} shows as “Shown in a project or role” on your profile.`,
            effort: 'small',
          }
        : {
            ...base,
            key: `close_gap:${keyPart(p.skill)}`,
            kind: 'close_gap',
            title: `Add evidence of ${p.skill}, or learn it`,
            why: `${demand} Nothing on your profile mentions it yet. If you’ve used it, add it with an example; if you haven’t, it’s a gap that keeps coming up.`,
            completionCondition: `${p.skill} is on your profile with a project or role behind it.`,
            effort: 'medium',
          };
    });
}

function fromUpcomingRounds(applications, recentStages, analysisByApplication, now) {
  const today = startOfDay(now);
  const recs = [];
  let undated = 0;

  // Most recent first, so the cap on undated rounds keeps the newest ones.
  const byRecency = [...applications].sort((a, b) => (b.lastEmailAt ?? 0) - (a.lastEmailAt ?? 0));
  for (const app of byRecency) {
    const date = app.eventDate && startOfDay(app.eventDate);
    const days = date ? Math.round((date - today) / DAY_MS) : null;
    // A past date ends the round only if it's the latest news. An email after it (a new round
    // invite) means the date belongs to an earlier round.
    const newerEmail = date && app.lastEmailAt && startOfDay(app.lastEmailAt) > date;
    if (days !== null && days < 0 && !newerEmail) continue;
    const upcoming = days !== null && days >= 0 && days <= UPCOMING_DAYS;
    // lastEmailAt is the newest email, or the moment the user moved the card themselves. A card
    // imported from Gmail has a stage history dated by the import, so that's only a fallback.
    const movedAt = app.lastEmailAt ?? recentStages.get(String(app._id));
    const movedOn = movedAt && now - movedAt <= RECENT_STAGE_DAYS * DAY_MS ? movedAt : null;
    if (!upcoming && (!movedOn || ++undated > MAX_UNDATED_ROUNDS)) continue;

    const round = app.stage.toLowerCase();
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    const analysis = analysisByApplication.get(String(app._id));
    const thin = (analysis?.fitAnalysis?.requirementMatches ?? [])
      .filter((m) => m.importance === 'required' && ['No evidence yet', 'Partial evidence'].includes(statusOf(m)))
      .map((m) => m.requirement)
      .slice(0, 3);

    recs.push({
      key: `prepare:${app._id}:${keyPart(app.stage)}`,
      kind: 'prepare',
      title: `Prepare for your ${app.company} ${round}${upcoming ? ` on ${shortDate(date)}` : ''}`,
      why: upcoming
        ? `It’s ${when}.`
        : `${app.company} moved to ${app.stage} on ${shortDate(movedOn)} and no date is known yet.`,
      evidence: [
        `${app.company}${app.role ? ` – ${app.role}` : ''}: ${app.stage}${upcoming ? `, ${shortDate(date)}` : ''}`,
        ...(thin.length ? [`Your analysis of this job has thin evidence for: ${thin.join(', ')}`] : []),
      ],
      uncertainty: analysis ? '' : 'No job description is saved for this application, so this can’t point to specific requirements. Analyse it in Job fit for a sharper plan.',
      completionCondition: thin.length
        ? `Before the ${round}, prepare a concrete example from your own work for each of: ${thin.join(', ')}.`
        : `Before the ${round}, go through the job’s requirements and prepare two examples from your own work.`,
      effort: 'medium',
      score: upcoming ? Math.max(70, 100 - days * 2) : 72,
      applicationId: app._id,
      targetRole: app.role || null,
    });
  }
  return recs;
}

// Something the user asked to practise is a stronger signal than anything read off a resume,
// and more urgent while that application is still in its interview stage.
function fromPracticeAreas(reflections, inProgress) {
  const areas = new Map();
  for (const r of reflections) {
    for (const area of r.practiceAreas) {
      const key = keyPart(area);
      if (!areas.has(key)) areas.set(key, { area, flaggedIn: [] });
      areas.get(key).flaggedIn.push(r);
    }
  }

  return [...areas.entries()].map(([key, { area, flaggedIn }]) => {
    const companies = [...new Set(flaggedIn.map((r) => r.company))];
    const suggestion = flaggedIn
      .flatMap((r) => r.insights?.learningNeeds ?? [])
      .find((n) => keyPart(n.area) === key);
    const alsoTopic = reflections.filter((r) => !flaggedIn.includes(r) && r.topics.some((t) => keyPart(t) === key)).length;
    const ongoing = flaggedIn.filter((r) => inProgress.has(String(r.applicationId))).map((r) => r.company);
    return {
      key: `practice:${key}`,
      kind: 'practice',
      title: `Practise ${area}`,
      why: flaggedIn.length > 1
        ? `You asked to practise it after ${flaggedIn.length} interviews (${companies.join(', ')}).`
        : `You asked to practise it after your ${companies[0]} interview.`,
      evidence: [
        ...flaggedIn.map((r) => `${r.company}${r.role ? ` – ${r.role}` : ''}: you flagged it`),
        ...(alsoTopic ? [`Also came up as a topic in ${plural(alsoTopic, 'other interview')}`] : []),
        ...(suggestion ? [`Suggested from your notes: “${suggestion.basedOn.join('”, “')}”`] : []),
        ...(ongoing.length ? [`Still in progress: ${ongoing.join(', ')}, so a next round may come back to it`] : []),
      ],
      uncertainty: suggestion ? 'The practice exercise was suggested by AI from your notes; adjust it if it doesn’t fit.' : '',
      completionCondition: suggestion
        ? `${suggestion.practice} Then note how it went.`
        : `Do three focused practice sessions on ${area}, then note how it went.`,
      effort: 'medium',
      score: Math.min(95, 60 + (flaggedIn.length - 1) * 10 + alsoTopic * 5 + (ongoing.length ? 15 : 0)),
      skill: area,
      targetRole: flaggedIn[0].role || null,
    };
  });
}

function fromMissingBasics(profile, jobCount) {
  const recs = [];
  if (!profile?.goals?.primaryRole) {
    recs.push({
      key: 'set_goal',
      kind: 'set_goal',
      title: 'Set your target role',
      why: 'Suggestions are ranked around the role you’re aiming for, and it isn’t set yet.',
      evidence: ['No primary target role on your profile'],
      completionCondition: 'A primary target role is saved in Edit profile.',
      effort: 'small',
      score: 55,
    });
  }
  if (jobCount < MIN_JOBS) {
    const missing = MIN_JOBS - jobCount;
    recs.push({
      key: 'add_jobs',
      kind: 'add_jobs',
      title: `Analyse ${plural(missing, 'more job description')} for roles you want`,
      why: `Career DNA can spot what your target roles keep asking for once ${MIN_JOBS} jobs are saved. You have ${jobCount}.`,
      evidence: [`${plural(jobCount, 'job')} analysed so far`],
      completionCondition: `At least ${MIN_JOBS} jobs analysed in Job fit.`,
      effort: 'small',
      score: 50,
    });
  }
  return recs;
}

/** Everything the current data suggests, before it's merged with what the user already decided. */
export async function buildRecommendations(userId, now = new Date()) {
  const [profile, overview, applications, reflections, analyses] = await Promise.all([
    CareerProfile.findOne({ userId }).lean(),
    getSkillEvidenceOverview(userId),
    Application.find({ userId, stage: { $in: ['Assessment', 'Interview'] } }, { company: 1, role: 1, stage: 1, eventDate: 1, lastEmailAt: 1 }).lean(),
    InterviewReflection.find({ userId }).lean(),
    JobOpportunity.find({ userId }, { applicationId: 1, 'fitAnalysis.requirementMatches': 1 }).lean(),
  ]);

  const patterns = await requirementPatterns(userId, new Map(overview.map((s) => [s.skill, s.level])));
  const recentStages = new Map(
    (await StageHistory.find(
      {
        applicationId: { $in: applications.map((a) => a._id) },
        toStage: { $in: ['Assessment', 'Interview'] },
        changedAt: { $gte: new Date(now - RECENT_STAGE_DAYS * DAY_MS) },
      },
      { applicationId: 1, changedAt: 1 }
    ).lean()).map((h) => [String(h.applicationId), h.changedAt])
  );
  const analysisByApplication = new Map(analyses.filter((a) => a.applicationId).map((a) => [String(a.applicationId), a]));

  return [
    ...fromUpcomingRounds(applications, recentStages, analysisByApplication, now),
    ...fromPracticeAreas(reflections, new Set(applications.map((a) => String(a._id)))),
    ...fromRecurringRequirements(patterns, profile, analyses),
    ...fromMissingBasics(profile, patterns.jobCount),
  ].map((rec) => ({ ...rec, priority: priorityFor(rec.score) }));
}

/**
 * Brings the stored recommendations in line with the current data. The user's decisions win:
 * dismissed, completed and "incorrect" ones are never touched again. When a reason goes away, an
 * accepted step is flagged so the user can close it, a snoozed one is kept as outdated, and a
 * suggestion nobody acted on is simply removed – it was never part of the user's history.
 */
export async function refreshRecommendations(userId, now = new Date()) {
  const [fresh, stored] = await Promise.all([buildRecommendations(userId, now), Recommendation.find({ userId }).lean()]);
  const byKey = new Map(stored.map((r) => [r.key, r]));
  const freshKeys = new Set(fresh.map((r) => r.key));
  const ops = [];

  for (const rec of fresh) {
    const current = byKey.get(rec.key);
    if (current && FINAL_STATUSES.includes(current.status)) continue;

    const wakes = current?.status === 'outdated' || (current?.status === 'snoozed' && current.snoozedUntil && current.snoozedUntil <= now);
    const set = { ...rec, reasonResolved: false, ...(wakes && { status: 'suggested', statusChangedAt: now, snoozedUntil: null }) };
    ops.push({
      updateOne: current
        ? // Only if the status is still what was read: a decision made meanwhile wins.
          { filter: { _id: current._id, userId, status: current.status }, update: { $set: set } }
        : { filter: { userId, key: rec.key }, update: { $set: set, $setOnInsert: { status: 'suggested' } }, upsert: true },
    });
  }

  for (const rec of stored) {
    if (freshKeys.has(rec.key) || FINAL_STATUSES.includes(rec.status) || rec.status === 'outdated') continue;
    const filter = { _id: rec._id, userId, status: rec.status };
    // Never acted on (an undo counts as acting on it), so it was never part of the user's history.
    if (rec.status === 'suggested' && !rec.statusChangedAt) ops.push({ deleteOne: { filter } });
    else if (rec.status === 'accepted') ops.push({ updateOne: { filter, update: { $set: { reasonResolved: true } } } });
    else ops.push({ updateOne: { filter, update: { $set: { status: 'outdated', statusChangedAt: now } } } });
  }

  if (!ops.length) return;
  try {
    await Recommendation.bulkWrite(ops, { ordered: false });
  } catch (err) {
    // Two refreshes at once (two tabs, a double load) both try to insert a new suggestion;
    // the unique index keeps one and the other is harmless.
    const duplicatesOnly = err.writeErrors?.length && err.writeErrors.every((e) => e.code === 11000);
    if (!duplicatesOnly) throw err;
  }
}

const ACTIVE_ORDER = { accepted: 0, suggested: 1 };

const latestFirst = (a, b) => (b.statusChangedAt ?? b.updatedAt) - (a.statusChangedAt ?? a.updatedAt);

/**
 * Current recommendations (accepted first, then by score), finished ones, and the rest of the
 * user's decisions. `priority` is the user's choice when they made one, otherwise the calculated one.
 */
export async function listRecommendations(userId) {
  await refreshRecommendations(userId);
  const all = (await Recommendation.find({ userId }).sort({ score: -1 }).lean()).map((r) => ({
    ...r,
    suggestedPriority: r.priority,
    priority: r.userPriority ?? r.priority,
  }));
  return {
    active: all
      .filter((r) => r.status in ACTIVE_ORDER)
      .sort((a, b) => ACTIVE_ORDER[a.status] - ACTIVE_ORDER[b.status] || b.score - a.score),
    done: all.filter((r) => r.status === 'completed').sort(latestFirst).slice(0, 50),
    history: all
      .filter((r) => !(r.status in ACTIVE_ORDER) && r.status !== 'completed')
      .sort(latestFirst)
      .slice(0, 20),
  };
}

const ACTIONS = {
  accept: 'accepted',
  snooze: 'snoozed',
  dismiss: 'dismissed',
  complete: 'completed',
  incorrect: 'incorrect',
  reopen: 'suggested',
};

/**
 * The user's decision on one recommendation, or a priority of their own (`priority: null` goes back
 * to the calculated one). Completing a step never changes skill evidence.
 */
export async function updateRecommendation(userId, id, { action, note, snoozeDays, priority } = {}) {
  if (action === 'prioritize') {
    if (priority !== null && !PRIORITIES.includes(priority)) throw new RecommendationInputError('Unknown priority.');
    return Recommendation.findOneAndUpdate({ _id: id, userId }, { userPriority: priority }, { new: true });
  }
  if (!ACTIONS[action]) throw new RecommendationInputError('Unknown action.');
  const rec = await Recommendation.findOne({ _id: id, userId });
  if (!rec) return null;

  const days = Math.min(Math.max(Math.floor(Number(snoozeDays)) || 7, 1), 30);
  // Undoing "done" means you're still working on it, so it goes back to in progress.
  rec.status = action === 'reopen' && rec.status === 'completed' ? 'accepted' : ACTIONS[action];
  rec.statusChangedAt = new Date();
  rec.snoozedUntil = action === 'snooze' ? new Date(Date.now() + days * DAY_MS) : null;
  if (typeof note === 'string') rec.userNote = note.trim().slice(0, 500);
  await rec.save();
  return rec;
}
