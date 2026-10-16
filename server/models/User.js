// Signing in with Google creates the account, so the Gmail address is the identity.
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    lastLoginAt: { type: Date, default: Date.now },
    lastSyncAt: { type: Date, default: null },
    // Start time of the last sync that left nothing behind. The next sync only needs to
    // look at mail newer than this; null means the full window has to be searched again.
    lastCompleteSyncAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
