import mongoose from 'mongoose';

export const FIT_CHANGE_REASONS = ['analysed', 'profile_change', 'evidence_change', 'correction', 'baseline', 'scoring_update'];

const requirementMatchSchema = new mongoose.Schema(
  {
    requirement: { type: String, required: true, trim: true },
    requirementType: {
      type: String,
      enum: ['skill', 'experience', 'education', 'tool', 'domain', 'constraint', 'other'],
      default: 'skill',
    },
    importance: {
      type: String,
      enum: ['required', 'preferred'],
      default: 'required',
    },
    canonicalSkill: { type: String, default: null },
    matchStatus: {
      type: String,
      enum: [
        'Strong evidence of match',
        'Partial evidence',
        'No evidence yet',
        'Potential mismatch',
        'Requires clarification',
      ],
      default: 'No evidence yet',
    },
    evidenceQuality: {
      type: String,
      enum: ['High', 'Medium', 'None', 'Mismatch', 'Uncertain'],
      default: 'None',
    },
    candidateEvidence: { type: [String], default: [] },
    missingOrUncertain: { type: String, default: '' },
    recommendedNextStep: { type: String, default: '' },
    userOverride: {
      isOverridden: { type: Boolean, default: false },
      userStatus: {
        type: String,
        enum: ['Strong evidence of match', 'Partial evidence', 'No evidence yet', 'Potential mismatch', 'Requires clarification', null],
        default: null,
      },
      userNote: { type: String, default: '', maxlength: 500 },
    },
  },
  { _id: true }
);

const jobOpportunitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', default: null, index: true },
    company: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    rawJobDescription: { type: String, required: true, maxlength: 20000 },
    // Same description (after whitespace cleanup) → same hash, so it's only sent to the AI once.
    descriptionHash: { type: String, default: null },
    promptVersion: { type: String, default: null },
    source: {
      type: String,
      enum: ['manual_paste', 'linked_application', 'other'],
      default: 'manual_paste',
    },

    // Extracted structured job requirements
    extractedRequirements: {
      seniority: { type: String, default: 'Not specified' },
      experienceYears: {
        min: { type: Number, default: null },
        max: { type: Number, default: null },
        text: { type: String, default: '' },
      },
      education: {
        degree: { type: String, default: '' },
        field: { type: String, default: '' },
        required: { type: Boolean, default: false },
        text: { type: String, default: '' },
      },
      responsibilities: { type: [String], default: [] },
      requiredSkills: [
        {
          name: { type: String, required: true },
          canonicalSkill: { type: String, default: '' },
          category: { type: String, default: 'Technical' },
          description: { type: String, default: '' },
        },
      ],
      preferredSkills: [
        {
          name: { type: String, required: true },
          canonicalSkill: { type: String, default: '' },
          category: { type: String, default: 'Technical' },
          description: { type: String, default: '' },
        },
      ],
      toolsAndFrameworks: { type: [String], default: [] },
      domainKnowledge: { type: [String], default: [] },
      explicitConstraints: { type: [String], default: [] },
      ambiguousOrUnknown: { type: [String], default: [] },
    },

    // Explainable role-fit analysis
    fitAnalysis: {
      overallFitScore: { type: Number, min: 0, max: 100, default: 0 },
      fitTier: {
        type: String,
        enum: [
          'Strong Fit',
          'Moderate Fit',
          'Potential Match with Gaps',
          'Significant Mismatch',
          'Limited Evidence',
          'Insufficient Data',
        ],
        default: 'Insufficient Data',
      },
      formulaExplanation: { type: String, default: '' },
      scoringBreakdown: {
        // null when the job lists no requirements of that kind.
        requiredCoveragePercent: { type: Number, default: null },
        preferredCoveragePercent: { type: Number, default: null },
        experienceMatch: { type: String, default: 'Not evaluated' },
        totalRequirementsCount: { type: Number, default: 0 },
        matchedRequirementsCount: { type: Number, default: 0 },
      },
      requirementMatches: [requirementMatchSchema],
      tailoredRecommendations: [
        {
          section: { type: String, default: '' },
          recommendationType: {
            type: String,
            enum: ['highlight_project', 'wording_improvement', 'skill_emphasis'],
            default: 'highlight_project',
          },
          originalSnippet: { type: String, default: '' },
          suggestedEmphasis: { type: String, default: '' },
          rationale: { type: String, default: '' },
        },
      ],
      strengths: { type: [String], default: [] },
      missingEvidence: { type: [String], default: [] },
      confirmedGaps: { type: [String], default: [] },
    },

    // Every change of score or tier, oldest first, so a later recalculation never erases the past.
    fitHistory: [
      {
        _id: false,
        score: { type: Number, required: true },
        tier: { type: String, required: true },
        reason: { type: String, enum: FIT_CHANGE_REASONS, required: true },
        profileVersion: { type: Number, default: null },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

jobOpportunitySchema.index({ userId: 1, createdAt: -1 });

const FIT_HISTORY_LIMIT = 100;

/**
 * The $push that records a new fit, or null when score and tier are unchanged since the last entry.
 * Keeps the newest FIT_HISTORY_LIMIT entries.
 */
export function fitHistoryPush(history, fit, reason, profileVersion = null) {
  const last = history?.at(-1);
  if (last && last.score === fit.overallFitScore && last.tier === fit.fitTier) return null;
  const entry = { score: fit.overallFitScore, tier: fit.fitTier, reason, profileVersion, at: new Date() };
  return { fitHistory: { $each: [entry], $slice: -FIT_HISTORY_LIMIT } };
}
jobOpportunitySchema.index(
  { userId: 1, descriptionHash: 1 },
  { unique: true, partialFilterExpression: { descriptionHash: { $type: 'string' } } }
);

export default mongoose.model('JobOpportunity', jobOpportunitySchema);
