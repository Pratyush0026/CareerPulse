import { distance } from 'fastest-levenshtein';

// Words that don't identify a company: "Infosys Limited" is just "Infosys".
const COMPANY_NOISE = [
  'private limited', 'pvt ltd', 'pvt. ltd.', 'pvt', 'ltd', 'limited', 'llp', 'inc', 'corp', 'corporation',
  'technologies', 'technology', 'tech', 'solutions', 'services', 'software', 'systems', 'consulting',
  'india', 'global', 'group', 'co', 'ai', 'labs', 'hq',
];

export function normalizeCompany(name = '') {
  let s = name
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ') // "Weekday (YC W21)" -> "Weekday"
    .replace(/[.,()&'"]/g, ' ');
  // Longest phrases first, so "private limited" goes before "limited".
  for (const word of [...COMPANY_NOISE].sort((a, b) => b.length - a.length)) {
    s = s.replace(new RegExp(`\\b${word.replace(/[.]/g, '\\.')}\\b`, 'g'), ' ');
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s || name.toLowerCase().trim(); // a company actually called "Tech" stays "tech"
}

const normalizeRole = (role = '') => role.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** 0..1, based on Levenshtein distance. */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}

const COMPANY_THRESHOLD = 0.8;
const ROLE_THRESHOLD = 0.7;

/**
 * Finds the card an email belongs to: same company (≥ 80% similar after normalising) and,
 * when the email names a role, the same role or a card with no role yet. A different role
 * at the same company is treated as a separate application.
 */
export function findMatchingApplication(applications, company, role) {
  const target = normalizeCompany(company);
  const candidates = applications
    .map((app) => ({ app, score: similarity(normalizeCompany(app.company), target) }))
    .filter((c) => c.score >= COMPANY_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.app.updatedAt - a.app.updatedAt);

  if (!candidates.length) return null;
  if (!role) return candidates[0].app;

  const r = normalizeRole(role);
  const byRole = candidates
    .map((c) => {
      const appRole = normalizeRole(c.app.role || '');
      const roleScore = appRole && (appRole.includes(r) || r.includes(appRole)) ? 1 : similarity(appRole, r);
      return { ...c, roleScore };
    })
    .sort((a, b) => b.roleScore - a.roleScore);

  if (byRole[0].roleScore >= ROLE_THRESHOLD) return byRole[0].app;
  const roleless = candidates.find((c) => !c.app.role);
  return roleless ? roleless.app : null;
}

// Applicant-tracking systems behind company careers pages.
const ATS_DOMAINS = [
  'myworkday.com', 'workday.com', 'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'ashbyhq.com',
  'smartrecruiters.com', 'icims.com', 'taleo.net', 'oraclecloud.com', 'cloud.oracle.com', 'successfactors.com',
  'successfactors.eu', 'sapsf.com', 'jobvite.com', 'workablemail.com', 'workable.com', 'darwinbox.in',
  'darwinbox.com', 'keka.com', 'kekamail.com', 'zohorecruit.com', 'zohorecruit.in', 'viazohorecruit.com',
  'freshteam.com', 'manatal.com', 'zappyhire.com', 'employmenthero.com', 'recruitee.com', 'bamboohr.com',
  'breezy.hr', 'teamtailor.com', 'personio.de', 'rippling.com', 'avature.net', 'eightfold.ai', 'phenom.com',
];
const FREE_MAIL = /(^|\.)(gmail|googlemail|yahoo|outlook|hotmail|live|rediffmail|icloud|proton(mail)?)\./;

const domainOf = (sender = '') => sender.toLowerCase().match(/@([a-z0-9.-]+)/)?.[1] || '';
const onDomain = (domain, list) => list.some((d) => domain === d || domain.endsWith(`.${d}`));

/** Platform from the sender's domain. `guessed` marks an assumption (shown as "Fallback"). */
export function inferPlatform(sender = '', company = '') {
  const domain = domainOf(sender);
  if (onDomain(domain, ['naukri.com'])) return { platform: 'Naukri', guessed: false };
  if (onDomain(domain, ['linkedin.com'])) return { platform: 'LinkedIn', guessed: false };
  if (onDomain(domain, ['foundit.in', 'monsterindia.com'])) return { platform: 'foundit', guessed: false };

  // A recruiter's personal mailbox says nothing about where you applied.
  if (!domain || FREE_MAIL.test(domain)) return { platform: 'unknown', guessed: true };

  if (onDomain(domain, ATS_DOMAINS)) return { platform: 'company site', guessed: false };
  const companyKey = normalizeCompany(company).replace(/\s+/g, '');
  if (companyKey.length >= 3 && domain.replace(/[.-]/g, '').includes(companyKey)) {
    return { platform: 'company site', guessed: false };
  }

  // Any other business domain is probably the company site, but that's a guess.
  return { platform: 'company site', guessed: true };
}

export const STAGE_ORDER = { Applied: 0, Assessment: 1, Interview: 2, Offer: 3 };

/**
 * May the AI move a card from `current` to `next`?
 * - Only forward (Applied < Assessment < Interview < Offer), never backward.
 * - "Rejected" can be applied from any stage.
 * - Once Rejected, the AI leaves the card alone (the user can drag it back manually).
 */
export function isForwardMove(current, next) {
  if (!next || current === next) return false;
  if (next === 'Rejected') return true;
  if (current === 'Rejected') return false;
  return STAGE_ORDER[next] > STAGE_ORDER[current];
}
