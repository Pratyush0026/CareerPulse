import mongoose from 'mongoose';

export const EVIDENCE_TYPES = [
  'resume_claim',
  'work_experience',
  'project',
  'user_declaration',
  'job_description',
  'interview_feedback',
  'assessment',
  'other',
];

// Types a user may add by hand. Assessments only come from assessments taken inside CareerPulse.
export const USER_EVIDENCE_TYPES = ['user_declaration', 'project', 'work_experience', 'interview_feedback', 'other'];

export const VERIFICATION_STATUSES = ['unverified', 'user_verified', 'system_derived', 'third_party_verified'];

export const EVIDENCE_LEVELS = {
  USER_CONFIRMED: 'User-confirmed',
  SUPPORTED: 'Supported by a project or experience',
  ASSESSMENT_VALIDATED: 'Assessment-validated',
  MENTIONED: 'Mentioned',
  NEEDS_MORE_EVIDENCE: 'Needs more evidence',
};

const skillEvidenceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    canonicalSkill: { type: String, required: true, trim: true },
    rawSkillName: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['Technical', 'Framework / Tool', 'Soft Skill', 'Domain', 'Other'],
      default: 'Technical',
    },
    evidenceType: { type: String, enum: EVIDENCE_TYPES, required: true },
    // 'system' records are rebuilt from the profile; 'user' records are only changed by the user.
    origin: { type: String, enum: ['system', 'user'], default: 'system' },
    // Stable id of what the evidence came from (e.g. "project:careerpulse"), so a rebuild
    // updates the same record instead of creating a new one.
    sourceKey: { type: String, required: true },
    sourceIdentifier: { type: String, default: '', trim: true },
    sourceTitle: { type: String, required: true, trim: true },
    supportingContext: { type: String, default: '', trim: true },
    dateObserved: { type: Date, default: Date.now },
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'system_derived' },
    isConfirmed: { type: Boolean, default: false },
    // 'rejected' means the user said this evidence is wrong. It's kept (so a rebuild doesn't
    // bring it back) but ignored when working out the skill's level.
    status: { type: String, enum: ['active', 'rejected'], default: 'active' },
    confidence: { type: Number, default: 0.9, min: 0, max: 1 },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

skillEvidenceSchema.index({ userId: 1, canonicalSkill: 1, evidenceType: 1, sourceKey: 1 }, { unique: true });
skillEvidenceSchema.index({ userId: 1, origin: 1 });

const emptyBreakdown = () => ({ projects: 0, experience: 0, resume: 0, userConfirmed: 0, assessments: 0, rejected: 0 });

/** Works out a skill's evidence level from its records, with a plain-language reason. */
export function determineSkillEvidenceLevel(evidenceList = []) {
  const sourcesBreakdown = emptyBreakdown();
  for (const item of evidenceList) {
    if (item.status === 'rejected') {
      sourcesBreakdown.rejected++;
      continue;
    }
    if (item.evidenceType === 'assessment') sourcesBreakdown.assessments++;
    else if (item.evidenceType === 'work_experience') sourcesBreakdown.experience++;
    else if (item.evidenceType === 'project') sourcesBreakdown.projects++;
    else if (item.evidenceType === 'user_declaration' && item.isConfirmed) sourcesBreakdown.userConfirmed++;
    else if (item.evidenceType === 'resume_claim') sourcesBreakdown.resume++;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const b = sourcesBreakdown;
  let level;
  let summary;

  if (b.assessments) {
    level = EVIDENCE_LEVELS.ASSESSMENT_VALIDATED;
    summary = `Validated by ${plural(b.assessments, 'assessment')} taken in CareerPulse.`;
  } else if (b.projects || b.experience) {
    level = EVIDENCE_LEVELS.SUPPORTED;
    const parts = [];
    if (b.experience) parts.push(plural(b.experience, 'role'));
    if (b.projects) parts.push(plural(b.projects, 'project'));
    summary = `Described in ${parts.join(' and ')} on your profile${b.userConfirmed ? ', and confirmed by you' : ''}.`;
  } else if (b.userConfirmed) {
    level = EVIDENCE_LEVELS.USER_CONFIRMED;
    summary = 'You confirmed this skill, but no project or role on your profile describes using it yet.';
  } else if (b.resume) {
    level = EVIDENCE_LEVELS.MENTIONED;
    summary = 'Listed on your resume. Confirm it, or add a project or role that shows you using it.';
  } else {
    level = EVIDENCE_LEVELS.NEEDS_MORE_EVIDENCE;
    summary = b.rejected
      ? 'You marked the existing evidence as wrong, so there is nothing left to support this skill.'
      : 'There is no evidence for this skill yet.';
  }

  return {
    level,
    summary,
    evidenceCount: evidenceList.length - b.rejected,
    sourcesBreakdown,
  };
}

export default mongoose.model('SkillEvidence', skillEvidenceSchema);
