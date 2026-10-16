// Reads .env from the project root, so the server works whether it's started from / or /server.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const port = num(process.env.PORT, 5000);

const config = {
  port,
  serverUrl: process.env.SERVER_URL || `http://localhost:${port}`,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/careerpulse',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    // Free-tier quota is per model per day, so these take over when the main model runs out.
    fallbackModels: (process.env.GEMINI_FALLBACK_MODELS || '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    delayMs: num(process.env.GEMINI_DELAY_MS, 4000),
    maxRetries: num(process.env.GEMINI_MAX_RETRIES, 4),
  },

  sync: {
    days: num(process.env.SYNC_DAYS, 30),
    maxEmails: num(process.env.SYNC_MAX_EMAILS, 300),
    batchSize: Math.max(1, num(process.env.GEMINI_BATCH_SIZE, 10)), // emails per Gemini request
    minConfidence: num(process.env.MIN_CONFIDENCE, 0.6),
  },

  session: {
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    generated: !process.env.SESSION_SECRET,
    cookieName: 'careerpulse.sid',
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  },

  google: {
    credentialsPath: path.resolve(ROOT_DIR, process.env.GOOGLE_CREDENTIALS_PATH || 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
};

// Desktop OAuth clients accept any localhost redirect; Web clients need this exact URI registered.
config.google.redirectUri = `${config.serverUrl}/api/auth/google/callback`;

export default config;
