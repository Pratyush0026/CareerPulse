import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import config from './config/index.js';
import requireLogin from './middleware/requireLogin.js';
import authRoutes from './routes/auth.js';
import applicationRoutes from './routes/applications.js';
import syncRoutes from './routes/sync.js';
import activityRoutes from './routes/activity.js';
import { migrateToMultiUser } from './scripts/migrateToMultiUser.js';

const app = express();

app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json());

// Sessions live in MongoDB so a server restart doesn't sign everyone out.
app.use(
  session({
    name: config.session.cookieName,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: config.mongoUri, collectionName: 'sessions', ttl: config.session.maxAgeMs / 1000 }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax', // still sent on the redirect back from Google
      secure: false, // plain http on localhost
      maxAge: config.session.maxAgeMs,
    },
  })
);

app.get('/api/health', (req, res) =>
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', model: config.gemini.model })
);
app.use('/api/auth', authRoutes);
app.use('/api/applications', requireLogin, applicationRoutes);
app.use('/api/sync', requireLogin, syncRoutes);
app.use('/api', requireLogin, activityRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error(`❌ Could not connect to MongoDB (${config.mongoUri.replace(/\/\/.*@/, '//***@')}):`, err.message);
    console.error('   Check MONGODB_URI in .env and that MongoDB is running.');
    if (/SSL alert number 80|tlsv1 alert internal error/i.test(err.message)) {
      // This is what Atlas returns when the current IP isn't on its allowlist.
      console.error('   Atlas tip: add your current IP in Atlas → Security → Network Access → "Add Current IP Address".');
    }
    process.exit(1);
  }

  await migrateToMultiUser();

  app.listen(config.port, () => {
    console.log(`🚀 CareerPulse API running at ${config.serverUrl}`);
    console.log(`   Gemini model: ${config.gemini.model}${config.gemini.apiKey ? '' : '  (⚠ GEMINI_API_KEY missing)'}`);
    console.log(`   OAuth redirect URI: ${config.google.redirectUri}`);
    if (config.session.generated) console.warn('   ⚠ SESSION_SECRET missing in .env – using a temporary one (you will be signed out on restart).');
  });
}

start();
