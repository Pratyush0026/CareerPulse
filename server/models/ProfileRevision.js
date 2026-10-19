// A copy of the Career Profile as it was after each save. Never edited afterwards, so the
// career timeline can show what really changed and when.
import mongoose from 'mongoose';

export const REVISION_REASONS = ['created', 'resume_review', 'edit', 'baseline'];

const profileRevisionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, required: true },
    reason: { type: String, enum: REVISION_REASONS, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false }
);

// One revision per profile version, so a retried save can't record the same version twice.
profileRevisionSchema.index({ userId: 1, version: -1 }, { unique: true });

const OMIT = ['_id', '__v', 'userId', 'version', 'createdAt', 'updatedAt', 'completenessScore', 'completenessBreakdown'];

export function snapshotOf(profile) {
  const data = typeof profile.toObject === 'function' ? profile.toObject() : { ...profile };
  for (const key of OMIT) delete data[key];
  return data;
}

/** Records the profile as just saved. Safe to call twice for the same version. */
export function recordRevision(profile, reason) {
  return ProfileRevision.updateOne(
    { userId: profile.userId, version: profile.version },
    { $setOnInsert: { reason, snapshot: snapshotOf(profile) } },
    { upsert: true }
  );
}

const ProfileRevision = mongoose.model('ProfileRevision', profileRevisionSchema);
export default ProfileRevision;
