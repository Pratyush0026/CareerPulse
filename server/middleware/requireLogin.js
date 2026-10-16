// Routes behind this only ever query by req.userId, so users can't see each other's data.
import mongoose from 'mongoose';

export default function requireLogin(req, res, next) {
  const userId = req.session?.userId;
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ error: 'Please sign in with Google first.', code: 'NOT_LOGGED_IN' });
  }
  req.userId = new mongoose.Types.ObjectId(userId);
  next();
}
