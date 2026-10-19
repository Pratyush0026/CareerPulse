// Career DNA tests: npm run test:career-dna
// Runs against an in-memory MongoDB with synthetic data only. No Gemini or Gmail calls are made.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import careerDnaRoutes from '../routes/careerDna.js';
import jobDnaRoutes from '../routes/jobDna.js';
import applicationRoutes from '../routes/applications.js';
import actionPlanRoutes from '../routes/actionPlan.js';
import Recommendation from '../models/Recommendation.js';
import InterviewReflection from '../models/InterviewReflection.js';
import Experiment from '../models/Experiment.js';
import StageHistory from '../models/StageHistory.js';
import { refreshRecommendations } from '../services/recommendations.js';
import { cleanInsights, notesHash, INSIGHTS_PROMPT_VERSION } from '../services/interviewInsights.js';
import CareerProfile, { computeCompleteness } from '../models/CareerProfile.js';
import SkillEvidence, { determineSkillEvidenceLevel, EVIDENCE_LEVELS } from '../models/SkillEvidence.js';
import JobOpportunity from '../models/JobOpportunity.js';
import Application from '../models/Application.js';
import ProfileRevision from '../models/ProfileRevision.js';
import Migration from '../models/Migration.js';
import { migrateCareerDna } from '../scripts/migrateCareerDna.js';
import { applyResult } from '../services/syncService.js';
import config from '../config/index.js';
import { generateJson, aiBudget, QuotaExhaustedError } from '../services/gemini.js';
import { validateResumeFile, parseResumeBuffer, ResumeParseError } from '../services/resumeParser.js';
import { cleanExtraction } from '../services/careerDnaService.js';
import { sanitizeProfile } from '../services/profileInput.js';
import { normalizeSkill, isSkillMentionedInText, skillsMatch } from '../services/skillNormalizer.js';
import { buildSystemEvidence } from '../services/evidenceEngine.js';
import {
  cleanJobExtraction,
  analyzeOpportunityFit,
  computeExplainableScore,
  computeCandidateYears,
  JOB_PROMPT_VERSION,
} from '../services/jobDnaService.js';

const USER_A = new mongoose.Types.ObjectId();
const USER_B = new mongoose.Types.ObjectId();

let mongo;
let server;
let baseUrl;

// Same mounting as index.js, with the session replaced by a test header.
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.status(401).json({ code: 'NOT_LOGGED_IN' });
    req.userId = new mongoose.Types.ObjectId(id);
    next();
  });
  app.use('/api/career-dna/jobs', jobDnaRoutes);
  app.use('/api/career-dna/plan', actionPlanRoutes);
  app.use('/api/career-dna', careerDnaRoutes);
  app.use('/api/applications', applicationRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

async function call(user, method, path, body) {
  const headers = { 'x-test-user': String(user) };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const sampleProfile = {
  headline: 'Frontend engineer',
  yearsOfExperience: null,
  experience: [
    {
      role: 'Software Engineer',
      company: 'Acme',
      startDate: '2022-01',
      endDate: 'Present',
      description: 'Built dashboards in React and TypeScript.',
      achievements: ['Cut bundle size by 30% with code splitting in React'],
      source: 'resume',
    },
  ],
  skills: [
    { name: 'React.js', source: 'resume', isConfirmed: false, evidence: 'Skills: React.js' },
    { name: 'TypeScript', source: 'resume', isConfirmed: true },
    { name: 'Go', source: 'user_input' },
  ],
  projects: [{ title: 'CareerPulse', description: 'Job tracker in Node.js', technologies: ['React', 'Node.js'], source: 'user_input' }],
  goals: { primaryRole: 'Frontend Engineer' },
};

const sampleExtraction = {
  seniority: 'Mid',
  experienceYears: { min: 3, max: null, text: '3+ years of frontend experience' },
  education: { degree: '', field: '', required: false, text: '' },
  responsibilities: ['Build UI'],
  requiredSkills: [
    { name: 'React', canonicalSkill: 'React', category: 'Technical', description: '' },
    { name: 'TypeScript', canonicalSkill: 'TypeScript', category: 'Technical', description: '' },
    { name: 'GraphQL', canonicalSkill: 'GraphQL', category: 'Technical', description: '' },
  ],
  preferredSkills: [{ name: 'Docker', canonicalSkill: 'Docker', category: 'Tool', description: '' }],
  toolsAndFrameworks: [],
  domainKnowledge: [],
  explicitConstraints: [],
  ambiguousOrUnknown: [],
};

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([SkillEvidence.syncIndexes(), JobOpportunity.syncIndexes(), CareerProfile.syncIndexes(), ProfileRevision.syncIndexes(), Recommendation.syncIndexes(), InterviewReflection.syncIndexes()]);
  server = createTestApp().listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Promise.all([
    CareerProfile.deleteMany({}),
    SkillEvidence.deleteMany({}),
    JobOpportunity.deleteMany({}),
    Application.deleteMany({}),
    ProfileRevision.deleteMany({}),
    Migration.deleteMany({}),
    Recommendation.deleteMany({}),
    InterviewReflection.deleteMany({}),
    Experiment.deleteMany({}),
    StageHistory.deleteMany({}),
  ]);
});

describe('resume files', () => {
  const file = (name, content, size) => ({ originalname: name, mimetype: 'application/octet-stream', buffer: Buffer.from(content), size: size ?? content.length });

  test('rejects a missing, oversized or wrongly typed file', () => {
    assert.throws(() => validateResumeFile(null), (e) => e.code === 'NO_FILE');
    assert.throws(() => validateResumeFile(file('cv.pdf', '%PDF-1.7', 6 * 1024 * 1024)), (e) => e.code === 'FILE_TOO_LARGE');
    assert.throws(() => validateResumeFile(file('cv.exe', 'MZ')), (e) => e.code === 'INVALID_FILE_TYPE');
  });

  test('rejects a file whose contents don’t match its extension', () => {
    assert.throws(() => validateResumeFile(file('cv.pdf', 'just some text')), (e) => e.code === 'CONTENT_MISMATCH');
    assert.throws(() => validateResumeFile(file('cv.docx', '%PDF-1.7')), (e) => e.code === 'CONTENT_MISMATCH');
    assert.doesNotThrow(() => validateResumeFile(file('cv.pdf', '%PDF-1.7 ...')));
    assert.doesNotThrow(() => validateResumeFile(file('cv.docx', 'PK\u0003\u0004...')));
  });

  test('reports a malformed PDF instead of crashing', async () => {
    await assert.rejects(parseResumeBuffer(Buffer.from('%PDF-1.7 broken'), '.pdf'), (e) => e instanceof ResumeParseError);
  });

  test('upload endpoint rejects a renamed non-PDF before any AI call', async () => {
    const form = new FormData();
    form.append('resume', new Blob(['not a pdf at all']), 'resume.pdf');
    const res = await call(USER_A, 'POST', '/api/career-dna/parse-resume', form);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'CONTENT_MISMATCH');
  });
});

describe('AI output validation', () => {
  test('resume extraction starts unconfirmed and never invents years or links', () => {
    const resume = 'Jane Doe – github.com/janedoe – React, TypeScript';
    const draft = cleanExtraction(
      {
        headline: 'Engineer',
        yearsOfExperience: 'about five',
        skills: [{ name: 'React' }, { name: 'react' }, { name: '' }, { name: 'TypeScript', category: 'Weird' }],
        experience: [{ role: 'Dev', company: 'Acme', current: 'yes' }, { role: 'No company' }],
        links: { github: 'https://github.com/janedoe', linkedin: 'https://linkedin.com/in/made-up' },
        inferredInterests: [{ interest: 'Platform', confidence: 7 }],
      },
      resume
    );
    assert.equal(draft.yearsOfExperience, null);
    assert.deepEqual(draft.skills.map((s) => s.name), ['React', 'TypeScript']);
    assert.ok(draft.skills.every((s) => s.isConfirmed === false && s.source === 'resume'));
    assert.equal(draft.skills[1].category, 'Technical');
    assert.equal(draft.experience.length, 1);
    assert.equal(draft.experience[0].current, false);
    assert.equal(draft.links.github, 'https://github.com/janedoe');
    assert.equal(draft.links.linkedin, '', 'a link not in the resume is dropped');
    assert.equal(draft.inferredInterests[0].confirmed, false);
    assert.equal(draft.inferredInterests[0].confidence, 1);
  });

  test('malformed model output is rejected', () => {
    assert.equal(cleanExtraction(null), null);
    assert.equal(cleanExtraction('text'), null);
    assert.equal(cleanExtraction([1, 2]), null);
    assert.equal(cleanJobExtraction(undefined), null);
  });

  test('job extraction drops empty skills and keeps a duplicated skill as required only', () => {
    const job = cleanJobExtraction({
      seniority: 'Wizard',
      experienceYears: { min: -2 },
      requiredSkills: [{ name: 'React.js' }, { name: '' }, 'TypeScript'],
      preferredSkills: [{ name: 'react' }, { name: 'Docker' }],
    });
    assert.equal(job.seniority, 'Not specified');
    assert.equal(job.experienceYears.min, null);
    assert.deepEqual(job.requiredSkills.map((s) => s.canonicalSkill), ['React', 'TypeScript']);
    assert.deepEqual(job.preferredSkills.map((s) => s.canonicalSkill), ['Docker']);
  });
});

