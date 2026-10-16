// Gmail access (read-only). Email bodies stay in memory just long enough to be classified.
import fs from 'node:fs';
import { google } from 'googleapis';
import config from '../config/index.js';
import GoogleToken from '../models/GoogleToken.js';
import { ALERT_ONLY_SENDERS } from './emailFilter.js';

export class ReconnectRequiredError extends Error {
  constructor(message = 'Gmail is not connected. Please connect (or reconnect) Gmail.') {
    super(message);
    this.code = 'RECONNECT_GMAIL';
  }
}

// Works with both "Desktop app" and "Web application" OAuth clients.
function loadClientSecrets() {
  const file = config.google.credentialsPath;
  if (!fs.existsSync(file)) {
    throw new Error(`Google OAuth file not found at ${file}. Download it from Google Cloud Console → Credentials.`);
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const secrets = json.installed || json.web;
  if (!secrets?.client_id || !secrets?.client_secret) {
    throw new Error('credentials.json is missing client_id / client_secret.');
  }
  return secrets;
}

export function createOAuthClient() {
  const { client_id, client_secret } = loadClientSecrets();
  return new google.auth.OAuth2(client_id, client_secret, config.google.redirectUri);
}

// "consent" guarantees a refresh token; "select_account" lets you switch Gmail accounts.
export function getAuthUrl(state) {
  return createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: config.google.scopes,
    state,
  });
}

const tokenKey = (userId) => String(userId);

// Google only sends the fields that changed, so the rest are left alone.
async function saveTokens(userId, tokens, extra = {}) {
  const update = { needsReconnect: false, userId, ...extra };
  if (tokens.access_token) update.accessToken = tokens.access_token;
  if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;
  if (tokens.scope) update.scope = tokens.scope;
  if (tokens.token_type) update.tokenType = tokens.token_type;
  if (tokens.expiry_date) update.expiryDate = tokens.expiry_date;
  await GoogleToken.findOneAndUpdate({ key: tokenKey(userId) }, update, { upsert: true, new: true });
}

/** Exchanges the OAuth code and works out which Gmail account signed in. */
export async function exchangeCode(code) {
  const oauth2 = createOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });
  return { email: profile.emailAddress.toLowerCase(), tokens };
}

export async function storeTokensForUser(userId, email, tokens) {
  await saveTokens(userId, tokens, { email });
}

/**
 * OAuth client with the user's saved tokens. Throws ReconnectRequiredError when the refresh
 * token is gone or rejected (apps in Testing mode lose them after 7 days).
 */
export async function getAuthorizedClient(userId) {
  const saved = await GoogleToken.findOne({ key: tokenKey(userId) });
  if (!saved?.refreshToken) throw new ReconnectRequiredError();
  if (saved.needsReconnect) throw new ReconnectRequiredError('Gmail access expired. Please reconnect Gmail.');

  const oauth2 = createOAuthClient();
  oauth2.setCredentials({
    access_token: saved.accessToken,
    refresh_token: saved.refreshToken,
    expiry_date: saved.expiryDate,
    token_type: saved.tokenType,
    scope: saved.scope,
  });

  oauth2.on('tokens', (tokens) => {
    saveTokens(userId, tokens).catch((e) => console.error('[gmail] Failed to save refreshed token:', e.message));
  });

  try {
    await oauth2.getAccessToken();
  } catch (err) {
    const reason = err?.response?.data?.error || err.message;
    console.warn('[gmail] Token refresh failed:', reason);
    // Only a rejected refresh token means "reconnect"; anything else (network etc.) bubbles up.
    const status = err?.response?.status;
    if (!/invalid_grant|unauthorized_client|invalid_client/i.test(String(reason)) && status !== 400 && status !== 401) {
      throw err;
    }
    await GoogleToken.updateOne({ key: tokenKey(userId) }, { needsReconnect: true });
    throw new ReconnectRequiredError('Gmail access expired or was revoked. Please reconnect Gmail.');
  }
  return oauth2;
}

export async function getConnectionStatus(userId) {
  const saved = await GoogleToken.findOne({ key: tokenKey(userId) });
  if (!saved?.refreshToken) return { connected: false, email: saved?.email || null, needsReconnect: Boolean(saved) };
  try {
    await getAuthorizedClient(userId);
    return { connected: true, email: saved.email, needsReconnect: false };
  } catch (err) {
    if (err instanceof ReconnectRequiredError) {
      return { connected: false, email: saved.email, needsReconnect: true, message: err.message };
    }
    throw err;
  }
}

