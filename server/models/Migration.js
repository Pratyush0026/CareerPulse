// One-off data changes that have already run, so they aren't repeated on every start.
import mongoose from 'mongoose';

const migrationSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  appliedAt: { type: Date, default: Date.now },
});

export default mongoose.model('Migration', migrationSchema);
