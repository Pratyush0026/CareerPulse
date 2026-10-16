import mongoose from 'mongoose';

const googleTokenSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // the user's id as a string
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, default: null },
    accessToken: { type: String, default: null },
    refreshToken: { type: String, default: null },
    scope: { type: String, default: null },
    tokenType: { type: String, default: null },
    expiryDate: { type: Number, default: null }, // ms since epoch
    needsReconnect: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('GoogleToken', googleTokenSchema);