export async function disconnect(userId) {
  await GoogleToken.deleteOne({ key: tokenKey(userId) });
}

// Plain "offer" is left out on purpose: it matches every bank and shopping promo.
const JOB_TERMS =
  '(interview OR assessment OR shortlisted OR "your application" OR "regret to inform" OR "thank you for applying" ' +
  'OR "next round" OR "test link" OR "offer letter" OR "job offer" OR "pleased to offer" OR "offer of employment")';

/**
 * Gmail search for job emails. With `since` only newer mail is searched (incremental sync),
 * otherwise the last `days` days.
 */
export function buildSearchQuery({ days, since }) {
  const range = since ? `after:${Math.floor(since.getTime() / 1000)}` : `newer_than:${days}d`;
  const excluded = ALERT_ONLY_SENDERS.map((sender) => `-from:${sender}`).join(' ');
  return `${range} -from:me ${excluded} ${JOB_TERMS}`;
}

const decodeBase64Url = (data) => Buffer.from(data || '', 'base64url').toString('utf8');

// Rough HTML to text. Good enough for the classifier.
function stripHtml(html) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)') // keep links for the AI
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function collectParts(part, found = { plain: [], html: [] }) {
  if (!part) return found;
  const mime = (part.mimeType || '').toLowerCase();
  const isAttachment = Boolean(part.filename);
  if (!isAttachment && part.body?.data) {
    if (mime === 'text/plain') found.plain.push(decodeBase64Url(part.body.data));
    else if (mime === 'text/html') found.html.push(decodeBase64Url(part.body.data));
  }
  (part.parts || []).forEach((child) => collectParts(child, found));
  return found;
}

// Prefers the text/plain part and falls back to stripped HTML.
export function extractBody(payload) {
  const { plain, html } = collectParts(payload);
  if (plain.join('').trim()) return plain.join('\n').trim();
  if (html.length) return stripHtml(html.join('\n'));
  return '';
}

const header = (headers, name) =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRateLimited = (err) => {
  const status = err?.code ?? err?.response?.status;
  return status === 429 || (status === 403 && /rate ?limit|quota exceeded/i.test(err?.message || ''));
};

/**
 * Downloads new job emails for a user.
 * Lists every match (IDs only, cheap), keeps the newest `max` unprocessed ones and
 * reports how many are left over. Emails come back oldest first.
 */
export async function fetchCandidateEmails({ userId, query, max, findProcessed, onProgress }) {
  const auth = await getAuthorizedClient(userId);
  const gmail = google.gmail({ version: 'v1', auth });

  const newIds = [];
  let remaining = 0;
  let pageToken;
  do {
    const { data } = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 500, pageToken });
    const ids = (data.messages || []).map((m) => m.id);
    const processed = await findProcessed(ids);
    for (const id of ids) {
      if (processed.has(id)) continue;
      if (newIds.length < max) newIds.push(id);
      else remaining++;
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Gmail caps API calls per user per minute, so download a few at a time and back off when told to.
  const download = async (id) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const { data: msg } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        const headers = msg.payload?.headers || [];
        return {
          messageId: msg.id,
          threadId: msg.threadId,
          sender: header(headers, 'From'),
          subject: header(headers, 'Subject'),
          date: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(header(headers, 'Date')),
          body: extractBody(msg.payload) || msg.snippet || '',
        };
      } catch (err) {
        if (isRateLimited(err) && attempt < 5) {
          await sleep(Math.min(2000 * 2 ** attempt, 30000));
          continue;
        }
        console.error(`[gmail] Could not fetch message ${id}:`, err.message);
        return null;
      }
    }
  };

  const emails = [];
  let failed = 0;
  for (let i = 0; i < newIds.length; i += 5) {
    const chunk = await Promise.all(newIds.slice(i, i + 5).map(download));
    for (const email of chunk) email ? emails.push(email) : failed++;
    onProgress?.(Math.min(i + 5, newIds.length), newIds.length);
  }
  if (failed) console.warn(`[gmail] ${failed} messages failed to download and will be retried next sync.`);

  return { emails: emails.sort((a, b) => a.date - b.date), remaining: remaining + failed };
}