describe('profile input', () => {
  test('only whitelisted fields get through', () => {
    const clean = sanitizeProfile({ headline: 'x', userId: 'someone-else', version: 99, completenessScore: 100, __proto__: { admin: true } });
    assert.equal(clean.userId, undefined);
    assert.equal(clean.version, undefined);
    assert.equal(clean.completenessScore, undefined);
  });

  test('skills typed by the user are confirmed; resume skills keep their state; duplicates are merged', () => {
    const clean = sanitizeProfile({
      skills: [
        { name: 'Go', source: 'user_input', isConfirmed: false },
        { name: 'React', source: 'resume' },
        { name: 'react', source: 'user_input' },
      ],
    });
    assert.deepEqual(clean.skills.map((s) => [s.name, s.isConfirmed]), [['Go', true], ['React', false]]);
  });

  test('bad values are rejected with a clear message', () => {
    assert.throws(() => sanitizeProfile({ goals: { remotePreference: 'moon' } }), /remote preference/);
    assert.throws(() => sanitizeProfile({ goals: { salary: { min: 20, max: 10 } } }), /Minimum salary/);
    assert.throws(() => sanitizeProfile({ yearsOfExperience: 99 }), /between 0 and 60/);
    assert.throws(() => sanitizeProfile({ skills: 'React' }), /arrays/);
  });

  test('completeness only counts goals the user actually set', () => {
    const empty = computeCompleteness(sanitizeProfile({}));
    assert.equal(empty.breakdown.goals, 0);
    const withRemote = computeCompleteness(sanitizeProfile({ goals: { remotePreference: 'remote' } }));
    assert.equal(withRemote.breakdown.goals, 5);
  });
});

describe('skill normalisation', () => {
  test('aliases map to one skill without merging different technologies', () => {
    assert.equal(normalizeSkill('react.js'), 'React');
    assert.equal(normalizeSkill('ReactJS'), 'React');
    assert.equal(normalizeSkill('ts'), 'TypeScript');
    assert.notEqual(normalizeSkill('typescript'), normalizeSkill('javascript'));
    assert.notEqual(normalizeSkill('node'), normalizeSkill('react'));
    assert.equal(normalizeSkill('PyTorch'), 'PyTorch');
  });

  test('mentions use whole terms and ignore everyday words', () => {
    assert.equal(isSkillMentionedInText('Java', 'JavaScript developer'), false);
    assert.equal(isSkillMentionedInText('Go', 'our go-to-market plan'), false);
    assert.equal(isSkillMentionedInText('Go', 'services written in Go'), true);
    assert.equal(isSkillMentionedInText('React', 'built with React.js'), true);
    assert.equal(isSkillMentionedInText('Express.js', 'please express interest'), false);
    assert.equal(isSkillMentionedInText('C++', 'wrote C++ daily'), true);
  });
});

describe('evidence levels', () => {
  const record = (evidenceType, extra = {}) => ({ evidenceType, isConfirmed: true, status: 'active', ...extra });

  test('levels follow the strongest active evidence', () => {
    assert.equal(determineSkillEvidenceLevel([]).level, EVIDENCE_LEVELS.NEEDS_MORE_EVIDENCE);
    assert.equal(determineSkillEvidenceLevel([record('resume_claim', { isConfirmed: false })]).level, EVIDENCE_LEVELS.MENTIONED);
    assert.equal(determineSkillEvidenceLevel([record('user_declaration')]).level, EVIDENCE_LEVELS.USER_CONFIRMED);
    assert.equal(determineSkillEvidenceLevel([record('project')]).level, EVIDENCE_LEVELS.SUPPORTED);
    assert.equal(determineSkillEvidenceLevel([record('assessment')]).level, EVIDENCE_LEVELS.ASSESSMENT_VALIDATED);
  });

  test('rejected evidence no longer counts', () => {
    const result = determineSkillEvidenceLevel([record('project', { status: 'rejected' }), record('resume_claim', { isConfirmed: false })]);
    assert.equal(result.level, EVIDENCE_LEVELS.MENTIONED);
    assert.equal(result.sourcesBreakdown.rejected, 1);
  });

  test('an unconfirmed resume skill never becomes "confirmed by you"', () => {
    const records = buildSystemEvidence(USER_A, sampleProfile);
    const react = records.filter((r) => r.canonicalSkill === 'React');
    assert.ok(!react.some((r) => r.evidenceType === 'user_declaration'), 'React was not confirmed');
    assert.ok(records.some((r) => r.canonicalSkill === 'TypeScript' && r.evidenceType === 'user_declaration'));
  });

  test('a resume project only counts as confirmed once the user confirms it', () => {
    const project = (isConfirmed) => buildSystemEvidence(USER_A, { projects: [{ title: 'Shop', technologies: ['Vue'], source: 'resume', isConfirmed }] })[0];
    assert.equal(project(false).isConfirmed, false);
    assert.equal(project(true).isConfirmed, true);
    assert.equal(sanitizeProfile({ projects: [{ title: 'Mine', source: 'user_input' }] }).projects[0].isConfirmed, true);
  });

  test('a job title alone isn’t evidence, but a bullet is', () => {
    const records = buildSystemEvidence(USER_A, {
      skills: [{ name: 'Python', source: 'user_input' }],
      experience: [{ role: 'Python Developer', company: 'X', description: 'Maintained billing system.' }],
    });
    assert.ok(!records.some((r) => r.evidenceType === 'work_experience'));
  });
});

describe('job fit', () => {
  test('years are worked out from real dates, overlaps counted once, unknown when dates are missing', () => {
    assert.equal(computeCandidateYears([]), null);
    assert.equal(computeCandidateYears([{ startDate: '2020-01', endDate: '' }]), null);
    const years = computeCandidateYears([
      { startDate: '2018-01-01', endDate: '2020-01-01' },
      { startDate: '2019-01-01', endDate: '2021-01-01' },
    ]);
    assert.ok(years >= 2.9 && years <= 3.1, `expected ~3, got ${years}`);
  });

  test('missing experience is a question, not a mismatch', () => {
    const fit = analyzeOpportunityFit(sampleExtraction, { skills: [], experience: [{ role: 'Dev', company: 'X' }] }, []);
    const experience = fit.requirementMatches.find((m) => m.requirementType === 'experience');
    assert.equal(experience.matchStatus, 'Requires clarification');
    assert.equal(fit.confirmedGaps.length, 0);
  });

  test('no evidence is reported as "no evidence yet", never as a gap', () => {
    const fit = analyzeOpportunityFit(sampleExtraction, sampleProfile, []);
    const graphql = fit.requirementMatches.find((m) => m.requirement === 'GraphQL');
    assert.equal(graphql.matchStatus, 'No evidence yet');
    assert.match(graphql.missingOrUncertain, /doesn’t mean you lack/);
    assert.ok(!fit.confirmedGaps.includes('GraphQL'));
  });

  test('a related skill counts as partial evidence for a broad requirement', () => {
    const job = { ...sampleExtraction, requiredSkills: [{ name: 'Unit Testing', canonicalSkill: 'Unit Testing' }] };
    const fit = analyzeOpportunityFit(job, { skills: [{ name: 'Jest', source: 'user_input' }] }, []);
    const testing = fit.requirementMatches.find((m) => m.requirement === 'Unit Testing');
    assert.equal(testing.matchStatus, 'Partial evidence');
    assert.match(testing.candidateEvidence[0], /Jest/);
  });

  test('education evidence doesn’t repeat the field when the degree already names it', () => {
    const job = { ...sampleExtraction, education: { degree: 'B.E.', field: 'Computer Science', required: true, text: 'B.E. in Computer Science' } };
    const fit = analyzeOpportunityFit(job, { education: [{ degree: 'B.E. Computer Engineering', fieldOfStudy: 'Computer Engineering', institution: 'Pune University' }] }, []);
    const education = fit.requirementMatches.find((m) => m.requirementType === 'education');
    assert.deepEqual(education.candidateEvidence, ['B.E. Computer Engineering, Pune University']);
  });

  test('education matching looks at the field, not just whether a degree exists', () => {
    const job = { ...sampleExtraction, education: { degree: 'B.Tech', field: 'Computer Science', required: true, text: 'B.Tech in Computer Science' } };
    const history = { education: [{ degree: 'BA', fieldOfStudy: 'History', institution: 'DU' }] };
    const cs = { education: [{ degree: 'B.Tech', fieldOfStudy: 'Computer Science', institution: 'IIT' }] };
    const status = (p) => analyzeOpportunityFit(job, p, []).requirementMatches.find((m) => m.requirementType === 'education').matchStatus;
    assert.equal(status(history), 'Requires clarification');
    assert.equal(status(cs), 'Strong evidence of match');
  });

  test('too few requirements gives "Insufficient Data" instead of a score', () => {
    const result = computeExplainableScore([{ importance: 'required', matchStatus: 'Strong evidence of match', requirementType: 'skill' }]);
    assert.equal(result.tier, 'Insufficient Data');
    assert.equal(result.breakdown.preferredCoveragePercent, null);
  });

  test('a user correction survives recalculation', () => {
    const first = analyzeOpportunityFit(sampleExtraction, sampleProfile, []);
    const graphql = first.requirementMatches.find((m) => m.requirement === 'GraphQL');
    graphql.userOverride = { isOverridden: true, userStatus: 'Strong evidence of match', userNote: 'Used it at work' };
    const second = analyzeOpportunityFit(sampleExtraction, sampleProfile, [], first.requirementMatches);
    const again = second.requirementMatches.find((m) => m.requirement === 'GraphQL');
    assert.equal(again.userOverride.userStatus, 'Strong evidence of match');
    assert.ok(second.overallFitScore > first.overallFitScore);
  });
});

