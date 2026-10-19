// Keeps saved job analyses in step with the profile. Fit is plain code, so recalculating
// after every profile or evidence change costs no AI calls.
import CareerProfile from '../models/CareerProfile.js';
import SkillEvidence from '../models/SkillEvidence.js';
import JobOpportunity, { fitHistoryPush } from '../models/JobOpportunity.js';
import { analyzeOpportunityFit } from './jobDnaService.js';
import { skillsMatch } from './skillNormalizer.js';

export async function loadCandidate(userId) {
  const [profile, evidence] = await Promise.all([
    CareerProfile.findOne({ userId }).lean(),
    SkillEvidence.find({ userId, status: { $ne: 'rejected' } }).lean(),
  ]);
  return { profile, evidence };
}

export function fitFor(job, { profile, evidence }) {
  return analyzeOpportunityFit(job.extractedRequirements, profile, evidence, job.fitAnalysis?.requirementMatches ?? []);
}

/** Recalculates every saved job for the user. `reason` is recorded in each changed job's fit history. */
export async function refreshJobFits(userId, reason) {
  const jobs = await JobOpportunity.find({ userId }, { extractedRequirements: 1, fitAnalysis: 1, fitHistory: { $slice: -1 } }).lean();
  if (!jobs.length) return;
  const candidate = await loadCandidate(userId);
  await JobOpportunity.bulkWrite(
    jobs.map((job) => {
      const fitAnalysis = fitFor(job, candidate);
      const push = fitHistoryPush(job.fitHistory, fitAnalysis, reason, candidate.profile?.version);
      return { updateOne: { filter: { _id: job._id, userId }, update: { $set: { fitAnalysis }, ...(push && { $push: push }) } } };
    })
  );
}

const MIN_JOBS_FOR_PATTERNS = 3;

/**
 * Requirements that keep coming up across the user's saved jobs, with their current evidence level.
 * Only reported once there are enough saved jobs for a pattern to mean something.
 */
export async function requirementPatterns(userId, skillLevels) {
  // Oldest first, so the name a pattern goes by (and the step it keys) stays the same as jobs are added.
  const jobs = await JobOpportunity.find({ userId }, { 'extractedRequirements.requiredSkills': 1, 'extractedRequirements.preferredSkills': 1 })
    .sort({ createdAt: 1 })
    .lean();
  if (jobs.length < MIN_JOBS_FOR_PATTERNS) {
    return { jobCount: jobs.length, minJobs: MIN_JOBS_FOR_PATTERNS, patterns: [] };
  }

  // "GraphQL" in one job and "GraphQL APIs" in another are the same requirement.
  const entries = [];
  const entryFor = (skill) => {
    let entry = entries.find((e) => skillsMatch(e.skill, skill));
    if (!entry) entries.push((entry = { skill, requiredIn: 0, mentionedIn: 0 }));
    return entry;
  };

  for (const job of jobs) {
    const counted = new Map();
    const note = (list, required) => {
      for (const s of list ?? []) {
        const entry = entryFor(s.canonicalSkill || s.name);
        counted.set(entry, counted.get(entry) || required);
      }
    };
    note(job.extractedRequirements?.requiredSkills, true);
    note(job.extractedRequirements?.preferredSkills, false);
    for (const [entry, required] of counted) {
      entry.mentionedIn++;
      if (required) entry.requiredIn++;
    }
  }

  const levelOf = (skill) => [...skillLevels].find(([name]) => skillsMatch(name, skill))?.[1] ?? 'Needs more evidence';
  const patterns = entries
    .filter((p) => p.mentionedIn >= 2)
    .map((p) => ({ ...p, level: levelOf(p.skill) }))
    .sort((a, b) => b.requiredIn - a.requiredIn || b.mentionedIn - a.mentionedIn || a.skill.localeCompare(b.skill));

  return { jobCount: jobs.length, minJobs: MIN_JOBS_FOR_PATTERNS, patterns };
}

/** How many saved jobs ask for one skill – shown when inspecting that skill's evidence. */
export async function jobDemandFor(userId, skill) {
  const [jobCount, requiredIn, preferredIn] = await Promise.all([
    JobOpportunity.countDocuments({ userId }),
    JobOpportunity.countDocuments({ userId, 'extractedRequirements.requiredSkills.canonicalSkill': skill }),
    JobOpportunity.countDocuments({ userId, 'extractedRequirements.preferredSkills.canonicalSkill': skill }),
  ]);
  return { jobCount, requiredIn, preferredIn };
}
