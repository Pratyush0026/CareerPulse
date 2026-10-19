// A small job-search experiment the user runs on their own applications. The numbers come
// from the board; when the experiment ends they're frozen so later edits can't rewrite them.
import mongoose from 'mongoose';

export const EXPERIMENT_TEMPLATES = ['tailored_resumes', 'practice_topic', 'referral_vs_portal', 'skill_update', 'custom'];
export const EXPERIMENT_METRICS = ['response_rate', 'interview_rate'];
export const EXPERIMENT_COMPARISONS = ['before_after', 'platforms'];

const groupSchema = new mongoose.Schema(
  {
    label: String,
    from: Date,
    to: Date,
    applications: Number,
    hits: Number,
    rate: Number,
  },
  { _id: false }
);

const experimentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    template: { type: String, enum: EXPERIMENT_TEMPLATES, default: 'custom' },
    hypothesis: { type: String, required: true, trim: true, maxlength: 300 },
    action: { type: String, required: true, trim: true, maxlength: 500 },
    metric: { type: String, enum: EXPERIMENT_METRICS, required: true },
    comparison: { type: String, enum: EXPERIMENT_COMPARISONS, required: true },
    // For "platforms": the two platforms being compared, e.g. referral vs Naukri.
    platforms: { type: [String], default: [] },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ['active', 'finished', 'abandoned'], default: 'active' },
    observedOutcome: { type: String, default: '', trim: true, maxlength: 1000 },
    // Filled in once, when the experiment ends.
    result: {
      groups: { type: [groupSchema], default: undefined },
      conclusion: String,
      limitations: { type: [String], default: undefined },
      computedAt: Date,
    },
  },
  { timestamps: true }
);

experimentSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Experiment', experimentSchema);
