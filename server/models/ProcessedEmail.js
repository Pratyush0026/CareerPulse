// One row per Gmail message already handled, so nothing is classified twice.
// Only the message ID and the extracted result are stored, never email content.
import mongoose from 'mongoose';

const processedEmailSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messageId: { type: String, required: true },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', default: null },
  isJobRelated: { type: Boolean, default: false },
  stageDetected: { type: String, default: null },
  confidence: { type: Number, default: 0 },
  method: { type: String, enum: ['ai', 'rule'], default: 'ai' },
  skipReason: { type: String, default: null },
  processedAt: { type: Date, default: Date.now },
});

processedEmailSchema.index({ userId: 1, messageId: 1 }, { unique: true });
processedEmailSchema.index({ userId: 1, processedAt: -1 });

export default mongoose.model('ProcessedEmail', processedEmailSchema);
