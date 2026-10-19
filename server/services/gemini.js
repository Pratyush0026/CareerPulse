// Shared Gemini client. Every AI feature goes through here so they all respect the same
// request spacing, quota tracking and fallback models.
import { GoogleGenAI } from '@google/genai';
import config from '../config/index.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Errors that would fail for every request, so callers stop instead of retrying.
export class FatalAiError extends Error {}
export class QuotaExhaustedError extends FatalAiError {}

let client = null;
function getClient() {
  if (!config.gemini.apiKey) {
    throw new FatalAiError('GEMINI_API_KEY is missing. Add it to the .env file in the project root.');
  }
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

// Keeps at least GEMINI_DELAY_MS between requests across all features.
let lastCallAt = 0;
async function throttle() {
  const wait = lastCallAt + config.gemini.delayMs - Date.now();
  lastCallAt = Math.max(Date.now(), lastCallAt + config.gemini.delayMs);
  if (wait > 0) await sleep(wait);
}

// Models occasionally wrap the JSON in prose or a code fence.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text && text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new SyntaxError('No JSON object found in model response');
  }
}

function isFatal(err) {
  const status = err?.status ?? err?.code;
  const msg = String(err?.message || '');
  return status === 401 || status === 403 || status === 404 ||
    /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|NOT_FOUND|is not found|no longer available/i.test(msg);
}

const isBadKey = (err) => /API_KEY_INVALID|API key not valid/i.test(String(err?.message || ''));

function suggestedRetryMs(err) {
  const m = String(err?.message || '').match(/retry(?:Delay)?["\s:]*"?(\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : 0;
}

// A 429 that's really "come back tomorrow" rather than "slow down".
function isDailyQuotaExhausted(err) {
  const status = err?.status ?? err?.code;
  const msg = String(err?.message || '');
  if (status !== 429 && !/RESOURCE_EXHAUSTED/.test(msg)) return false;
  return /PerDay/i.test(msg) || suggestedRetryMs(err) > 5 * 60 * 1000;
}

const isOverloaded = (err) =>
  (err?.status ?? err?.code) === 503 || /UNAVAILABLE|overloaded|high demand/i.test(String(err?.message || ''));

function isRetryable(err) {
  const status = err?.status ?? err?.code;
  const msg = String(err?.message || '');
  return status === 429 || status === 500 || status === 503 ||
    /RESOURCE_EXHAUSTED|quota|rate limit|UNAVAILABLE|overloaded|429|503/i.test(msg);
}

// GEMINI_MODEL first, then the fallbacks. A model is parked until its quota resets.
const MODELS = [...new Set([config.gemini.model, ...config.gemini.fallbackModels])];
const parkedUntil = new Map();

const activeModel = () => MODELS.find((m) => !(parkedUntil.get(m) > Date.now()));

function park(model, ms, reason) {
  parkedUntil.set(model, Date.now() + ms);
  const next = activeModel();
  console.warn(`[gemini] ${model}: ${reason}.${next ? ` Switching to ${next}.` : ''}`);
}

const formatWait = (ms) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
};

// Request counts and timings per feature since the server started. Never includes content.
const usage = new Map();

function record(feature, ok, ms) {
  const stats = usage.get(feature) ?? { requests: 0, failed: 0, totalMs: 0 };
  stats.requests++;
  if (!ok) stats.failed++;
  stats.totalMs += ms;
  usage.set(feature, stats);
}

// Requests sent today, across all features. Resets at local midnight (and on restart).
const today = { date: new Date().toDateString(), requests: 0 };

function spendDailyBudget() {
  const date = new Date().toDateString();
  if (today.date !== date) Object.assign(today, { date, requests: 0 });
  if (today.requests >= config.gemini.dailyRequestLimit) {
    throw new QuotaExhaustedError(
      `The daily limit of ${config.gemini.dailyRequestLimit} AI requests is used up. It resets at midnight, ` +
        'or raise GEMINI_DAILY_REQUEST_LIMIT in .env.'
    );
  }
  today.requests++;
}

export const aiBudget = () => ({ requestsToday: today.requests, dailyLimit: config.gemini.dailyRequestLimit });

export function aiUsage() {
  return Object.fromEntries(
    [...usage].map(([feature, s]) => [feature, { requests: s.requests, failed: s.failed, avgMs: Math.round(s.totalMs / s.requests) }])
  );
}

/**
 * Sends a prompt and returns the parsed JSON, or null if the request failed.
 * Throws FatalAiError when no configured model can be used at all.
 * `label` only appears in logs, so it must never contain user content.
 */
export async function generateJson({ feature = 'other', ...options }) {
  const started = Date.now();
  try {
    const result = await requestJson(options);
    record(feature, result !== null, Date.now() - started);
    return result;
  } catch (err) {
    record(feature, false, Date.now() - started);
    throw err;
  }
}

async function requestJson({ prompt, systemInstruction, label, jsonRetries = 0 }) {
  const ai = getClient();
  const { maxRetries } = config.gemini;
  const MAX_WAIT_MS = 60 * 1000;
  let attempt = 0;
  let badJson = 0;

  while (true) {
    const model = activeModel();
    if (!model) {
      const soonest = Math.min(...MODELS.map((m) => parkedUntil.get(m)));
      throw new QuotaExhaustedError(
        `Gemini free-tier quota is used up for all configured models (${MODELS.join(', ')}). ` +
          `Try again in about ${formatWait(soonest - Date.now())}, or add more models to GEMINI_FALLBACK_MODELS.`
      );
    }

    spendDailyBudget();
    await throttle();
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.1 },
      });
      return parseJson(response.text);
    } catch (err) {
      if (err instanceof SyntaxError) {
        if (badJson++ < jsonRetries) continue;
        console.warn(`[gemini] Invalid JSON for ${label}.`);
        return null;
      }

      if (isDailyQuotaExhausted(err)) {
        park(model, suggestedRetryMs(err) || 60 * 60 * 1000, 'daily free-tier quota used up');
        continue;
      }

      if (isFatal(err)) {
        if (isBadKey(err)) {
          throw new FatalAiError(`Gemini rejected the API key – check GEMINI_API_KEY in .env: ${err.message}`);
        }
        park(model, Infinity, 'model not available for this key');
        if (activeModel()) continue;
        throw new FatalAiError(`No usable Gemini model (tried ${MODELS.join(', ')}). Check GEMINI_MODEL in .env.`);
      }

      // Rest an overloaded model for a few minutes when there's another one to use.
      if (isOverloaded(err) && attempt >= 1 && MODELS.some((m) => m !== model && !(parkedUntil.get(m) > Date.now()))) {
        park(model, 5 * 60 * 1000, 'overloaded (503)');
        continue;
      }

      if (isRetryable(err) && attempt < maxRetries) {
        const backoff = Math.min(Math.max(suggestedRetryMs(err), 5000 * 2 ** attempt), MAX_WAIT_MS);
        attempt++;
        console.warn(`[gemini] ${model} busy (attempt ${attempt}) for ${label}. Retrying in ${Math.round(backoff / 1000)}s.`);
        await sleep(backoff);
        continue;
      }

      console.error(`[gemini] Request failed for ${label}: ${String(err.message).slice(0, 200)}`);
      return null;
    }
  }
}