describe('API', () => {
  test('saving a profile ignores fields the client must not set', async () => {
    const res = await call(USER_A, 'PUT', '/api/career-dna', { ...sampleProfile, userId: String(USER_B), version: 50 });
    assert.equal(res.status, 200);
    assert.equal(res.body.profile.userId, String(USER_A));
    assert.equal(res.body.profile.version, 1);
    assert.equal(await CareerProfile.countDocuments({ userId: USER_B }), 0);
  });

  test('saving twice works (no version conflict) and evidence isn’t duplicated', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    const count = await SkillEvidence.countDocuments({ userId: USER_A });
    const res = await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    assert.equal(res.status, 200);
    assert.equal(res.body.profile.version, 2);
    assert.equal(await SkillEvidence.countDocuments({ userId: USER_A }), count);
  });

  test('invalid profile data returns 400', async () => {
    const res = await call(USER_A, 'PUT', '/api/career-dna', { goals: { experienceLevel: 'god' } });
    assert.equal(res.status, 400);
  });

  test('a rejected evidence record stays rejected after the profile is saved again', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    const record = await SkillEvidence.findOne({ userId: USER_A, evidenceType: 'project', canonicalSkill: 'React' });
    const patch = await call(USER_A, 'PATCH', `/api/career-dna/evidence/${record._id}`, { status: 'rejected', notes: 'Only did the CSS' });
    assert.equal(patch.status, 200);

    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    const after = await SkillEvidence.findById(record._id);
    assert.equal(after.status, 'rejected');
    assert.equal(after.notes, 'Only did the CSS');
  });

  test('users can’t self-certify an assessment, and profile evidence can’t be deleted', async () => {
    const bad = await call(USER_A, 'POST', '/api/career-dna/evidence', { skillName: 'React', sourceTitle: 'Me', evidenceType: 'assessment' });
    assert.equal(bad.status, 400);

    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    const system = await SkillEvidence.findOne({ userId: USER_A, origin: 'system' });
    const del = await call(USER_A, 'DELETE', `/api/career-dna/evidence/${system._id}`);
    assert.equal(del.status, 400);

    const ok = await call(USER_A, 'POST', '/api/career-dna/evidence', { skillName: 'GraphQL', sourceTitle: 'Side project', evidenceType: 'project' });
    assert.equal(ok.status, 201);
    const removed = await call(USER_A, 'DELETE', `/api/career-dna/evidence/${ok.body.created._id}`);
    assert.equal(removed.status, 200);
  });

  test('accounts can’t see or change each other’s data', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    const recordA = await SkillEvidence.findOne({ userId: USER_A });

    const profileB = await call(USER_B, 'GET', '/api/career-dna');
    assert.equal(profileB.body.profile, null);
    assert.deepEqual((await call(USER_B, 'GET', '/api/career-dna/evidence')).body, []);
    assert.equal((await call(USER_B, 'PATCH', `/api/career-dna/evidence/${recordA._id}`, { status: 'rejected' })).status, 404);
    assert.equal((await call(USER_B, 'DELETE', `/api/career-dna/evidence/${recordA._id}`)).status, 404);
    assert.equal((await SkillEvidence.findById(recordA._id)).status, 'active');
  });

  test('a job can’t be linked to another account’s application', async () => {
    const appA = await Application.create({ userId: USER_A, company: 'Acme', role: 'Dev' });
    const res = await call(USER_B, 'POST', '/api/career-dna/jobs/analyze', {
      rawJobDescription: 'We are hiring a frontend engineer. '.repeat(5),
      applicationId: String(appA._id),
    });
    assert.equal(res.status, 404);
    assert.equal(await JobOpportunity.countDocuments(), 0);
  });

  test('deleting an application unlinks its job analyses but keeps them', async () => {
    const app = await Application.create({ userId: USER_A, company: 'Acme', role: 'Dev' });
    const job = await JobOpportunity.create({
      userId: USER_A,
      company: 'Acme',
      role: 'Dev',
      rawJobDescription: 'x'.repeat(100),
      applicationId: app._id,
      source: 'linked_application',
    });

    assert.equal((await call(USER_A, 'DELETE', `/api/applications/${app._id}`)).status, 200);
    const after = await JobOpportunity.findById(job._id).lean();
    assert.equal(after.applicationId, null);
    assert.equal(after.source, 'manual_paste');
  });

  test('application links must be web addresses, since the dashboard opens them', async () => {
    const app = await Application.create({ userId: USER_A, company: 'Acme', role: 'Dev' });
    const path = `/api/applications/${app._id}`;
    assert.equal((await call(USER_A, 'PATCH', path, { link: 'javascript:alert(1)' })).status, 400);
    assert.equal((await call(USER_A, 'PATCH', path, { link: 'https://careers.acme.com/jobs/42' })).status, 200);
    assert.equal((await call(USER_A, 'PATCH', path, { link: '' })).status, 200, 'clearing the link is allowed');
  });

  test('re-analysing the same description reuses it instead of calling the AI', async () => {
    const description = 'Frontend engineer role. Required: React, TypeScript, GraphQL. Nice to have: Docker. 3+ years.';
    const hash = (await import('node:crypto')).createHash('sha256').update(description.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');
    await JobOpportunity.create({
      userId: USER_A,
      company: 'Acme',
      role: 'Frontend',
      rawJobDescription: description,
      descriptionHash: hash,
      promptVersion: JOB_PROMPT_VERSION,
      extractedRequirements: sampleExtraction,
    });

    const res = await call(USER_A, 'POST', '/api/career-dna/jobs/analyze', { rawJobDescription: `  ${description}  ` });
    assert.equal(res.status, 200);
    assert.equal(res.body.reused, true);
    assert.equal(await JobOpportunity.countDocuments({ userId: USER_A }), 1);
    assert.ok(res.body.fitAnalysis.requirementMatches.length >= 4);
  });

  test('overrides are validated, applied by id and can be undone; other users get 404', async () => {
    const job = await JobOpportunity.create({
      userId: USER_A,
      company: 'Acme',
      role: 'Frontend',
      rawJobDescription: 'x'.repeat(100),
      extractedRequirements: sampleExtraction,
      fitAnalysis: analyzeOpportunityFit(sampleExtraction, sampleProfile, []),
    });
    const matchId = String(job.fitAnalysis.requirementMatches.find((m) => m.requirement === 'GraphQL')._id);
    const path = `/api/career-dna/jobs/${job._id}/override`;

    assert.equal((await call(USER_A, 'PATCH', path, { matchId, userStatus: 'Excellent' })).status, 400);
    assert.equal((await call(USER_B, 'PATCH', path, { matchId, userStatus: 'Partial evidence' })).status, 404);

    const applied = await call(USER_A, 'PATCH', path, { matchId, userStatus: 'Strong evidence of match', userNote: 'Used daily' });
    assert.equal(applied.status, 200);
    assert.ok(applied.body.fitAnalysis.overallFitScore > job.fitAnalysis.overallFitScore);
    assert.ok(applied.body.fitAnalysis.strengths.includes('GraphQL'), 'the corrected requirement moves into strengths');
    assert.ok(!applied.body.fitAnalysis.missingEvidence.includes('GraphQL'));

    const undone = await call(USER_A, 'PATCH', path, { matchId, userStatus: null });
    assert.equal(undone.body.fitAnalysis.overallFitScore, job.fitAnalysis.overallFitScore);
  });

  test('saving the profile recalculates saved job analyses', async () => {
    await JobOpportunity.create({
      userId: USER_A,
      company: 'Acme',
      role: 'Frontend',
      rawJobDescription: 'x'.repeat(100),
      extractedRequirements: sampleExtraction,
      fitAnalysis: analyzeOpportunityFit(sampleExtraction, null, []),
    });
    const job = await JobOpportunity.findOne({ userId: USER_A });
    const before = job.fitAnalysis.overallFitScore;
    const corrected = job.fitAnalysis.requirementMatches.find((m) => m.requirementType === 'skill');
    const override = await call(USER_A, 'PATCH', `/api/career-dna/jobs/${job._id}/override`, { matchId: String(corrected._id), userStatus: 'Strong evidence of match', userNote: 'Shipped it at work' });
    assert.equal(override.status, 200);

    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    const refreshed = (await JobOpportunity.findOne({ userId: USER_A })).fitAnalysis;
    assert.ok(refreshed.overallFitScore > before, `expected the score to rise after adding a profile (${before} → ${refreshed.overallFitScore})`);
    const kept = refreshed.requirementMatches.find((m) => m.requirement === corrected.requirement);
    assert.equal(kept.userOverride.userStatus, 'Strong evidence of match', 'the correction survives the refresh');
  });

  test('deleting Career DNA removes the profile, evidence and job analyses – only for that account', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    await call(USER_B, 'PUT', '/api/career-dna', sampleProfile);
    await JobOpportunity.create({ userId: USER_A, company: 'A', role: 'R', rawJobDescription: 'x'.repeat(100) });

    const res = await call(USER_A, 'DELETE', '/api/career-dna');
    assert.equal(res.status, 200);
    assert.equal(await CareerProfile.countDocuments({ userId: USER_A }), 0);
    assert.equal(await SkillEvidence.countDocuments({ userId: USER_A }), 0);
    assert.equal(await JobOpportunity.countDocuments({ userId: USER_A }), 0);
    assert.equal(await CareerProfile.countDocuments({ userId: USER_B }), 1);
    assert.ok((await SkillEvidence.countDocuments({ userId: USER_B })) > 0);

    assert.equal((await call(USER_A, 'DELETE', '/api/career-dna')).status, 200, 'deleting again is harmless');
  });

  test('patterns only appear with enough saved jobs, and count each job once', async () => {
    const save = (requiredSkills, preferredSkills = []) =>
      JobOpportunity.create({ userId: USER_A, company: 'C', role: 'R', rawJobDescription: 'x'.repeat(100), extractedRequirements: { requiredSkills, preferredSkills } });
    const ts = { name: 'TypeScript', canonicalSkill: 'TypeScript' };
    const react = { name: 'React', canonicalSkill: 'React' };

    await save([ts, react]);
    await save([ts]);
    let res = await call(USER_A, 'GET', '/api/career-dna/jobs/patterns');
    assert.deepEqual(res.body, { jobCount: 2, minJobs: 3, patterns: [] });

    await save([react], [ts]);
    res = await call(USER_A, 'GET', '/api/career-dna/jobs/patterns');
    const typescript = res.body.patterns.find((p) => p.skill === 'TypeScript');
    assert.equal(res.body.jobCount, 3);
    assert.deepEqual([typescript.requiredIn, typescript.mentionedIn], [2, 3]);
    assert.equal((await call(USER_B, 'GET', '/api/career-dna/jobs/patterns')).body.jobCount, 0, 'other accounts see nothing');

    const detail = await call(USER_A, 'GET', '/api/career-dna/evidence/TypeScript');
    assert.deepEqual(detail.body.jobDemand, { jobCount: 3, requiredIn: 2, preferredIn: 1 });
  });

  test('invalid ids return 400 rather than a server error', async () => {
    assert.equal((await call(USER_A, 'GET', '/api/career-dna/jobs/not-an-id')).status, 400);
    assert.equal((await call(USER_A, 'PATCH', '/api/career-dna/evidence/not-an-id', { status: 'rejected' })).status, 400);
  });
});

