// Turns the saved Career Profile into per-skill evidence records.
// System records are upserted by a stable key, so a user's corrections (rejecting a record,
// adding notes) survive every rebuild. Records the user added by hand are never touched.
import SkillEvidence, { determineSkillEvidenceLevel, EVIDENCE_LEVELS, USER_EVIDENCE_TYPES } from '../models/SkillEvidence.js';
import { normalizeSkill, inferSkillCategory, isSkillMentionedInText } from './skillNormalizer.js';

export { EVIDENCE_LEVELS };

export class EvidenceInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const keyPart = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
const snippet = (value, max = 220) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** The evidence records the current profile implies, before anything is written. */
export function buildSystemEvidence(userId, profile) {
  const records = new Map();
  const add = (record) => {
    const key = `${record.canonicalSkill}|${record.evidenceType}|${record.sourceKey}`;
    if (!records.has(key)) records.set(key, { userId, origin: 'system', verificationStatus: 'system_derived', ...record });
  };

  const known = new Map();
  for (const skill of profile.skills ?? []) {
    const canonical = normalizeSkill(skill.name);
    if (!canonical) continue;
    const category = inferSkillCategory(canonical, skill.category);
    known.set(canonical, { raw: skill.name, category });

    if (skill.source === 'resume') {
      add({
        canonicalSkill: canonical,
        rawSkillName: skill.name,
        category,
        evidenceType: 'resume_claim',
        sourceKey: 'resume:skills',
        sourceTitle: 'Your resume',
        supportingContext: skill.evidence || 'Listed on your resume.',
        isConfirmed: false,
        confidence: 0.6,
      });
    }
    // Only a confirmation you actually gave (or a skill you typed in yourself) counts as one.
    if (skill.isConfirmed || skill.source !== 'resume') {
      add({
        canonicalSkill: canonical,
        rawSkillName: skill.name,
        category,
        evidenceType: 'user_declaration',
        sourceKey: 'profile:skills',
        sourceTitle: 'Confirmed by you',
        supportingContext: skill.source === 'resume' ? 'You confirmed this resume skill.' : 'You added this skill to your profile.',
        verificationStatus: 'user_verified',
        isConfirmed: true,
        confidence: 1,
      });
    }
  }

  // Roles only count when the description or a bullet mentions the skill, not the job title alone.
  for (const exp of profile.experience ?? []) {
    const lines = [exp.description, ...(exp.achievements ?? []), ...(exp.measurableOutcomes ?? [])].filter(Boolean);
    for (const [canonical, meta] of known) {
      const line = lines.find((l) => isSkillMentionedInText(canonical, l));
      if (!line) continue;
      add({
        canonicalSkill: canonical,
        rawSkillName: meta.raw,
        category: meta.category,
        evidenceType: 'work_experience',
        sourceKey: `experience:${keyPart(exp.role)}@${keyPart(exp.company)}`,
        sourceTitle: `${exp.role} at ${exp.company}`,
        supportingContext: snippet(line),
        isConfirmed: exp.isConfirmed === true,
        confidence: 0.9,
      });
    }
  }

  for (const project of profile.projects ?? []) {
    const sourceKey = `project:${keyPart(project.title)}`;
    const description = [project.description, ...(project.outcomes ?? [])].filter(Boolean).join(' ');
    const tagged = new Set();

    for (const tech of project.technologies ?? []) {
      const canonical = normalizeSkill(tech);
      if (!canonical) continue;
      tagged.add(canonical);
      add({
        canonicalSkill: canonical,
        rawSkillName: tech,
        category: inferSkillCategory(canonical, known.get(canonical)?.category ?? 'Framework / Tool'),
        evidenceType: 'project',
        sourceKey,
        sourceTitle: `Project: ${project.title}`,
        supportingContext: snippet(description || `Listed as a technology used in ${project.title}.`),
        isConfirmed: project.isConfirmed === true || project.source !== 'resume',
        confidence: 0.85,
      });
    }

    for (const [canonical, meta] of known) {
      if (tagged.has(canonical) || !isSkillMentionedInText(canonical, description)) continue;
      add({
        canonicalSkill: canonical,
        rawSkillName: meta.raw,
        category: meta.category,
        evidenceType: 'project',
        sourceKey,
        sourceTitle: `Project: ${project.title}`,
        supportingContext: snippet(description),
        isConfirmed: project.isConfirmed === true || project.source !== 'resume',
        confidence: 0.75,
      });
    }
  }

  return [...records.values()];
}

