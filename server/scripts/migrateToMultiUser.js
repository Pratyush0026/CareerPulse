// Moves data from the single-user version to accounts. Runs on every start and does
// nothing once everything has an owner.
import mongoose from 'mongoose';
import User from '../models/User.js';
import GoogleToken from '../models/GoogleToken.js';
import Application from '../models/Application.js';
import ProcessedEmail from '../models/ProcessedEmail.js';

export async function migrateToMultiUser() {
  // Message IDs used to be unique globally; now they're unique per user.
  const coll = mongoose.connection.collection('processedemails');
  const indexes = await coll.indexes().catch(() => []);
  if (indexes.some((i) => i.name === 'messageId_1')) {
    await coll.dropIndex('messageId_1');
    console.log('[migrate] Dropped old single-user index on processedemails.messageId');
  }

  // Ownerless data belongs to whoever was connected before accounts existed.
  const legacyToken = await GoogleToken.findOne({ key: 'default' });
  const orphanApps = await Application.countDocuments({ userId: { $exists: false } });
  const orphanEmails = await ProcessedEmail.countDocuments({ userId: { $exists: false } });

  if (legacyToken?.email) {
    const email = legacyToken.email.toLowerCase();
    const user = await User.findOneAndUpdate({ email }, { $setOnInsert: { email } }, { upsert: true, new: true });
    const apps = await Application.updateMany({ userId: { $exists: false } }, { $set: { userId: user._id } });
    const mails = await ProcessedEmail.updateMany({ userId: { $exists: false } }, { $set: { userId: user._id } });
    await GoogleToken.updateOne({ _id: legacyToken._id }, { $set: { key: String(user._id), userId: user._id, email } });
    console.log(`[migrate] Existing data now belongs to ${email}: ${apps.modifiedCount} applications, ${mails.modifiedCount} processed emails.`);
  } else if (orphanApps || orphanEmails) {
    console.warn(`[migrate] ${orphanApps} applications / ${orphanEmails} emails have no owner and no legacy Gmail token to match – left untouched.`);
  }

  await ProcessedEmail.syncIndexes();
}