describe('history', () => {
  const savedJob = (fit = analyzeOpportunityFit(sampleExtraction, null, [])) =>
    JobOpportunity.create({
      userId: USER_A,
      company: 'Acme',
      role: 'Frontend',
      rawJobDescription: 'x'.repeat(100),
      promptVersion: JOB_PROMPT_VERSION,
      extractedRequirements: sampleExtraction,
      fitAnalysis: fit,
    });

  test('every profile save is kept as a revision, and a retried save isn’t recorded twice', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    await call(USER_A, 'PUT', '/api/career-dna', { ...sampleProfile, headline: 'Senior frontend engineer' });
    await call(USER_A, 'PUT', '/api/career-dna', { ...sampleProfile, extraction: { promptVersion: 'resume-2026-10', fileType: 'pdf' } });

    const revisions = await ProfileRevision.find({ userId: USER_A }).sort({ version: 1 }).lean();
    assert.deepEqual(revisions.map((r) => [r.version, r.reason]), [[1, 'created'], [2, 'edit'], [3, 'resume_review']]);
    assert.equal(revisions[0].snapshot.headline, 'Frontend engineer', 'older revisions are not rewritten');
    assert.equal(revisions[1].snapshot.headline, 'Senior frontend engineer');
    assert.equal(revisions[0].snapshot.userId, undefined);

    const { recordRevision } = await import('../models/ProfileRevision.js');
    await recordRevision(await CareerProfile.findOne({ userId: USER_A }), 'edit');
    assert.equal(await ProfileRevision.countDocuments({ userId: USER_A }), 3);
  });

  test('fit history records real score changes only, with the reason', async () => {
    const job = await savedJob();
    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);
    await call(USER_A, 'PUT', '/api/career-dna', sampleProfile);

    let history = (await JobOpportunity.findById(job._id).lean()).fitHistory;
    assert.equal(history.length, 1, 'a save that changes nothing adds no entry');
    assert.equal(history[0].reason, 'profile_change');
    assert.equal(history[0].profileVersion, 1);

    const current = await JobOpportunity.findById(job._id).lean();
    const gap = current.fitAnalysis.requirementMatches.find((m) => m.requirement === 'GraphQL');
    const res = await call(USER_A, 'PATCH', `/api/career-dna/jobs/${job._id}/override`, { matchId: String(gap._id), userStatus: 'Strong evidence of match' });
    assert.equal(res.status, 200);
    history = res.body.fitHistory;
    assert.equal(history.length, 2);
    assert.equal(history[1].reason, 'correction');
    assert.ok(history[1].score > history[0].score);
  });

  test('existing data gets a baseline once, and deleting Career DNA removes the history', async () => {
    await CareerProfile.create({ userId: USER_A, ...sampleProfile, version: 4 });
    const job = await savedJob();

    await migrateCareerDna();
    await migrateCareerDna();
    const revisions = await ProfileRevision.find({ userId: USER_A }).lean();
    assert.deepEqual(revisions.map((r) => [r.version, r.reason]), [[4, 'baseline']]);
    const history = (await JobOpportunity.findById(job._id).lean()).fitHistory;
    assert.equal(history[0].reason, 'baseline');
    assert.equal(history[0].score, job.fitAnalysis.overallFitScore);
    // The one-off rescoring adds at most one entry, however many times the server starts.
    assert.ok(history.slice(1).every((h) => h.reason === 'scoring_update') && history.length <= 2);
    assert.equal(await Migration.countDocuments({ name: '2026-10-skill-matching' }), 1);

    const res = await call(USER_A, 'DELETE', '/api/career-dna');
    assert.equal(res.body.deleted.revisions, 1);
    assert.equal(await ProfileRevision.countDocuments({ userId: USER_A }), 0);
  });
});

describe('AI spending', () => {
  test('requests stop at the daily limit without reaching Gemini', async () => {
    const { apiKey, dailyRequestLimit } = config.gemini;
    Object.assign(config.gemini, { apiKey: apiKey || 'test-key', dailyRequestLimit: aiBudget().requestsToday });
    try {
      await assert.rejects(generateJson({ feature: 'job', prompt: '{}', label: 'test' }), QuotaExhaustedError);
    } finally {
      Object.assign(config.gemini, { apiKey, dailyRequestLimit });
    }
  });
});

describe('skills written differently on the profile and in the job', () => {
  const integrationProfile = {
    headline: 'Integration Developer',
    yearsOfExperience: null,
    experience: [
      {
        role: 'Integration Engineer',
        company: 'Infosys',
        startDate: 'Oct 2019',
        endDate: 'Jun 2023',
        description: 'Developed and maintained REST and SOAP APIs for payment platforms.',
        achievements: ['Worked on a Sybase-to-IIB migration with flows using HTTP, MQ and File nodes', 'Designed batch and real-time APIs on a Linux server'],
        measurableOutcomes: [],
        source: 'resume',
        isConfirmed: true,
      },
    ],
    skills: [
      { name: 'IIB 10', category: 'Technical', source: 'resume', isConfirmed: true },
      { name: 'IBM MQ', category: 'Technical', source: 'resume', isConfirmed: true },
      { name: 'IBM ACE 12', category: 'Technical', source: 'resume', isConfirmed: true },
    ],
    projects: [],
    education: [],
  };
  const esbJob = cleanJobExtraction({
    seniority: 'Senior',
    requiredSkills: [{ name: 'IBM Integration Bus (IIB)' }, { name: 'Web Services (REST/SOAP)' }, { name: 'SQL Server' }, { name: 'Batch Job Development' }],
    preferredSkills: [{ name: 'WebSphere MQ' }],
  });

  test('versions, vendor names, abbreviations and either/or requirements still match', () => {
    const profile = sanitizeProfile(integrationProfile);
    const fit = analyzeOpportunityFit(esbJob, profile, buildSystemEvidence(USER_A, profile));
    const status = (name) => fit.requirementMatches.find((m) => m.requirement === name).matchStatus;

    assert.equal(status('IBM Integration Bus (IIB)'), 'Strong evidence of match');
    assert.equal(status('Web Services (REST/SOAP)'), 'Strong evidence of match');
    assert.equal(status('WebSphere MQ'), 'Strong evidence of match');
    assert.equal(status('SQL Server'), 'No evidence yet', 'a line that only says "server" is not SQL Server');
    assert.equal(status('Batch Job Development'), 'Partial evidence');
    assert.match(fit.requirementMatches.find((m) => m.requirement === 'Batch Job Development').candidateEvidence[0], /^Related work in Integration Engineer at Infosys: “Designed batch/);
    assert.ok(fit.overallFitScore >= 60, `expected a real score, got ${fit.overallFitScore}`);
  });

  test('skill names keep their capitals, and roles that use a shorter name count as evidence', () => {
    assert.equal(normalizeSkill('IBM ACE 12'), 'IBM ACE 12');
    assert.equal(normalizeSkill('IBM Integration Bus (IIB)'), 'IBM Integration Bus (IIB)');
    assert.ok(skillsMatch('GraphQL', 'GraphQL APIs') && skillsMatch('React', 'React development'));
    assert.ok(!skillsMatch('Web', 'Web Services') && !skillsMatch('SQL', 'SQL Server'));
    const profile = sanitizeProfile(integrationProfile);
    const fromRoles = buildSystemEvidence(USER_A, profile).filter((e) => e.evidenceType === 'work_experience').map((e) => e.canonicalSkill);
    assert.deepEqual(fromRoles.sort(), ['IBM MQ', 'IIB 10']);
  });

  test('little evidence is "Limited Evidence", not a mismatch', () => {
    const fit = analyzeOpportunityFit(esbJob, null, []);
    assert.equal(fit.overallFitScore, 0);
    assert.equal(fit.fitTier, 'Limited Evidence');
  });

  test('a confirmation can’t be marked wrong; it’s changed in the profile', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', integrationProfile);
    const confirmation = await SkillEvidence.findOne({ userId: USER_A, evidenceType: 'user_declaration' });
    const res = await call(USER_A, 'PATCH', `/api/career-dna/evidence/${confirmation._id}`, { status: 'rejected' });
    assert.equal(res.status, 400);
    assert.equal((await SkillEvidence.findById(confirmation._id)).status, 'active');
  });
});

