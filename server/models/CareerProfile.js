import mongoose from 'mongoose';

const skillSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['Technical', 'Framework / Tool', 'Soft Skill', 'Domain', 'Other'],
      default: 'Technical',
    },
    source: { type: String, enum: ['resume', 'user_input'], default: 'user_input' },
    // Where the resume mentions it, so the user can judge the extraction.
    evidence: { type: String, default: '', trim: true },
    confidence: { type: Number, default: 1.0 },
    // Resume-extracted skills stay unconfirmed until the user confirms them.
    isConfirmed: { type: Boolean, default: false },
  },
  { _id: false }
);

const experienceSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, trim: true },
    company: { type: String, required: true, trim: true },
    location: { type: String, default: '', trim: true },
    startDate: { type: String, default: '', trim: true },
    endDate: { type: String, default: '', trim: true },
    current: { type: Boolean, default: false },
    description: { type: String, default: '' },
    achievements: [{ type: String, trim: true }],
    measurableOutcomes: [{ type: String, trim: true }],
    source: { type: String, enum: ['resume', 'user_input'], default: 'user_input' },
    confidence: { type: Number, default: 1.0 },
    isConfirmed: { type: Boolean, default: false },
  },
  { _id: false }
);

const educationSchema = new mongoose.Schema(
  {
    degree: { type: String, required: true, trim: true },
    institution: { type: String, required: true, trim: true },
    fieldOfStudy: { type: String, default: '', trim: true },
    startYear: { type: String, default: '', trim: true },
    endYear: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    role: { type: String, default: '', trim: true },
    description: { type: String, default: '' },
    technologies: [{ type: String, trim: true }],
    outcomes: [{ type: String, trim: true }],
    link: { type: String, default: '', trim: true },
    source: { type: String, enum: ['resume', 'user_input'], default: 'user_input' },
    isConfirmed: { type: Boolean, default: false },
  },
  { _id: false }
);

const certificationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    issuer: { type: String, default: '', trim: true },
    issueDate: { type: String, default: '', trim: true },
    credentialUrl: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const inferredInterestSchema = new mongoose.Schema(
  {
    interest: { type: String, required: true, trim: true },
    confidence: { type: Number, default: 0.8 },
    confirmed: { type: Boolean, default: false },
  },
  { _id: false }
);

const goalsSchema = new mongoose.Schema(
  {
    primaryRole: { type: String, default: '', trim: true },
    secondaryRoles: [{ type: String, trim: true }],
    locations: [{ type: String, trim: true }],
    // null means "not chosen yet" – never assume a preference for the user.
    remotePreference: { type: String, enum: ['remote', 'hybrid', 'onsite', 'flexible', null], default: null },
    salary: {
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      currency: { type: String, default: 'INR', trim: true },
      period: { type: String, enum: ['per_year', 'per_month'], default: 'per_year' },
    },
    experienceLevel: { type: String, enum: ['entry', 'mid', 'senior', 'lead', 'executive', null], default: null },
    employmentType: { type: String, enum: ['full-time', 'part-time', 'contract', 'internship', 'any', null], default: null },
    skillsToImprove: [{ type: String, trim: true }],
    careerGoalsOrConstraints: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const careerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    headline: { type: String, default: '', trim: true },
    summary: { type: String, default: '', trim: true },
    // null when the resume doesn't state it; never guessed.
    yearsOfExperience: { type: Number, min: 0, max: 60, default: null },
    experience: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    skills: { type: [skillSchema], default: [] },
    toolsAndFrameworks: [{ type: String, trim: true }],
    projects: { type: [projectSchema], default: [] },
    certifications: { type: [certificationSchema], default: [] },
    achievements: [{ type: String, trim: true }],
    links: {
      portfolio: { type: String, default: '', trim: true },
      github: { type: String, default: '', trim: true },
      linkedin: { type: String, default: '', trim: true },
    },
    inferredInterests: { type: [inferredInterestSchema], default: [] },
    missingOrAmbiguous: [{ type: String, trim: true }],
    goals: { type: goalsSchema, default: () => ({}) },
    completenessScore: { type: Number, default: 0 },
    completenessBreakdown: {
      identity: { type: Number, default: 0 },
      experience: { type: Number, default: 0 },
      skills: { type: Number, default: 0 },
      goals: { type: Number, default: 0 },
      projects: { type: Number, default: 0 },
    },
    // Which extraction produced the resume-derived parts, so later prompt changes can't be confused with old data.
    extraction: {
      schemaVersion: { type: Number, default: null },
      promptVersion: { type: String, default: null },
      extractedAt: { type: Date, default: null },
      fileType: { type: String, default: null },
    },
    version: { type: Number, default: 0 },
    lastEditedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export function computeCompleteness(profile) {
  const breakdown = {
    identity: 0,
    experience: 0,
    skills: 0,
    goals: 0,
    projects: 0,
  };

  if (!profile) return { score: 0, breakdown, missing: ['Create your profile to get started'] };

  // Identity (20 max)
  if (profile.headline?.trim()) breakdown.identity += 10;
  if (profile.links?.github?.trim() || profile.links?.linkedin?.trim() || profile.links?.portfolio?.trim()) {
    breakdown.identity += 10;
  }

  // Experience and Education (25 max)
  if (Array.isArray(profile.experience) && profile.experience.length > 0) breakdown.experience += 15;
  if (Array.isArray(profile.education) && profile.education.length > 0) breakdown.experience += 10;

  // Skills (25 max)
  const skillsCount = Array.isArray(profile.skills) ? profile.skills.length : 0;
  if (skillsCount >= 3) breakdown.skills += 15;
  if (skillsCount >= 6) breakdown.skills += 10;

  // Goals (20 max)
  if (profile.goals?.primaryRole?.trim()) breakdown.goals += 10;
  if (profile.goals?.locations?.length > 0 || profile.goals?.remotePreference) breakdown.goals += 5; // only counts once chosen
  if (profile.goals?.skillsToImprove?.length > 0 || profile.goals?.careerGoalsOrConstraints?.trim()) {
    breakdown.goals += 5;
  }

  // Projects (10 max)
  if (Array.isArray(profile.projects) && profile.projects.length > 0) breakdown.projects += 10;

  const score = Math.min(
    100,
    breakdown.identity + breakdown.experience + breakdown.skills + breakdown.goals + breakdown.projects
  );

  const missing = [];
  if (!profile.headline?.trim()) missing.push('Add a professional headline');
  if (!profile.links?.linkedin?.trim() && !profile.links?.github?.trim()) missing.push('Link your LinkedIn or GitHub profile');
  if (!profile.experience?.length) missing.push('Add your work experience');
  if (!profile.education?.length) missing.push('Add your educational background');
  if (skillsCount < 3) missing.push('List at least 3 core technical skills');
  if (!profile.goals?.primaryRole?.trim()) missing.push('Define your primary target job title');
  if (!profile.projects?.length) missing.push('Add at least one notable project');

  return { score, breakdown, missing };
}

export default mongoose.model('CareerProfile', careerProfileSchema);
