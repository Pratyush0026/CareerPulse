// Brings Career DNA data written by earlier versions in line with the current rules.
// Safe to run on every start: it only touches records that still need it.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import CareerProfile from '../models/CareerProfile.js';
import SkillEvidence from '../models/SkillEvidence.js';
import JobOpportunity from '../models/JobOpportunity.js';
import ProfileRevision, { recordRevision } from '../models/ProfileRevision.js';
import Migration from '../models/Migration.js';
import { syncEvidenceFromProfile } from '../services/evidenceEngine.js';
import { cleanJobExtraction } from '../services/jobDnaService.js';
import { loadCandidate, fitFor, refreshJobFits } from '../services/jobFit.js';
import { normalizeSkill } from '../services/skillNormalizer.js';

const hashDescription = (text) =>
  crypto.createHash('sha256').update(text.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');

export async function migrateCareerDna() {
  const touchedUsers = new Set();

  // Earlier versions marked every resume skill as confirmed by the user, which nobody had actually
  // done. Profiles saved before extraction metadata existed get their resume skills reset.
  const unversioned = await CareerProfile.find({ 'extraction.promptVersion': { $in: [null, undefined] }, 'skills.source': 'resume' });
  for (const profile of unversioned) {
    let changed = 0;
    for (const skill of profile.skills) {
      if (skill.source === 'resume' && skill.isConfirmed) {
        skill.isConfirmed = false;
        changed++;
      }
    }
    if (!changed) continue;
    profile.extraction = { schemaVersion: 1, promptVersion: 'legacy', extractedAt: null, fileType: null };
    await profile.save();
    touchedUsers.add(String(profile.userId));
    console.log(`[migrate] Reset ${changed} auto-confirmed resume skills for one profile.`);
  }

  // Old evidence had no stable key. System records are rebuilt from the profile; records the
  // user added by hand are kept and marked as theirs.
  const legacy = await SkillEvidence.collection.find({ sourceKey: { $exists: false } }).toArray();
  if (legacy.length) {
    for (const e of legacy.filter((x) => x.sourceIdentifier === 'user_custom')) {
      await SkillEvidence.collection.updateOne({ _id: e._id }, { $set: { origin: 'user', sourceKey: `user:${e._id}`, status: 'active' } });
    }
    await SkillEvidence.collection.deleteMany({ sourceKey: { $exists: false } });
    for (const p of await CareerProfile.find({}, { userId: 1 })) touchedUsers.add(String(p.userId));
  }
  await SkillEvidence.syncIndexes();
  await JobOpportunity.syncIndexes();

  // 0 years used to be the default, not something the user entered.
  const years = await CareerProfile.updateMany({ yearsOfExperience: 0 }, { $set: { yearsOfExperience: null } });
  if (years.modifiedCount) console.log(`[migrate] Cleared ${years.modifiedCount} default "0 years" values.`);

  for (const userId of touchedUsers) {
    const profile = await CareerProfile.findOne({ userId });
    if (profile) await syncEvidenceFromProfile(profile.userId, profile);
  }

  // Analyses made with the old fit logic are recalculated (no AI needed) and get a description hash.
  const oldJobs = await JobOpportunity.find({ promptVersion: null }).sort({ createdAt: -1 });
  const seenHashes = new Set();
  for (const job of oldJobs) {
    const extracted = cleanJobExtraction(job.extractedRequirements.toObject());
    if (!extracted) continue;
    const hash = hashDescription(job.rawJobDescription);
    const taken = seenHashes.has(`${job.userId}:${hash}`) || (await JobOpportunity.exists({ userId: job.userId, descriptionHash: hash }));
    if (!taken) {
      job.descriptionHash = hash;
      seenHashes.add(`${job.userId}:${hash}`);
    }
    job.extractedRequirements = extracted;
    job.promptVersion = 'legacy';
    job.fitAnalysis = fitFor({ extractedRequirements: extracted, fitAnalysis: job.fitAnalysis }, await loadCandidate(job.userId));
    await job.save();
  }
  if (oldJobs.length) console.log(`[migrate] Recalculated ${oldJobs.length} saved job analyses.`);

  // History starts here for data saved before it was recorded: the current state becomes the baseline.
  await ProfileRevision.syncIndexes();
  const withHistory = new Set((await ProfileRevision.distinct('userId')).map(String));
  const withoutHistory = (await CareerProfile.find()).filter((p) => !withHistory.has(String(p.userId)));
  for (const profile of withoutHistory) await recordRevision(profile, 'baseline');

  const baselined = await JobOpportunity.updateMany({ 'fitHistory.0': { $exists: false } }, [
    {
      $set: {
        fitHistory: [{ score: '$fitAnalysis.overallFitScore', tier: '$fitAnalysis.fitTier', reason: 'baseline', profileVersion: null, at: '$updatedAt' }],
      },
    },
  ]);
  if (withoutHistory.length || baselined.modifiedCount) {
    console.log(`[migrate] Started history for ${withoutHistory.length} profiles and ${baselined.modifiedCount} job analyses.`);
  }

  await runOnce('2026-10-skill-matching', fixSkillMatching);
}

// Runs a one-off change and records it, so it never runs twice. If it fails it's retried on the next start.
async function runOnce(name, change) {
  if (await Migration.exists({ name })) return;
  await change();
  await Migration.create({ name });
}

// Skill names used to lose their capitals ("IBM ACE 12" became "Ibm Ace 12"), skills weren't
// linked to roles that wrote them differently, and a user's own confirmation could be marked wrong.
async function fixSkillMatching() {
  const records = await SkillEvidence.find({ origin: 'system' });
  for (const record of records) {
    const update = {};
    const name = normalizeSkill(record.rawSkillName);
    if (name && name !== record.canonicalSkill) update.canonicalSkill = name;
    if (record.evidenceType === 'user_declaration' && record.status === 'rejected') update.status = 'active';
    if (!Object.keys(update).length) continue;
    try {
      await SkillEvidence.updateOne({ _id: record._id }, { $set: update });
    } catch (err) {
      // The correctly named record already exists, so this one is just a duplicate.
      if (err.code === 11000) await SkillEvidence.deleteOne({ _id: record._id });
      else throw err;
    }
  }

  const jobs = await JobOpportunity.find({}, { userId: 1, extractedRequirements: 1 });
  for (const job of jobs) {
    const rename = (skills = []) => skills.map((s) => ({ ...s.toObject(), canonicalSkill: normalizeSkill(s.name) || s.name }));
    await JobOpportunity.updateOne(
      { _id: job._id },
      {
        $set: {
          'extractedRequirements.requiredSkills': rename(job.extractedRequirements?.requiredSkills),
          'extractedRequirements.preferredSkills': rename(job.extractedRequirements?.preferredSkills),
        },
      }
    );
  }

  const profiles = await CareerProfile.find();
  for (const profile of profiles) await syncEvidenceFromProfile(profile.userId, profile);
  const users = new Set([...profiles.map((p) => String(p.userId)), ...jobs.map((j) => String(j.userId))]);
  for (const userId of users) await refreshJobFits(new mongoose.Types.ObjectId(userId), 'scoring_update');
  console.log(`[migrate] Updated skill matching for ${profiles.length} profiles and ${jobs.length} job analyses.`);
}