/** Brings the system evidence in line with the profile without losing user corrections. */
export async function syncEvidenceFromProfile(userId, profile) {
  if (!userId || !profile) return [];
  const desired = buildSystemEvidence(userId, profile);

  if (desired.length) {
    await SkillEvidence.bulkWrite(
      desired.map(({ status, notes, ...fields }) => ({
        updateOne: {
          filter: { userId, canonicalSkill: fields.canonicalSkill, evidenceType: fields.evidenceType, sourceKey: fields.sourceKey },
          // User-owned fields (status, notes) are only set when the record is first created.
          update: { $set: fields, $setOnInsert: { status: 'active', notes: '', dateObserved: new Date() } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  // Drop system records whose source is gone (skill removed, project deleted...).
  const keep = desired.map((d) => ({ canonicalSkill: d.canonicalSkill, evidenceType: d.evidenceType, sourceKey: d.sourceKey }));
  await SkillEvidence.deleteMany({ userId, origin: { $ne: 'user' }, ...(keep.length ? { $nor: keep } : {}) });

  return getSkillEvidenceOverview(userId);
}

/** Evidence grouped per skill, with the level and the reason behind it. */
export async function getSkillEvidenceOverview(userId) {
  const records = await SkillEvidence.find({ userId }).sort({ dateObserved: -1 }).lean();

  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.canonicalSkill)) {
      grouped.set(record.canonicalSkill, { skill: record.canonicalSkill, category: record.category, evidence: [] });
    }
    grouped.get(record.canonicalSkill).evidence.push(record);
  }

  return [...grouped.values()]
    .map((group) => ({ ...group, ...determineSkillEvidenceLevel(group.evidence) }))
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.skill.localeCompare(b.skill));
}

const field = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Evidence the user adds by hand. It can't claim to be an assessment. */
export async function addCustomEvidence(userId, payload = {}) {
  const skillName = field(payload.skillName, 80);
  const sourceTitle = field(payload.sourceTitle, 160);
  const evidenceType = payload.evidenceType || 'user_declaration';
  if (!skillName) throw new EvidenceInputError('Skill name is required.');
  if (!sourceTitle) throw new EvidenceInputError('Give the evidence a short title.');
  if (!USER_EVIDENCE_TYPES.includes(evidenceType)) throw new EvidenceInputError('That kind of evidence can’t be added by hand.');

  const canonical = normalizeSkill(skillName);
  return SkillEvidence.create({
    userId,
    canonicalSkill: canonical,
    rawSkillName: skillName,
    category: inferSkillCategory(canonical, payload.category),
    evidenceType,
    origin: 'user',
    sourceKey: `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    sourceIdentifier: 'user_custom',
    sourceTitle,
    supportingContext: field(payload.supportingContext, 1000),
    verificationStatus: 'user_verified',
    isConfirmed: true,
    confidence: 1,
    notes: field(payload.notes, 1000),
  });
}

/** Corrections a user can make to any record: mark it wrong (or right again) and add a note. */
export async function updateEvidence(userId, id, payload = {}) {
  const record = await SkillEvidence.findOne({ _id: id, userId });
  if (!record) return null;

  if (payload.status !== undefined) {
    if (!['active', 'rejected'].includes(payload.status)) throw new EvidenceInputError('Invalid evidence status.');
    // A confirmation is the user's own statement, so it's undone where it was made, not marked wrong.
    if (record.origin === 'system' && record.evidenceType === 'user_declaration') {
      throw new EvidenceInputError('To take back a confirmation, untick the skill in Edit profile.');
    }
    record.status = payload.status;
  }
  if (payload.notes !== undefined) record.notes = field(payload.notes, 1000);
  if (record.origin === 'user' && payload.supportingContext !== undefined) {
    record.supportingContext = field(payload.supportingContext, 1000);
  }
  await record.save();
  return record;
}
