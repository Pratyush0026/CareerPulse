// Turns job emails into structured updates (company, role, stage, ...) with Gemini.
// Built around the free tier: requests are spaced out, batched, retried and moved to a
// fallback model when one runs out of quota.
import { GoogleGenAI } from '@google/genai';
import config from '../config/index.js';

const VALID_STAGES = ['Applied', 'Assessment', 'Interview', 'Offer', 'Rejected'];
const BODY_CHAR_LIMIT = 1500;

let client = null;
function getClient() {
  if (!config.gemini.apiKey) {
    throw new Error('GEMINI_API_KEY is missing. Add it to the .env file in the project root.');
  }
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Keeps at least GEMINI_DELAY_MS between requests.
let lastCallAt = 0;
async function throttle() {
  const wait = lastCallAt + config.gemini.delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

const SYSTEM_INSTRUCTION = `You are an assistant that reads emails for a job seeker in India and detects updates about job applications THEY submitted.

Return ONLY a JSON object with exactly these keys:
{
  "is_job_related": boolean,
  "company": string or null,          // hiring company (not the job portal), e.g. "Infosys", not "Naukri"
  "role": string or null,             // job title if mentioned
  "stage": "Applied" | "Assessment" | "Interview" | "Offer" | "Rejected" | null,
  "event_date": "YYYY-MM-DD" or null, // interview/assessment date or deadline, if mentioned
  "link": string or null,             // assessment or interview/meeting link, if present
  "summary": string,                  // one short sentence describing the update
  "confidence": number                // 0.0 to 1.0
}

Rules:
- is_job_related is true ONLY for real updates about an application the recipient made: application received/confirmation, assessment/test invites, interview scheduling, offers, rejections.
- Job alerts, "jobs you may like", "recommended jobs", newsletters, recruiter marketing, course ads, and portal promotions are NOT job related -> is_job_related: false, stage: null.
- Stage mapping: application confirmation -> "Applied"; online test / coding challenge / take-home -> "Assessment"; interview / HR round / technical round -> "Interview"; offer letter / selection -> "Offer"; "regret to inform" / not moving forward -> "Rejected".
- Resolve relative dates ("tomorrow", "this Friday") using the email date. Use null if no date is given.
- If the email came via a portal (Naukri, LinkedIn, foundit), company is the employer named in the email, not the portal.
- When is_job_related is false, set company, role, stage, event_date and link to null.`;

const FEW_SHOTS = [
  {
    email: `From: Naukri <noreply@naukri.com>
Subject: Your application for Data Analyst at Wipro was sent
Date: 2025-10-01
Body: Hi Ananya, your application for Data Analyst at Wipro Limited, Bengaluru has been successfully submitted. The recruiter will contact you if shortlisted.`,
    output: {
      is_job_related: true, company: 'Wipro', role: 'Data Analyst', stage: 'Applied', event_date: null, link: null,
      summary: 'Application for Data Analyst at Wipro submitted via Naukri.', confidence: 0.95,
    },
  },
  {
    email: `From: HackerRank <noreply@hackerrank.com>
Subject: Accenture invites you to an online assessment
Date: 2025-10-03
Body: Hello, Accenture has invited you to take the Associate Software Engineer assessment. Complete it before 2025-10-06 using this link: https://www.hackerrank.com/tests/abc123`,
    output: {
      is_job_related: true, company: 'Accenture', role: 'Associate Software Engineer', stage: 'Assessment', event_date: '2025-10-06',
      link: 'https://www.hackerrank.com/tests/abc123', summary: 'Online assessment invite from Accenture due 6 Oct.', confidence: 0.95,
    },
  },
  {
    email: `From: Priya (Talent Acquisition) <priya@swiggy.in>
Subject: Interview scheduled - Product Analyst
Date: 2025-10-07
Body: Hi, you have been shortlisted for the Product Analyst role. Your technical interview is scheduled tomorrow at 11 AM on Google Meet: https://meet.google.com/xyz-abcd-efg`,
    output: {
      is_job_related: true, company: 'Swiggy', role: 'Product Analyst', stage: 'Interview', event_date: '2025-10-08',
      link: 'https://meet.google.com/xyz-abcd-efg', summary: 'Technical interview with Swiggy scheduled for 8 Oct.', confidence: 0.97,
    },
  },
  {
    email: `From: careers@zeptonow.com
Subject: Update on your application
Date: 2025-10-09
Body: Thank you for your interest in the Operations Associate role at Zepto. After careful consideration, we regret to inform you that we will not be moving forward with your application.`,
    output: {
      is_job_related: true, company: 'Zepto', role: 'Operations Associate', stage: 'Rejected', event_date: null, link: null,
      summary: 'Zepto rejected the Operations Associate application.', confidence: 0.96,
    },
  },
  {
    email: `From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>
Subject: 25 new jobs for "Business Analyst" in Bengaluru
Date: 2025-10-10
Body: Jobs you may be interested in: Business Analyst at Flipkart, Senior Analyst at Amazon, Analyst at Deloitte. Apply now with Easy Apply.`,
    output: {
      is_job_related: false, company: null, role: null, stage: null, event_date: null, link: null,
      summary: 'LinkedIn job alert newsletter, not an application update.', confidence: 0.98,
    },
  },
];

const EXAMPLES = FEW_SHOTS.map(
  (ex, i) => `Example ${i + 1}\nEMAIL:\n${ex.email}\nJSON:\n${JSON.stringify(ex.output)}`
).join('\n\n');

// Local date, not UTC: an email at 00:43 IST on 26 Sept is still 25 Sept in UTC, which would
// shift "tomorrow" by a day. The en-CA locale formats as YYYY-MM-DD.
const localYmd = (date) => (date ? new Date(date).toLocaleDateString('en-CA') : 'unknown');

function formatEmail(email) {
  const body = (email.body || '').replace(/\s+/g, ' ').trim().slice(0, BODY_CHAR_LIMIT);
  return `From: ${email.sender || ''}
Subject: ${email.subject || ''}
Date: ${localYmd(email.date)}
Body: ${body}`;
}

function buildPrompt(email) {
  return `${EXAMPLES}

Now classify this email.
EMAIL:
${formatEmail(email)}
JSON:`;
}

// The free tier counts requests, not emails, so several emails go in one prompt.
function buildBatchPrompt(emails) {
  const blocks = emails.map((email, i) => `=== EMAIL E${i + 1} ===\n${formatEmail(email)}`).join('\n\n');
  return `${EXAMPLES}

Now classify each of the ${emails.length} emails below independently, using the same rules and fields.
Return ONLY a JSON object of the form {"results": [ {"id": "E1", ...fields}, {"id": "E2", ...fields}, ... ]}
with exactly one entry per email, in the same order.

${blocks}

JSON:`;
}

function normalizeResult(raw) {
  const str = (v) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null);

  const stageRaw = str(raw.stage);
  const stage = stageRaw
    ? VALID_STAGES.find((s) => s.toLowerCase() === stageRaw.toLowerCase()) || null
    : null;

  const eventDate = str(raw.event_date);
  const link = str(raw.link);

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.min(1, Math.max(0, confidence));

  const isJobRelated = raw.is_job_related === true || raw.is_job_related === 'true';

  return {
    is_job_related: isJobRelated,
    company: isJobRelated ? str(raw.company) : null,
    role: isJobRelated ? str(raw.role) : null,
    stage: isJobRelated ? stage : null,
    event_date: isRealDate(eventDate) ? eventDate : null,
    link: link && /^https?:\/\//i.test(link) ? link : null,
    summary: str(raw.summary) || '',
    confidence,
  };
}

// Rejects dates that look right but don't exist, like 2026-02-30.
function isRealDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00`);
  return !Number.isNaN(d.getTime()) && d.toLocaleDateString('en-CA') === ymd;
}

// Models occasionally wrap the JSON in prose or a code fence.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text && text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('No JSON object found in model response');
  }
}

// Errors that would fail for every email, so the sync stops instead of retrying.
export class FatalClassifierError extends Error {}
export class QuotaExhaustedError extends FatalClassifierError {}

function isFatal(err) {
  const status = err?.status ?? err?.code;
  const msg = String(err?.message || '');
  return status === 401 || status === 403 || status === 404 ||
    /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|NOT_FOUND|is not found|no longer available/i.test(msg);
}

const isBadKey = (err) => /API_KEY_INVALID|API key not valid/i.test(String(err?.message || ''));

// A 429 that's really "come back tomorrow" rather than "slow down".
function isDailyQuotaExhausted(err) {
  const status = err?.status ?? err?.code;
  const msg = String(err?.message || '');
  if (status !== 429 && !/RESOURCE_EXHAUSTED/.test(msg)) return false;
  return /PerDay/i.test(msg) || suggestedRetryMs(err) > 5 * 60 * 1000;
}

const isOverloaded = (err) =>
  (err?.status ?? err?.code) === 503 || /UNAVAILABLE|overloaded|high demand/i.test(String(err?.message || ''));

// GEMINI_MODEL first, then the fallbacks. A model is parked until its quota resets.
const MODELS = [...new Set([config.gemini.model, ...config.gemini.fallbackModels])];
const parkedUntil = new Map();

const activeModel = () => MODELS.find((m) => !(parkedUntil.get(m) > Date.now()));

function park(model, ms, reason) {
  parkedUntil.set(model, Date.now() + ms);
  const next = activeModel();
  console.warn(`[classifier] ${model}: ${reason}.${next ? ` Switching to ${next}.` : ''}`);
}

const formatWait = (ms) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
};

function isRetryable(err) {
  const status = err?.status ?? err?.code;
  const msg = String(err?.message || '');
  return (
    status === 429 || status === 500 || status === 503 ||
    /RESOURCE_EXHAUSTED|quota|rate limit|UNAVAILABLE|overloaded|429|503/i.test(msg)
  );
}

function suggestedRetryMs(err) {
  const m = String(err?.message || '').match(/retry(?:Delay)?["\s:]*"?(\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : 0;
}

/**
 * Sends a prompt and returns the parsed JSON, or null if this request failed.
 * Throws FatalClassifierError when no configured model can be used at all.
 */
async function generateJson(prompt, label) {
  const ai = getClient();
  const { maxRetries } = config.gemini;
  const MAX_WAIT_MS = 60 * 1000;
  let attempt = 0;

  while (true) {
    const model = activeModel();
    if (!model) {
      const soonest = Math.min(...MODELS.map((m) => parkedUntil.get(m)));
      throw new QuotaExhaustedError(
        `Gemini free-tier quota is used up for all configured models (${MODELS.join(', ')}). ` +
          `Try again in about ${formatWait(soonest - Date.now())}, or add more models to GEMINI_FALLBACK_MODELS. ` +
          'Everything processed so far has been saved.'
      );
    }

    await throttle();
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });
      return parseJson(response.text);
    } catch (err) {
      if (err instanceof SyntaxError || /No JSON object/.test(err.message)) {
        console.warn(`[classifier] Could not parse JSON for ${label} – skipping.`);
        return null;
      }

      if (isDailyQuotaExhausted(err)) {
        park(model, suggestedRetryMs(err) || 60 * 60 * 1000, 'daily free-tier quota used up');
        continue;
      }

      if (isFatal(err)) {
        if (isBadKey(err)) {
          throw new FatalClassifierError(`Gemini rejected the API key – check GEMINI_API_KEY in .env: ${err.message}`);
        }
        // Unknown or retired model: try the next one before giving up.
        park(model, Infinity, 'model not available for this key');
        if (activeModel()) continue;
        throw new FatalClassifierError(
          `No usable Gemini model (tried ${MODELS.join(', ')}). Check GEMINI_MODEL in .env: ${err.message}`
        );
      }

      // Rest an overloaded model for a few minutes when there's another one to use.
      if (isOverloaded(err) && attempt >= 1 && MODELS.some((m) => m !== model && !(parkedUntil.get(m) > Date.now()))) {
        park(model, 5 * 60 * 1000, 'overloaded (503)');
        continue;
      }

      if (isRetryable(err) && attempt < maxRetries) {
        const backoff = Math.min(Math.max(suggestedRetryMs(err), 5000 * 2 ** attempt), MAX_WAIT_MS);
        attempt++;
        console.warn(`[classifier] ${model} rate limited / unavailable (attempt ${attempt}). Retrying in ${Math.round(backoff / 1000)}s...`);
        await sleep(backoff);
        continue;
      }

      console.error(`[classifier] Gemini error for ${label}: ${err.message.slice(0, 300)}`);
      return null;
    }
  }
}

export async function classifyEmail(email) {
  const json = await generateJson(buildPrompt(email), `"${email.subject}"`);
  return json ? normalizeResult(json) : null;
}

/** One result per email, in order. null means that email failed and is retried next sync. */
export async function classifyBatch(emails) {
  if (emails.length === 1) return [await classifyEmail(emails[0])];

  const json = await generateJson(buildBatchPrompt(emails), `a batch of ${emails.length} emails`);
  if (json === null) return emails.map(() => null);
  const list = Array.isArray(json) ? json : json?.results;

  if (!Array.isArray(list)) {
    // The model ignored the batch format, so ask about each email separately.
    console.warn('[classifier] Batch response had no "results" array – classifying one by one.');
    const results = [];
    for (const email of emails) results.push(await classifyEmail(email));
    return results;
  }

  return emails.map((_, i) => {
    const item = list.find((r) => String(r?.id || '').toUpperCase() === `E${i + 1}`) ?? (list.length === emails.length ? list[i] : null);
    return item ? normalizeResult(item) : null;
  });
}