describe('education', () => {
  const profile = { education: [{ degree: 'B.Tech', fieldOfStudy: 'Computer Science', institution: 'ABES Engineering College' }] };
  const job = (text) => ({ ...cleanJobExtraction({ requiredSkills: [{ name: 'React' }, { name: 'Redux' }] }), education: { degree: 'B.Tech', field: 'Computer Science', required: true, text } });
  const educationMatch = (text) => analyzeOpportunityFit(job(text), profile, []).requirementMatches.find((m) => m.requirementType === 'education');

  test('a degree in the right field matches', () => {
    assert.equal(educationMatch('B.Tech in Computer Science or related').matchStatus, 'Strong evidence of match');
  });

  test('jobs that only accept certain institutions need the user to judge', () => {
    assert.equal(educationMatch('B.Tech / M.Tech from Tier-1 institutes only — IITs, NITs, IIITs').matchStatus, 'Requires clarification');
  });
});

describe('applications and sync', () => {
  const interviewEmail = (date) => ({ date, messageId: `m-${date.getTime()}`, sender: 'careers@acme.com' });
  const interview = { company: 'Acme', role: 'Developer', stage: 'Interview', summary: 'Interview invite', event_date: null, link: null };

  test('cards can’t be emptied of their company, stage or platform, and fields must be text', async () => {
    const app = await Application.create({ userId: USER_A, company: 'Acme', role: 'Dev' });
    const path = `/api/applications/${app._id}`;
    for (const body of [{ stage: '' }, { platform: '' }, { company: '' }, { company: { $gt: '' } }, { eventDate: 'not a date' }]) {
      assert.equal((await call(USER_A, 'PATCH', path, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call(USER_A, 'POST', '/api/applications', { role: 'No company' })).status, 400);
    assert.equal((await Application.findById(app._id)).stage, 'Applied');
  });

  test('fixing a typo doesn’t stop a later-synced email moving the card on', async () => {
    const app = await Application.create({ userId: USER_A, company: 'Acme', role: 'Dev', stage: 'Applied', source: 'gmail', lastEmailAt: new Date('2026-10-01') });
    await call(USER_A, 'PATCH', `/api/applications/${app._id}`, { role: 'Developer' });

    const applications = await Application.find({ userId: USER_A }).lean();
    await applyResult(interviewEmail(new Date('2026-10-05')), interview, { userId: USER_A, applications });
    assert.equal((await Application.findById(app._id)).stage, 'Interview');
  });

  test('a stage set by hand isn’t undone by an older email', async () => {
    const app = await Application.create({ userId: USER_A, company: 'Acme', role: 'Developer', stage: 'Applied', source: 'gmail', lastEmailAt: new Date('2026-10-01') });
    await call(USER_A, 'PATCH', `/api/applications/${app._id}`, { stage: 'Rejected' });

    const applications = await Application.find({ userId: USER_A }).lean();
    await applyResult(interviewEmail(new Date('2026-10-05')), interview, { userId: USER_A, applications });
    assert.equal((await Application.findById(app._id)).stage, 'Rejected');
  });

  test('a card deleted during a sync stays deleted', async () => {
    const app = await Application.create({ userId: USER_A, company: 'Acme', role: 'Developer', stage: 'Applied', source: 'gmail' });
    const applications = await Application.find({ userId: USER_A }).lean();
    await Application.deleteOne({ _id: app._id });

    const outcome = await applyResult(interviewEmail(new Date()), interview, { userId: USER_A, applications });
    assert.deepEqual(outcome, { status: 'unchanged', applicationId: null });
    assert.equal(await Application.countDocuments({ userId: USER_A }), 0);
  });
});

describe('action plan: recommendations', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const planProfile = {
    headline: 'Frontend engineer',
    experience: [
      { role: 'Engineer', company: 'Acme', startDate: '2022-01', endDate: 'Present', description: 'Built dashboards in React.', source: 'user_input' },
    ],
    skills: [
      { name: 'React', source: 'user_input' },
      { name: 'TypeScript', source: 'resume', isConfirmed: false },
    ],
  };
  const saveJob = (requiredSkills, extra = {}) =>
    JobOpportunity.create({
      userId: USER_A,
      company: 'C',
      role: 'Frontend Engineer',
      rawJobDescription: 'x'.repeat(100),
      extractedRequirements: { requiredSkills: requiredSkills.map((name) => ({ name, canonicalSkill: name })) },
      ...extra,
    });
  const plan = async (user = USER_A) => (await call(user, 'GET', '/api/career-dna/plan/recommendations')).body;
  const byKind = (recs, kind) => recs.filter((r) => r.kind === kind);

  test('suggestions come from recurring requirements and say exactly how often they recur', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', planProfile);
    for (let i = 0; i < 3; i++) await saveJob(['React', 'TypeScript', 'GraphQL']);

    const { active } = await plan();
    const typescript = active.find((r) => r.skill === 'TypeScript');
    assert.equal(typescript.kind, 'show_evidence', 'listed but not shown in a role');
    assert.match(typescript.why, /asked for in 3 of your 3 saved jobs \(required in 3\)/);
    assert.match(typescript.uncertainty, /small sample/);
    assert.equal(active.find((r) => r.skill === 'GraphQL').kind, 'close_gap', 'not on the profile at all');
    assert.equal(active.some((r) => r.skill === 'React'), false, 'React is already shown in a role');
    assert.equal(byKind(active, 'set_goal').length, 1, 'no target role yet');
    assert.equal(byKind(active, 'add_jobs').length, 0);
  });

  test('a dismissed or "incorrect" suggestion never comes back, and the user’s decision is kept', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', planProfile);
    for (let i = 0; i < 3; i++) await saveJob(['GraphQL', 'Redux']);
    const { active } = await plan();
    const graphql = active.find((r) => r.skill === 'GraphQL');
    const redux = active.find((r) => r.skill === 'Redux');

    assert.equal((await call(USER_A, 'PATCH', `/api/career-dna/plan/recommendations/${graphql._id}`, { action: 'dismiss' })).status, 200);
    assert.equal((await call(USER_A, 'PATCH', `/api/career-dna/plan/recommendations/${redux._id}`, { action: 'incorrect', note: 'I use Zustand' })).status, 200);
    await saveJob(['GraphQL', 'Redux']);

    const after = await plan();
    assert.equal(after.active.some((r) => ['GraphQL', 'Redux'].includes(r.skill)), false);
    const reported = after.history.find((r) => r.skill === 'Redux');
    assert.equal(reported.status, 'incorrect');
    assert.equal(reported.userNote, 'I use Zustand');
    assert.match(reported.why, /3 of your 3/, 'a decided recommendation is not rewritten with newer numbers');
  });

  test('when the reason goes away, untouched suggestions disappear and accepted ones are flagged, not deleted', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', planProfile);
    for (let i = 0; i < 3; i++) await saveJob(['TypeScript', 'GraphQL']);
    const { active } = await plan();
    const typescript = active.find((r) => r.skill === 'TypeScript');
    await call(USER_A, 'PATCH', `/api/career-dna/plan/recommendations/${typescript._id}`, { action: 'accept' });

    // The user adds a project that uses both skills.
    await call(USER_A, 'PUT', '/api/career-dna', {
      ...planProfile,
      skills: [...planProfile.skills, { name: 'GraphQL', source: 'user_input' }],
      projects: [{ title: 'Shop', description: 'Storefront', technologies: ['TypeScript', 'GraphQL'], source: 'user_input' }],
    });

    const after = await plan();
    const accepted = after.active.find((r) => r.skill === 'TypeScript');
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.reasonResolved, true);
    assert.equal([...after.active, ...after.history].some((r) => r.skill === 'GraphQL'), false, 'an untouched suggestion is just removed');
  });

  test('a snoozed suggestion comes back after its date; reopening is allowed', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', { ...planProfile, goals: { primaryRole: 'Frontend Engineer' } });
    const { active } = await plan();
    const addJobs = byKind(active, 'add_jobs')[0];
    await call(USER_A, 'PATCH', `/api/career-dna/plan/recommendations/${addJobs._id}`, { action: 'snooze', snoozeDays: 3 });
    assert.equal((await Recommendation.findById(addJobs._id)).status, 'snoozed');

    await refreshRecommendations(USER_A, new Date(Date.now() + 4 * DAY));
    assert.equal((await Recommendation.findById(addJobs._id)).status, 'suggested');

    await call(USER_A, 'PATCH', `/api/career-dna/plan/recommendations/${addJobs._id}`, { action: 'complete' });
    await call(USER_A, 'PATCH', `/api/career-dna/plan/recommendations/${addJobs._id}`, { action: 'reopen' });
    assert.equal((await Recommendation.findById(addJobs._id)).status, 'accepted', 'undoing "done" means still working on it');
    assert.equal((await call(USER_A, 'PATCH', `/api/career-dna/plan/recommendations/${addJobs._id}`, { action: 'delete' })).status, 400);
  });

  test('upcoming interviews get a preparation step tied to that job’s thin evidence', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', planProfile);
    const soon = await Application.create({ userId: USER_A, company: 'Acme', role: 'Frontend Engineer', stage: 'Interview', eventDate: new Date(Date.now() + 3 * DAY) });
    await Application.create({ userId: USER_A, company: 'Old Co', role: 'Dev', stage: 'Interview', eventDate: new Date(Date.now() - 20 * DAY) });
    await Application.create({ userId: USER_A, company: 'Closed', role: 'Dev', stage: 'Rejected' });
    const job = analyzeOpportunityFit(cleanJobExtraction({ requiredSkills: [{ name: 'React' }, { name: 'GraphQL' }, { name: 'Jest' }] }), null, []);
    await saveJob(['React', 'GraphQL', 'Jest'], { applicationId: soon._id, fitAnalysis: job });

    const prepare = byKind((await plan()).active, 'prepare');
    assert.equal(prepare.length, 1, 'only the upcoming interview, not the past one or the rejection');
    assert.match(prepare[0].title, /^Prepare for your Acme interview on /);
    assert.equal(prepare[0].priority, 'high');
    assert.match(prepare[0].completionCondition, /GraphQL/);
  });

  test('other accounts can’t see or change your recommendations', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', planProfile);
    const { active } = await plan();
    assert.equal((await plan(USER_B)).active.some((r) => String(r._id) === String(active[0]._id)), false);
    assert.equal((await call(USER_B, 'PATCH', `/api/career-dna/plan/recommendations/${active[0]._id}`, { action: 'dismiss' })).status, 404);
  });
});

