// Turns a profile save request into a clean, whitelisted object.
// Anything not listed here (userId, version, completeness...) can't be set by the client.

export class ProfileInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const SKILL_CATEGORIES = ['Technical', 'Framework / Tool', 'Soft Skill', 'Domain', 'Other'];
const REMOTE = ['remote', 'hybrid', 'onsite', 'flexible'];
const LEVELS = ['entry', 'mid', 'senior', 'lead', 'executive'];
const EMPLOYMENT = ['full-time', 'part-time', 'contract', 'internship', 'any'];
const SOURCES = ['resume', 'user_input'];

const text = (value, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const bool = (value) => value === true;
const confidence = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1);

function list(value, max, mapItem) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ProfileInputError('Profile lists must be arrays.');
  return value.slice(0, max).map(mapItem).filter(Boolean);
}

const strings = (value, max = 50, len = 120) => [...new Set(list(value, max, (v) => text(v, len)))];

function choice(value, allowed, field) {
  if (value === undefined || value === null || value === '') return null;
  if (!allowed.includes(value)) throw new ProfileInputError(`Invalid ${field}.`);
  return value;
}

function url(value) {
  const v = text(value, 300);
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function money(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ProfileInputError('Salary must be a positive number.');
  return n;
}

function years(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 60) throw new ProfileInputError('Years of experience must be between 0 and 60.');
  return Math.round(n * 10) / 10;
}

export function sanitizeProfile(body = {}) {
  if (typeof body !== 'object' || Array.isArray(body)) throw new ProfileInputError('Invalid profile data.');
  const goals = body.goals ?? {};
  const salary = goals.salary ?? {};

  // Skills are unique by name, case-insensitively; the first occurrence wins.
  const seen = new Set();
  const skills = list(body.skills, 200, (s) => {
    const name = text(s?.name, 80);
    if (!name || seen.has(name.toLowerCase())) return null;
    seen.add(name.toLowerCase());
    const source = SOURCES.includes(s.source) ? s.source : 'user_input';
    return {
      name,
      category: SKILL_CATEGORIES.includes(s.category) ? s.category : 'Technical',
      source,
      evidence: text(s.evidence, 300),
      confidence: confidence(s.confidence),
      // Skills you type in yourself are confirmed by definition.
      isConfirmed: source === 'user_input' ? true : bool(s.isConfirmed),
    };
  });

  const salaryMin = money(salary.min);
  const salaryMax = money(salary.max);
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
    throw new ProfileInputError('Minimum salary can’t be higher than the maximum.');
  }

  return {
    headline: text(body.headline, 160),
    summary: text(body.summary, 2000),
    yearsOfExperience: years(body.yearsOfExperience),
    experience: list(body.experience, 50, (e) => {
      const role = text(e?.role, 120);
      const company = text(e?.company, 120);
      if (!role || !company) return null;
      const source = SOURCES.includes(e.source) ? e.source : 'user_input';
      return {
        role,
        company,
        location: text(e.location, 120),
        startDate: text(e.startDate, 40),
        endDate: text(e.endDate, 40),
        current: bool(e.current),
        description: text(e.description, 3000),
        achievements: strings(e.achievements, 30, 500),
        measurableOutcomes: strings(e.measurableOutcomes, 30, 500),
        source,
        confidence: confidence(e.confidence),
        isConfirmed: source === 'user_input' ? true : bool(e.isConfirmed),
      };
    }),
    education: list(body.education, 20, (e) => {
      const degree = text(e?.degree, 160);
      const institution = text(e?.institution, 160);
      if (!degree || !institution) return null;
      return {
        degree,
        institution,
        fieldOfStudy: text(e.fieldOfStudy, 160),
        startYear: text(e.startYear, 10),
        endYear: text(e.endYear, 10),
      };
    }),
    skills,
    toolsAndFrameworks: strings(body.toolsAndFrameworks, 100, 80),
    projects: list(body.projects, 50, (p) => {
      const title = text(p?.title, 160);
      if (!title) return null;
      const projectSource = SOURCES.includes(p.source) ? p.source : 'user_input';
      return {
        title,
        role: text(p.role, 120),
        description: text(p.description, 3000),
        technologies: strings(p.technologies, 40, 80),
        outcomes: strings(p.outcomes, 20, 500),
        link: url(p.link),
        source: projectSource,
        isConfirmed: projectSource === 'user_input' ? true : bool(p.isConfirmed),
      };
    }),
    certifications: list(body.certifications, 50, (c) => {
      const name = text(c?.name, 160);
      if (!name) return null;
      return { name, issuer: text(c.issuer, 160), issueDate: text(c.issueDate, 40), credentialUrl: url(c.credentialUrl) };
    }),
    achievements: strings(body.achievements, 50, 500),
    links: {
      portfolio: url(body.links?.portfolio),
      github: url(body.links?.github),
      linkedin: url(body.links?.linkedin),
    },
    inferredInterests: list(body.inferredInterests, 20, (i) => {
      const interest = text(i?.interest, 120);
      if (!interest) return null;
      return { interest, confidence: confidence(i.confidence), confirmed: bool(i.confirmed) };
    }),
    missingOrAmbiguous: strings(body.missingOrAmbiguous, 30, 300),
    goals: {
      primaryRole: text(goals.primaryRole, 120),
      secondaryRoles: strings(goals.secondaryRoles, 10, 120),
      locations: strings(goals.locations, 15, 120),
      remotePreference: choice(goals.remotePreference, REMOTE, 'remote preference'),
      salary: {
        min: salaryMin,
        max: salaryMax,
        currency: text(salary.currency, 5).toUpperCase() || 'INR',
        period: salary.period === 'per_month' ? 'per_month' : 'per_year',
      },
      experienceLevel: choice(goals.experienceLevel, LEVELS, 'experience level'),
      employmentType: choice(goals.employmentType, EMPLOYMENT, 'employment type'),
      skillsToImprove: strings(goals.skillsToImprove, 30, 80),
      careerGoalsOrConstraints: text(goals.careerGoalsOrConstraints, 2000),
    },
  };
}
