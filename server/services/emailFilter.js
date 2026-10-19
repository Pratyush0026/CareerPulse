// Cheap checks that skip obvious job alerts before anything reaches Gemini.
// When in doubt an email goes to the AI, so these rules stay conservative.

// Senders that only ever send alerts or recommendations. They're excluded in the
// Gmail search itself, so their emails are never even downloaded.
export const ALERT_ONLY_SENDERS = [
  'jobalerts-noreply@linkedin.com',
  'jobs-listings@linkedin.com',
  'jobmessenger@monsterindia.com',
  'ambitionbox.com',
  'jobfeed.hirist.com',
  'hirist.tech',
  'alert@indeed.com',
];

// Mostly alerts, but they occasionally send a real update, so these are checked per email.
const MOSTLY_ALERT_SENDERS = [/@glassdoor\.com/, /@(mail\.)?ambitionbox\.com/, /@hirist\.com/];

const ALERT_SUBJECTS = [
  /\bjobs? (for you|you may (like|be interested)|matching|that match|picked|curated|recommended)/i,
  /\b\d+\+?\s*(new\s+)?(jobs|roles|openings|opportunities)\b/i,
  /\bis hiring\b/i,
  /\bhiring now\b/i,
  /\bjobs that you haven'?t applied/i,
  /\binterview:? (top )?questions/i,
  /\bapply (now|today)\b/i,
];

const REAL_UPDATE_HINTS =
  /(your application|application (for|to|was|has been|received|submitted|status)|job status|status update|thank you for applying|thank you for your interest|appreciate your interest|interview (is )?(scheduled|invite|invitation)|assessment|online test|shortlisted|offer letter|regret to inform|not (be )?(quite )?(suitable|moving forward)|other candidates|next round)/i;

/** Returns why an email can be skipped without AI, or null if the AI should read it. */
export function ruleBasedSkipReason({ sender = '', subject = '' }) {
  if (REAL_UPDATE_HINTS.test(subject)) return null;

  const from = sender.toLowerCase();
  if (ALERT_ONLY_SENDERS.some((s) => from.includes(s))) return 'job alert sender';
  if (MOSTLY_ALERT_SENDERS.some((re) => re.test(from))) return 'job alert sender';
  if (ALERT_SUBJECTS.some((re) => re.test(subject))) return 'job alert / recommendation';
  return null;
}