describe('action plan: interview notes', () => {
  const interviewApp = (company, extra = {}) => Application.create({ userId: USER_A, company, role: 'Frontend Engineer', stage: 'Interview', ...extra });
  const notesPath = (app) => `/api/career-dna/plan/interviews/${app._id}`;

  test('notes are optional, only for your own applications, and saving twice updates them', async () => {
    const app = await interviewApp('Acme');
    assert.equal((await call(USER_A, 'PUT', notesPath(app), {})).status, 400, 'nothing to save');
    assert.equal((await call(USER_B, 'PUT', notesPath(app), { topics: ['React'] })).status, 404, 'someone else’s application');

    await call(USER_A, 'PUT', notesPath(app), { topics: ['React', 'react', 'System design'], practiceAreas: ['System design'] });
    await call(USER_A, 'PUT', notesPath(app), { topics: ['React'], feedback: 'Strong on React, wanted more on scaling', practiceAreas: ['System design'] });
    const notes = await InterviewReflection.find({ userId: USER_A }).lean();
    assert.equal(notes.length, 1);
    assert.deepEqual(notes[0].topics, ['React']);
    assert.equal(notes[0].company, 'Acme');
  });

  test('only areas the user flags become practice tasks; recurring topics show their sample size', async () => {
    const a = await interviewApp('Acme');
    const b = await interviewApp('Globex');
    const rejected = await interviewApp('Initech', { stage: 'Rejected' });
    await call(USER_A, 'PUT', notesPath(a), { topics: ['System design', 'React hooks'], practiceAreas: ['System design'] });
    await call(USER_A, 'PUT', notesPath(b), { topics: ['System design'], practiceAreas: ['System design'] });
    await call(USER_A, 'PUT', notesPath(rejected), { topics: ['Algorithms'] });

    const { active } = (await call(USER_A, 'GET', '/api/career-dna/plan/recommendations')).body;
    const practice = active.filter((r) => r.kind === 'practice');
    assert.deepEqual(practice.map((r) => r.title), ['Practise System design']);
    assert.match(practice[0].why, /after 2 interviews \(Acme, Globex\)/);

    const overview = (await call(USER_A, 'GET', '/api/career-dna/plan/interviews')).body;
    assert.deepEqual(overview.recurringTopics.map((t) => [t.topic, t.count, t.outOf]), [['System design', 2, 3]]);
  });

  test('deleting the application keeps the notes; deleting Career DNA removes all plan data', async () => {
    const app = await interviewApp('Acme');
    await call(USER_A, 'PUT', notesPath(app), { topics: ['React'], practiceAreas: ['Testing'] });
    await call(USER_A, 'DELETE', `/api/applications/${app._id}`);
    const kept = await InterviewReflection.findOne({ userId: USER_A }).lean();
    assert.equal(kept.applicationId, null);
    assert.equal(kept.company, 'Acme');

    await call(USER_A, 'PUT', '/api/career-dna', { headline: 'Dev' });
    await call(USER_A, 'GET', '/api/career-dna/plan/recommendations');
    await call(USER_A, 'POST', '/api/career-dna/plan/experiments', {
      hypothesis: 'h', action: 'a', metric: 'response_rate', comparison: 'before_after', startDate: '2026-01-01', endDate: '2026-01-15',
    });
    const res = await call(USER_A, 'DELETE', '/api/career-dna');
    assert.ok(res.body.deleted.recommendations > 0 && res.body.deleted.interviewNotes === 1 && res.body.deleted.experiments === 1);
    for (const model of [Recommendation, InterviewReflection, Experiment]) assert.equal(await model.countDocuments({ userId: USER_A }), 0);
  });
});

describe('action plan: experiments', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const start = new Date('2026-03-01');
  const end = new Date('2026-03-15');
  const base = { hypothesis: 'Tailored resumes get more replies', action: 'Tailor every resume', metric: 'response_rate', startDate: start, endDate: end };
  const experimentsPath = '/api/career-dna/plan/experiments';

  // `count` applications started on `day`, `replied` of which heard back.
  async function seedApplications(day, count, replied, platform = 'LinkedIn') {
    for (let i = 0; i < count; i++) {
      const app = await Application.create({ userId: USER_A, company: `Co ${day.getTime()}-${i}-${platform}`, stage: 'Applied', platform, firstEmailAt: day });
      if (i < replied) await StageHistory.create({ applicationId: app._id, fromStage: 'Applied', toStage: 'Rejected', changedBy: 'ai' });
    }
  }

  test('input is validated, and a retried request doesn’t create a second experiment', async () => {
    const bad = [
      { ...base, comparison: 'before_after', metric: 'happiness' },
      { ...base, comparison: 'before_after', endDate: start },
      { ...base, comparison: 'before_after', endDate: new Date(start.getTime() + 120 * DAY) },
      { ...base, comparison: 'platforms', platforms: ['referral'] },
      { ...base, comparison: 'before_after', hypothesis: '' },
    ];
    for (const body of bad) assert.equal((await call(USER_A, 'POST', experimentsPath, body)).status, 400, JSON.stringify(body));

    const body = { ...base, comparison: 'before_after', startDate: new Date(Date.now() - 5 * DAY), endDate: new Date(Date.now() + 5 * DAY) };
    const first = await call(USER_A, 'POST', experimentsPath, body);
    const retry = await call(USER_A, 'POST', experimentsPath, body);
    assert.equal(first.status, 201);
    assert.equal(first.body._id, retry.body._id);
    assert.equal(await Experiment.countDocuments({ userId: USER_A }), 1);
  });

  test('small samples are called out instead of producing a conclusion', async () => {
    await seedApplications(new Date('2026-02-20'), 3, 1);
    await seedApplications(new Date('2026-03-05'), 4, 3);
    await call(USER_A, 'POST', experimentsPath, { ...base, comparison: 'before_after' });

    const [experiment] = (await call(USER_A, 'GET', experimentsPath)).body;
    assert.equal(experiment.status, 'finished', 'past its end date');
    assert.deepEqual(experiment.result.groups.map((g) => [g.label, g.applications, g.hits]), [['Before', 3, 1], ['During', 4, 3]]);
    assert.equal(experiment.result.conclusion, 'Not enough applications yet to say anything.');
    assert.ok(experiment.result.limitations.some((l) => /too few/.test(l)));
    assert.ok(experiment.result.limitations.some((l) => /isn’t a controlled test/.test(l)));
  });

  test('platform comparisons report a difference without claiming a cause, and results freeze when finished', async () => {
    const recent = new Date(Date.now() - 5 * DAY);
    await seedApplications(recent, 10, 6, 'referral');
    await seedApplications(recent, 10, 1, 'Naukri');
    const created = await call(USER_A, 'POST', experimentsPath, {
      ...base,
      template: 'referral_vs_portal',
      comparison: 'platforms',
      platforms: ['referral', 'Naukri'],
      startDate: new Date(Date.now() - 10 * DAY),
      endDate: new Date(Date.now() + 10 * DAY),
    });

    const live = (await call(USER_A, 'GET', experimentsPath)).body[0];
    assert.equal(live.status, 'active');
    assert.equal(live.result.conclusion, 'referral had a higher response rate (60% vs 10%). Worth noting, but not proof of cause.');

    const finished = await call(USER_A, 'PATCH', `${experimentsPath}/${created.body._id}`, { action: 'finish', observedOutcome: 'Referrals replied faster' });
    assert.equal(finished.body.status, 'finished');
    await seedApplications(recent, 10, 10, 'Naukri');
    const frozen = (await call(USER_A, 'GET', experimentsPath)).body[0];
    assert.deepEqual(frozen.result.groups.map((g) => g.applications), [10, 10], 'later applications don’t rewrite a finished result');
    assert.equal(frozen.observedOutcome, 'Referrals replied faster');
    assert.equal((await call(USER_A, 'PATCH', `${experimentsPath}/${created.body._id}`, { action: 'abandon' })).status, 400);
    assert.equal((await call(USER_B, 'DELETE', `${experimentsPath}/${created.body._id}`)).status, 404);
  });
});

