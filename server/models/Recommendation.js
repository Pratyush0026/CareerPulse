// A suggested next step for the user. Recommendations are worked out from stored data and
// kept per user under a stable key, so the user's choice (accepted, dismissed...) survives
// every recalculation and a dismissed suggestion never comes back.
import mongoose from 'mongoose';

export const RECOMMENDATION_KINDS = ['show_evidence', 'close_gap', 'prepare', 'practice', 'set_goal', 'add_jobs'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const RECOMMENDATION_STATUSES = ['suggested', 'accepted', 'snoozed', 'dismissed', 'completed', 'incorrect', 'outdated'];

// The user has made up their mind about these, so they're never changed again.
export const FINAL_STATUSES = ['dismissed', 'completed', 'incorrect'];

const recommendationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    kind: { type: String, enum: RECOMMENDATION_KINDS, required: true },
    title: { type: String, required: true },
    why: { type: String, required: true },
    evidence: { type: [String], default: [] },
    uncertainty: { type: String, default: '' },
    completionCondition: { type: String, required: true },
    effort: { type: String, enum: ['small', 'medium', 'large'], required: true },
    priority: { type: String, enum: PRIORITIES, required: true },
    // Set by the user. Kept apart from the calculated priority so a recalculation never overrides it.
    userPriority: { type: String, enum: [...PRIORITIES, null], default: null },
    score: { type: Number, default: 0 },
    skill: { type: String, default: null },
    targetRole: { type: String, default: null },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', default: null },

    status: { type: String, enum: RECOMMENDATION_STATUSES, default: 'suggested' },
    statusChangedAt: { type: Date, default: null },
    snoozedUntil: { type: Date, default: null },
    // An accepted step whose reason has since gone away (the evidence now exists, the interview passed).
    reasonResolved: { type: Boolean, default: false },
    userNote: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

recommendationSchema.index({ userId: 1, key: 1 }, { unique: true });
recommendationSchema.index({ userId: 1, status: 1 });

export default mongoose.model('Recommendation', recommendationSchema);
