// Turns job emails into structured updates (company, role, stage, ...) with Gemini.
// Requests go through the shared Gemini client (spacing, retries, fallback models).
import { FatalAiError, QuotaExhaustedError, generateJson } from './gemini.js';

export { FatalAiError as FatalClassifierError, QuotaExhaustedError };

const VALID_STAGES = ['Applied', 'Assessment', 'Interview', 'Offer', 'Rejected'];
const BODY_CHAR_LIMIT = 1500;

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

export async function classifyEmail(email) {
  const json = await generateJson({ feature: 'email', prompt: buildPrompt(email), systemInstruction: SYSTEM_INSTRUCTION, label: 'one email' });
  return json ? normalizeResult(json) : null;
}

/** One result per email, in order. null means that email failed and is retried next sync. */
export async function classifyBatch(emails) {
  if (emails.length === 1) return [await classifyEmail(emails[0])];

  const json = await generateJson({
    feature: 'email',
    prompt: buildBatchPrompt(emails),
    systemInstruction: SYSTEM_INSTRUCTION,
    label: `a batch of ${emails.length} emails`,
  });
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