describe('action plan: real-world data', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const plan = async () => (await call(USER_A, 'GET', '/api/career-dna/plan/recommendations')).body.active;

  test('a round imported from old emails isn’t treated as new, and undated rounds are capped', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', { headline: 'Dev' });
    // Imported today, but the assessment email itself is a month old.
    const old = await Application.create({ userId: USER_A, company: 'Old Co', stage: 'Assessment', lastEmailAt: new Date(Date.now() - 30 * DAY) });
    await StageHistory.create({ applicationId: old._id, fromStage: null, toStage: 'Assessment', changedBy: 'ai' });
    for (let i = 0; i < 5; i++) {
      await Application.create({ userId: USER_A, company: `Fresh ${i}`, stage: 'Interview', lastEmailAt: new Date(Date.now() - i * 60 * 60 * 1000) });
    }

    const prepare = (await plan()).filter((r) => r.kind === 'prepare');
    assert.deepEqual(prepare.map((r) => r.title), ['Prepare for your Fresh 0 interview', 'Prepare for your Fresh 1 interview', 'Prepare for your Fresh 2 interview']);
  });

  test('a skill job fit already credits from a role isn’t reported as missing', async () => {
    const profile = {
      headline: 'Frontend engineer',
      experience: [
        { role: 'Developer', company: 'Acme', startDate: '2022-01', endDate: 'Present', description: 'Shipped frontend features and design systems.', achievements: ['Designed batch APIs for reports'], source: 'user_input' },
      ],
      skills: [{ name: 'React', source: 'user_input' }],
    };
    await call(USER_A, 'PUT', '/api/career-dna', profile);
    const extraction = cleanJobExtraction({ requiredSkills: [{ name: 'Frontend Development' }, { name: 'Batch Job Development' }, { name: 'Kotlin' }] });
    const fit = analyzeOpportunityFit(extraction, sanitizeProfile(profile), []);
    for (let i = 0; i < 3; i++) {
      await JobOpportunity.create({ userId: USER_A, company: `C${i}`, role: 'R', rawJobDescription: 'x'.repeat(100), extractedRequirements: extraction, fitAnalysis: fit });
    }

    const active = await plan();
    assert.equal(active.some((r) => r.skill === 'Frontend Development'), false, 'job fit credits it fully from the role');
    const batch = active.find((r) => r.skill === 'Batch Job Development');
    assert.equal(batch.kind, 'show_evidence', 'related work is on the profile, so it is not a gap');
    assert.match(batch.why, /touches on related work/);
    assert.equal(active.find((r) => r.skill === 'Kotlin').kind, 'close_gap');
  });
});

describe('action plan: practice suggestions from interview notes', () => {
  const notes = {
    company: 'Acme',
    role: 'Frontend Engineer',
    topics: ['Server side rendering', 'what happens in a cms ssr or csr?'],
    difficultQuestions: ['how do you handle null values'],
    feedback: 'They explained that in a CMS, SSR is better, but I answered CSR.',
    practiceAreas: [],
  };

  test('suggestions are kept only when they quote the notes, and never invent a summary without feedback', () => {
    const raw = {
      feedbackSummary: 'The interviewer preferred SSR for a CMS.',
      themes: [
        { name: 'Rendering', fromNotes: ['Server side rendering', 'what happens in a cms ssr or csr?', 'Kubernetes'] },
        { name: 'Made up', fromNotes: ['Kubernetes'] },
      ],
      learningNeeds: [
        { area: 'SSR vs CSR', why: 'Came up in feedback', practice: 'Build one page both ways and compare.', basedOn: ['in a CMS, SSR is better'] },
        { area: 'Kubernetes', why: 'Invented', practice: 'Deploy a cluster.', basedOn: ['You struggled with Kubernetes'] },
        { area: 'ssr vs csr', why: 'Duplicate', practice: 'Again.', basedOn: ['Server side rendering'] },
        { area: 'Null handling', why: 'Hard question', practice: '', basedOn: ['how do you handle null values'] },
      ],
    };
    const cleaned = cleanInsights(raw, notes);
    assert.deepEqual(cleaned.themes, [{ name: 'Rendering', fromNotes: ['Server side rendering', 'what happens in a cms ssr or csr?'] }]);
    assert.deepEqual(cleaned.learningNeeds.map((n) => n.area), ['SSR vs CSR'], 'untraceable, duplicate and exercise-less needs are dropped');
    assert.equal(cleanInsights(raw, { ...notes, feedback: '' }).feedbackSummary, '');
    assert.equal(cleanInsights(null, notes), null);
  });

  test('saved suggestions are reused, cleared when the notes change, and turn into the practice task’s finish line', async () => {
    const app = await Application.create({ userId: USER_A, company: 'Acme', role: 'Frontend Engineer', stage: 'Interview' });
    const path = `/api/career-dna/plan/interviews/${app._id}`;
    const saved = (await call(USER_A, 'PUT', path, notes)).body;
    const need = { area: 'SSR vs CSR', why: 'Came up in feedback', practice: 'Build one page both ways and compare.', basedOn: ['Server side rendering'] };
    await InterviewReflection.updateOne(
      { _id: saved._id },
      { insights: { feedbackSummary: '', themes: [], learningNeeds: [need], notesHash: notesHash(notes), promptVersion: INSIGHTS_PROMPT_VERSION } }
    );

    const again = await call(USER_A, 'POST', `${path.replace(String(app._id), saved._id)}/suggestions`);
    assert.equal(again.status, 200);
    assert.equal(again.body.reused, true, 'unchanged notes don’t call the AI again');
    assert.equal((await call(USER_B, 'POST', `/api/career-dna/plan/interviews/${saved._id}/suggestions`)).status, 404);

    // Adding the suggested area to the practice list keeps the suggestions (practice areas aren't their input).
    await call(USER_A, 'PUT', path, { ...notes, practiceAreas: ['SSR vs CSR'] });
    assert.ok((await InterviewReflection.findById(saved._id)).insights);
    const { active } = (await call(USER_A, 'GET', '/api/career-dna/plan/recommendations')).body;
    const practice = active.find((r) => r.kind === 'practice');
    assert.equal(practice.completionCondition, 'Build one page both ways and compare. Then note how it went.');
    assert.match(practice.uncertainty, /suggested by AI/);

    // Changing what the suggestions were based on clears them.
    await call(USER_A, 'PUT', path, { ...notes, topics: ['Something else'], practiceAreas: ['SSR vs CSR'] });
    assert.equal((await InterviewReflection.findById(saved._id)).insights, undefined);
  });
});

describe('action plan: which interviews ask for notes', () => {
  test('an interview move that was undone doesn’t ask for notes; real interviews, offers and later rejections do', async () => {
    const card = async (company, stage, history) => {
      const app = await Application.create({ userId: USER_A, company, stage });
      for (const [fromStage, toStage] of history) await StageHistory.create({ applicationId: app._id, fromStage, toStage, changedBy: 'manual' });
      return app;
    };
    await card('Undone', 'Applied', [[null, 'Applied'], ['Applied', 'Interview'], ['Interview', 'Applied']]);
    await card('Back to test', 'Assessment', [[null, 'Applied'], ['Applied', 'Interview'], ['Interview', 'Assessment']]);
    await card('Current', 'Interview', [[null, 'Applied'], ['Applied', 'Interview']]);
    await card('Rejected after', 'Rejected', [[null, 'Applied'], ['Applied', 'Interview'], ['Interview', 'Rejected']]);
    await card('Rejected early', 'Rejected', [[null, 'Applied'], ['Applied', 'Rejected']]);
    await card('Offer', 'Offer', [[null, 'Offer']]);

    const { awaitingNotes } = (await call(USER_A, 'GET', '/api/career-dna/plan/interviews')).body;
    assert.deepEqual(awaitingNotes.map((a) => a.company).sort(), ['Current', 'Offer', 'Rejected after']);
  });
});

