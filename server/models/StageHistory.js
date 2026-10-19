import mongoose from 'mongoose';

const stageHistorySchema = new mongoose.Schema({
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true },
  fromStage: { type: String, default: null }, // null for a new card
  toStage: { type: String, required: true },
  changedBy: { type: String, enum: ['ai', 'manual'], required: true },
  changedAt: { type: Date, default: Date.now },
});

stageHistorySchema.index({ applicationId: 1, changedAt: 1 });

export default mongoose.model('StageHistory', stageHistorySchema);
