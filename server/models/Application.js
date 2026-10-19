import mongoose from 'mongoose';

export const STAGES = ['Applied', 'Assessment', 'Interview', 'Offer', 'Rejected'];
export const PLATFORMS = ['Naukri', 'LinkedIn', 'foundit', 'referral', 'company site', 'unknown'];

const applicationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    company: { type: String, required: true, trim: true },
    role: { type: String, trim: true, default: null },
    stage: { type: String, enum: STAGES, default: 'Applied' },
    source: { type: String, enum: ['gmail', 'manual'], default: 'manual' },
    platform: { type: String, enum: PLATFORMS, default: 'unknown' },
    eventDate: { type: Date, default: null },
    link: { type: String, default: null },
    lastSummary: { type: String, default: null },
    // Newest email applied, or the last manual edit. Older emails may only fill gaps.
    lastEmailAt: { type: Date, default: null },
    // When the first email about this application arrived. Cards are created at sync time, so
    // this is the closer date for "when did I apply" (null for manual cards: use createdAt).
    firstEmailAt: { type: Date, default: null },
    // Lets the card open the email in Gmail. Only the ID is kept, never the content.
    lastMessageId: { type: String, default: null },
    // Fields that were guessed rather than read from an email ('platform', 'stage').
    inferredFields: { type: [String], default: [] },
    // When a sync last created or changed this card; drives the "New" badge.
    aiUpdatedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    // A sync saving a card you just edited fails instead of overwriting your change.
    optimisticConcurrency: true,
  }
);

export default mongoose.model('Application', applicationSchema);