describe('action plan: practice priority and snoozing', () => {
  test('practice for an interview still in progress is high priority; a snoozed step leaves the active list', async () => {
    const ongoing = await Application.create({ userId: USER_A, company: 'Ongoing', stage: 'Interview' });
    const finished = await Application.create({ userId: USER_A, company: 'Finished', stage: 'Rejected' });
    await call(USER_A, 'PUT', `/api/career-dna/plan/interviews/${ongoing._id}`, { practiceAreas: ['System design'] });
    await call(USER_A, 'PUT', `/api/career-dna/plan/interviews/${finished._id}`, { practiceAreas: ['Algorithms'] });

    let { active, history } = (await call(USER_A, 'GET', '/api/career-dna/plan/recommendations')).body;
    const systemDesign = active.find((r) => r.title === 'Practise System design');
    assert.equal(systemDesign.priority, 'high');
    assert.ok(systemDesign.evidence.some((e) => /Still in progress: Ongoing/.test(e)));
    assert.equal(active.find((r) => r.title === 'Practise Algorithms').priority, 'medium');

    await call(USER_A, 'PATCH', `/api/career-dna/plan/recommendations/${systemDesign._id}`, { action: 'snooze' });
    ({ active, history } = (await call(USER_A, 'GET', '/api/career-dna/plan/recommendations')).body);
    assert.equal(active.some((r) => r._id === systemDesign._id), false);
    assert.equal(history.find((r) => r._id === systemDesign._id).status, 'snoozed');
  });
});

describe('action plan: user priority and done', () => {
  test('a priority the user sets survives recalculation, can be reset, and finished steps are listed as done', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', { headline: 'Dev' });
    const plan = async () => (await call(USER_A, 'GET', '/api/career-dna/plan/recommendations')).body;
    const setGoal = (await plan()).active.find((r) => r.kind === 'set_goal');
    const path = `/api/career-dna/plan/recommendations/${setGoal._id}`;
    assert.equal(setGoal.priority, 'medium');

    assert.equal((await call(USER_A, 'PATCH', path, { action: 'prioritize', priority: 'urgent' })).status, 400);
    await call(USER_A, 'PATCH', path, { action: 'prioritize', priority: 'high' });
    let mine = (await plan()).active.find((r) => r._id === setGoal._id);
    assert.equal(mine.priority, 'high', 'kept after the plan is recalculated');
    assert.equal(mine.suggestedPriority, 'medium');
    assert.equal(mine.status, 'suggested', 'changing priority isn’t a decision about the step');

    await call(USER_A, 'PATCH', path, { action: 'prioritize', priority: null });
    mine = (await plan()).active.find((r) => r._id === setGoal._id);
    assert.equal(mine.priority, 'medium');

    await call(USER_A, 'PATCH', path, { action: 'complete' });
    const after = await plan();
    assert.deepEqual(after.done.map((r) => r._id), [setGoal._id]);
    assert.equal(after.history.some((r) => r._id === setGoal._id), false);
    assert.equal((await call(USER_B, 'PATCH', path, { action: 'prioritize', priority: 'low' })).status, 404);
  });
});

describe('action plan: review fixes', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const plan = async () => (await call(USER_A, 'GET', '/api/career-dna/plan/recommendations')).body;
  const decide = (id, body) => call(USER_A, 'PATCH', `/api/career-dna/plan/recommendations/${id}`, body);

  test('undoing a step whose reason has gone keeps it instead of deleting it', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', { headline: 'Dev' });
    const { active } = await plan();
    const setGoal = active.find((r) => r.kind === 'set_goal');
    const addJobs = active.find((r) => r.kind === 'add_jobs');
    await decide(setGoal._id, { action: 'complete' });
    await decide(addJobs._id, { action: 'dismiss' });

    // Both reasons go away: a target role is set and jobs are saved.
    await call(USER_A, 'PUT', '/api/career-dna', { headline: 'Dev', goals: { primaryRole: 'Frontend Engineer' } });
    for (let i = 0; i < 3; i++) {
      await JobOpportunity.create({ userId: USER_A, company: `C${i}`, role: 'R', rawJobDescription: 'x'.repeat(100), extractedRequirements: { requiredSkills: [] } });
    }
    await decide(setGoal._id, { action: 'reopen' });
    await decide(addJobs._id, { action: 'reopen' });

    const after = await plan();
    const goal = after.active.find((r) => r._id === setGoal._id);
    assert.equal(goal.status, 'accepted', 'undoing "done" goes back to in progress');
    assert.equal(goal.reasonResolved, true);
    assert.equal(after.history.find((r) => r._id === addJobs._id).status, 'outdated', 'kept, not deleted');
  });

  test('two refreshes at once don’t fail on the same new suggestion', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', { headline: 'Dev' });
    await Recommendation.deleteMany({ userId: USER_A });
    await Promise.all([refreshRecommendations(USER_A), refreshRecommendations(USER_A), refreshRecommendations(USER_A)]);
    const keys = (await Recommendation.find({ userId: USER_A }).lean()).map((r) => r.key);
    assert.equal(keys.length, new Set(keys).size);
  });

  test('a decision made while a refresh is running isn’t overwritten', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', { headline: 'Dev' });
    const setGoal = (await plan()).active.find((r) => r.kind === 'set_goal');
    // A refresh that read the step as "suggested", then the user dismisses it before the refresh writes.
    const stale = await Recommendation.findById(setGoal._id).lean();
    await decide(setGoal._id, { action: 'dismiss' });
    await Recommendation.bulkWrite([
      { updateOne: { filter: { _id: stale._id, userId: USER_A, status: stale.status }, update: { $set: { status: 'suggested' } } } },
    ]);
    assert.equal((await Recommendation.findById(setGoal._id)).status, 'dismissed');
  });

  test('an interview whose date has passed isn’t something to prepare for', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', { headline: 'Dev' });
    // The interview was two days ago and nothing has arrived since.
    await Application.create({ userId: USER_A, company: 'Past', stage: 'Interview', eventDate: new Date(Date.now() - 2 * DAY), lastEmailAt: new Date(Date.now() - 5 * DAY) });
    assert.equal((await plan()).active.some((r) => r.kind === 'prepare'), false);
  });

  test('quotes from the feedback need at least three words', () => {
    const notes = { topics: ['Caching'], difficultQuestions: [], feedback: 'They wanted a concrete caching example.', practiceAreas: [] };
    const raw = {
      themes: [],
      learningNeeds: [
        { area: 'Fragment', practice: 'x', basedOn: ['the'] },
        { area: 'Short', practice: 'x', basedOn: ['concrete'] },
        { area: 'Phrase', practice: 'x', basedOn: ['a concrete caching example'] },
        { area: 'Line', practice: 'x', basedOn: ['Caching'] },
      ],
    };
    assert.deepEqual(cleanInsights(raw, notes).learningNeeds.map((n) => n.area), ['Phrase', 'Line']);
  });

  test('applications with older notes aren’t offered again, however many notes there are', async () => {
    const apps = [];
    for (let i = 0; i < 52; i++) apps.push(await Application.create({ userId: USER_A, company: `Co ${i}`, stage: 'Interview' }));
    for (const app of apps) {
      await InterviewReflection.create({ userId: USER_A, applicationId: app._id, company: app.company, topics: ['x'] });
    }
    const { awaitingNotes, reflections } = (await call(USER_A, 'GET', '/api/career-dna/plan/interviews')).body;
    assert.equal(reflections.length, 50, 'the list itself is still capped');
    assert.equal(awaitingNotes.length, 0);
  });

  test('saving brand-new notes twice at once keeps one set', async () => {
    const app = await Application.create({ userId: USER_A, company: 'Acme', stage: 'Interview' });
    const path = `/api/career-dna/plan/interviews/${app._id}`;
    const [first, second] = await Promise.all([call(USER_A, 'PUT', path, { topics: ['A'] }), call(USER_A, 'PUT', path, { topics: ['B'] })]);
    assert.deepEqual([first.status, second.status], [200, 200]);
    assert.equal(await InterviewReflection.countDocuments({ userId: USER_A, applicationId: app._id }), 1);
  });
});

describe('action plan: past interview dates', () => {
  const DAY = 24 * 60 * 60 * 1000;

  test('a past date from an earlier round doesn’t hide a newer round', async () => {
    await call(USER_A, 'PUT', '/api/career-dna', { headline: 'Dev' });
    // Interview date three weeks ago, but a new interview email arrived yesterday.
    await Application.create({ userId: USER_A, company: 'Next Round', stage: 'Interview', eventDate: new Date(Date.now() - 21 * DAY), lastEmailAt: new Date(Date.now() - DAY) });
    // Interview two days ago, and nothing newer since.
    await Application.create({ userId: USER_A, company: 'Over', stage: 'Interview', eventDate: new Date(Date.now() - 2 * DAY), lastEmailAt: new Date(Date.now() - 3 * DAY) });

    const { active } = (await call(USER_A, 'GET', '/api/career-dna/plan/recommendations')).body;
    assert.deepEqual(active.filter((r) => r.kind === 'prepare').map((r) => r.title), ['Prepare for your Next Round interview']);
  });
});
