import {
  IconEdit,
  IconUpload,
  IconTrash,
  IconExternalLink,
  IconCheck,
  IconBriefcase,
  IconSparkles,
} from '../Icons.jsx';
import CompletenessCard from './CompletenessCard.jsx';
import EvidenceEngineSection from './EvidenceEngineSection.jsx';

export default function CareerDnaOverview({
  profile,
  completeness,
  evidenceOverview = [],
  evidenceError,
  onRetryEvidence,
  onEdit,
  onReupload,
  onDelete,
  onToggleSkillConfirm,
  onInspectSkill,
  onRebuildEvidence,
  isRebuildingEvidence,
}) {
  if (!profile) return null;

  const {
    headline = '',
    summary = '',
    yearsOfExperience = null,
    links = {},
    goals = {},
    skills = [],
    experience = [],
    projects = [],
    education = [],
    certifications = [],
    achievements = [],
    inferredInterests = [],
  } = profile;
  const unconfirmed = skills.filter((s) => s.source === 'resume' && !s.isConfirmed).length;

  // Group skills by category
  const skillsByCategory = skills.reduce((acc, skill) => {
    const cat = skill.category || 'Technical';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(skill);
    return acc;
  }, {});

  const formatSalary = (salary) => {
    if (!salary || (!salary.min && !salary.max)) return null;
    const curr = salary.currency === 'INR' ? '₹' : salary.currency === 'USD' ? '$' : `${salary.currency} `;
    const period = salary.period === 'per_month' ? '/ mo' : '/ yr';
    if (salary.min && salary.max) {
      return `${curr}${salary.min.toLocaleString()} – ${curr}${salary.max.toLocaleString()} ${period}`;
    }
    return `${curr}${(salary.min || salary.max).toLocaleString()} ${period}`;
  };

  return (
    <div className="dna-overview-container">
      {/* Top Banner / Identity */}
      <div className="dna-identity-card">
        <div className="dna-identity-top">
          <div className="dna-identity-main">
            <div className="dna-identity-tag">
              <IconSparkles size={13} /> Career Identity
            </div>
            <h1 className="dna-headline">{headline || <span className="muted">Add a headline</span>}</h1>
            {summary && <p className="dna-summary">{summary}</p>}

            <div className="dna-meta-chips">
              {yearsOfExperience != null && (
                <span className="dna-meta-chip">
                  <IconBriefcase size={13} /> {yearsOfExperience} {yearsOfExperience === 1 ? 'year' : 'years'} experience
                </span>
              )}
              {goals.experienceLevel && (
                <span className="dna-meta-chip cap">{goals.experienceLevel} Level</span>
              )}
              {goals.employmentType && (
                <span className="dna-meta-chip cap">{goals.employmentType}</span>
              )}
              {goals.remotePreference && (
                <span className="dna-meta-chip cap">{goals.remotePreference}</span>
              )}
            </div>

            <div className="dna-social-links">
              {links.linkedin && (
                <a href={links.linkedin} target="_blank" rel="noreferrer" className="dna-link-badge">
                  LinkedIn <IconExternalLink size={12} />
                </a>
              )}
              {links.github && (
                <a href={links.github} target="_blank" rel="noreferrer" className="dna-link-badge">
                  GitHub <IconExternalLink size={12} />
                </a>
              )}
              {links.portfolio && (
                <a href={links.portfolio} target="_blank" rel="noreferrer" className="dna-link-badge">
                  Portfolio <IconExternalLink size={12} />
                </a>
              )}
            </div>
          </div>

          <div className="dna-overview-actions">
            <button type="button" className="btn btn-secondary" onClick={onEdit}>
              <IconEdit size={15} /> Edit Profile
            </button>
            <button type="button" className="btn btn-secondary" onClick={onReupload}>
              <IconUpload size={15} /> Update Resume
            </button>
            <button type="button" className="btn btn-ghost text-danger" aria-label="Delete Career DNA data" title="Delete Career DNA data" onClick={onDelete}>
              <IconTrash size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Completeness Card */}
      <CompletenessCard completeness={completeness} openQuestions={profile.missingOrAmbiguous} onEditSection={onEdit} />

      <EvidenceEngineSection
        evidenceOverview={evidenceOverview}
        error={evidenceError}
        onRetry={onRetryEvidence}
        onInspectSkill={onInspectSkill}
        onRebuildEvidence={onRebuildEvidence}
        isRebuilding={isRebuildingEvidence}
      />

      {/* Target Roles & Goals Section */}
      <div className="dna-section-card">
        <div className="dna-section-header">
          <h2 className="dna-section-title">Target Roles & Career Preferences</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <IconEdit size={13} /> Edit
          </button>
        </div>

        <div className="dna-goals-grid">
          <div className="dna-goal-block">
            <span className="dna-goal-label">Primary Target Role</span>
            <span className="dna-goal-val-highlight">
              {goals.primaryRole || <span className="muted">Not specified</span>}
            </span>
          </div>

          {goals.secondaryRoles?.length > 0 && (
            <div className="dna-goal-block">
              <span className="dna-goal-label">Secondary Roles</span>
              <div className="dna-pills-row">
                {goals.secondaryRoles.map((role, idx) => (
                  <span key={idx} className="dna-pill">
                    {role}
                  </span>
                ))}
              </div>
            </div>
          )}

          {goals.locations?.length > 0 && (
            <div className="dna-goal-block">
              <span className="dna-goal-label">Preferred Locations</span>
              <div className="dna-pills-row">
                {goals.locations.map((loc, idx) => (
                  <span key={idx} className="dna-pill">
                    {loc}
                  </span>
                ))}
              </div>
            </div>
          )}

          {formatSalary(goals.salary) && (
            <div className="dna-goal-block">
              <span className="dna-goal-label">Expected Compensation</span>
              <span className="dna-goal-val">{formatSalary(goals.salary)}</span>
            </div>
          )}

          {goals.skillsToImprove?.length > 0 && (
            <div className="dna-goal-block full-width">
              <span className="dna-goal-label">Priority Learning Goals</span>
              <div className="dna-pills-row">
                {goals.skillsToImprove.map((skill, idx) => (
                  <span key={idx} className="dna-pill pill-accent">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {goals.careerGoalsOrConstraints && (
            <div className="dna-goal-block full-width">
              <span className="dna-goal-label">Goals & Constraints</span>
              <p className="dna-goal-val muted">{goals.careerGoalsOrConstraints}</p>
            </div>
          )}
        </div>
      </div>

      {/* Skills Inventory */}
      <div className="dna-section-card">
        <div className="dna-section-header">
          <div>
            <h2 className="dna-section-title">Skills Inventory</h2>
            <p className="muted text-sm">
              {unconfirmed
                ? `${unconfirmed} skill${unconfirmed === 1 ? '' : 's'} from your resume still need your confirmation. Confirm only what you could discuss in an interview.`
                : 'Skills from your resume and the ones you added yourself.'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <IconEdit size={13} /> Manage Skills
          </button>
        </div>

        {Object.keys(skillsByCategory).length === 0 ? (
          <div className="muted text-sm">No skills listed yet. Click Manage Skills to add some.</div>
        ) : (
          <div className="dna-skills-categories">
            {Object.entries(skillsByCategory).map(([category, items]) => (
              <div key={category} className="dna-skill-group">
                <div className="dna-skill-cat-title">{category}</div>
                <div className="dna-skills-tag-cloud">
                  {items.map((skill) => (
                    <div
                      key={skill.name}
                      className={`dna-skill-chip ${skill.isConfirmed ? 'confirmed' : 'unconfirmed'}`}
                    >
                      <span className="dna-skill-name">{skill.name}</span>
                      <span className="dna-skill-source">
                        {skill.source !== 'resume' ? 'Added by you' : skill.isConfirmed ? 'Confirmed' : 'From resume · unconfirmed'}
                      </span>
                      {skill.source === 'resume' && (
                        <button
                          type="button"
                          className="dna-skill-toggle-btn"
                          aria-pressed={skill.isConfirmed}
                          aria-label={`${skill.isConfirmed ? 'Unconfirm' : 'Confirm'} ${skill.name}`}
                          title={skill.evidence ? `Resume: “${skill.evidence}”` : undefined}
                          onClick={() => onToggleSkillConfirm?.(skill.name)}
                        >
                          {skill.isConfirmed ? <IconCheck size={13} /> : '○'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Work Experience */}
      <div className="dna-section-card">
        <div className="dna-section-header">
          <h2 className="dna-section-title">Work Experience & Demonstrated Track Record</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <IconEdit size={13} /> Edit
          </button>
        </div>

        {experience.length === 0 ? (
          <div className="muted text-sm">No work experience listed yet.</div>
        ) : (
          <div className="dna-timeline">
            {experience.map((exp, idx) => (
              <div key={idx} className="dna-timeline-item">
                <div className="dna-timeline-dot" aria-hidden="true" />
                <div className="dna-timeline-content">
                  <div className="dna-exp-header">
                    <div>
                      <h3 className="dna-exp-role">{exp.role}</h3>
                      <div className="dna-exp-company">
                        {exp.company}
                        {exp.location && ` · ${exp.location}`}
                      </div>
                    </div>
                    <div className="dna-exp-dates">
                      {exp.startDate || 'Unknown'} – {exp.current ? 'Present' : exp.endDate || 'Unknown'}
                      {exp.current && <span className="dna-tag-pill success">Current</span>}
                      {exp.source === 'resume' && !exp.isConfirmed && <span className="dna-source-badge">From resume · unconfirmed</span>}
                    </div>
                  </div>

                  {exp.description && <p className="dna-exp-desc">{exp.description}</p>}

                  {exp.achievements?.length > 0 && (
                    <div className="dna-achievements-block">
                      <div className="dna-achieve-label">Key Achievements:</div>
                      <ul className="dna-bullet-list">
                        {exp.achievements.map((ach, aIdx) => (
                          <li key={aIdx}>{ach}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {exp.measurableOutcomes?.length > 0 && (
                    <div className="dna-outcomes-block">
                      <div className="dna-achieve-label">Measurable Outcomes:</div>
                      <div className="dna-outcomes-pills">
                        {exp.measurableOutcomes.map((metric, mIdx) => (
                          <span key={mIdx} className="dna-metric-pill">
                            {metric}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Projects */}
      <div className="dna-section-card">
        <div className="dna-section-header">
          <h2 className="dna-section-title">Notable Projects & Portfolios</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <IconEdit size={13} /> Edit
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="muted text-sm">No projects listed yet.</div>
        ) : (
          <div className="dna-projects-grid">
            {projects.map((proj, idx) => (
              <div key={idx} className="dna-project-card">
                <div className="dna-project-card-header">
                  <h3 className="dna-project-title">
                    {proj.title}
                    {proj.source === 'resume' && !proj.isConfirmed && <span className="dna-source-badge">From resume · unconfirmed</span>}
                  </h3>
                  {proj.link && (
                    <a href={proj.link} target="_blank" rel="noreferrer" className="dna-link-btn" title="View Project">
                      <IconExternalLink size={14} />
                    </a>
                  )}
                </div>
                {proj.role && <div className="dna-project-role">{proj.role}</div>}
                {proj.description && <p className="dna-project-desc">{proj.description}</p>}

                {proj.technologies?.length > 0 && (
                  <div className="dna-project-techs">
                    {proj.technologies.map((tech, tIdx) => (
                      <span key={tIdx} className="dna-pill">
                        {tech}
                      </span>
                    ))}
                  </div>
                )}

                {proj.outcomes?.length > 0 && (
                  <div className="dna-project-outcomes">
                    {proj.outcomes.map((out, oIdx) => (
                      <div key={oIdx} className="dna-outcome-bullet">
                        • {out}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Education */}
      <div className="dna-section-card">
        <div className="dna-section-header">
          <h2 className="dna-section-title">Education & Credentials</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            <IconEdit size={13} /> Edit
          </button>
        </div>

        {education.length === 0 ? (
          <div className="muted text-sm">No educational background listed yet.</div>
        ) : (
          <div className="dna-education-grid">
            {education.map((edu, idx) => (
              <div key={idx} className="dna-edu-card">
                <div className="dna-edu-degree">{edu.degree}</div>
                <div className="dna-edu-inst">{edu.institution}</div>
                {edu.fieldOfStudy && <div className="dna-edu-field">{edu.fieldOfStudy}</div>}
                {(edu.startYear || edu.endYear) && (
                  <div className="dna-edu-years muted text-sm">
                    {edu.startYear ? `${edu.startYear} – ` : ''}
                    {edu.endYear || 'Present'}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {(certifications.length > 0 || achievements.length > 0) && (
        <div className="dna-section-card">
          <div className="dna-section-header">
            <h2 className="dna-section-title">Certifications & achievements</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
              <IconEdit size={13} /> Edit
            </button>
          </div>
          <ul className="dna-bullet-list">
            {certifications.map((cert) => (
              <li key={`cert-${cert.name}`}>
                <strong>{cert.name}</strong>
                {cert.issuer && ` · ${cert.issuer}`}
                {cert.issueDate && ` · ${cert.issueDate}`}
              </li>
            ))}
            {achievements.map((item) => <li key={`ach-${item}`}>{item}</li>)}
          </ul>
        </div>
      )}

      {/* Inferred Career Interests */}
      {inferredInterests.length > 0 && (
        <div className="dna-section-card">
          <div className="dna-section-header">
            <div>
              <h2 className="dna-section-title">
                Inferred Career Interests <span className="dna-tag-pill">AI Inferred</span>
              </h2>
              <p className="muted text-sm">
                Guessed from your history, not stated by you. Confirm or dismiss them in Edit profile.
              </p>
            </div>
          </div>

          <div className="dna-interests-grid">
            {inferredInterests.map((item, idx) => (
              <div key={idx} className={`dna-interest-card ${item.confirmed ? 'confirmed' : ''}`}>
                <span className="dna-interest-text">{item.interest}</span>
                <span className={`dna-pill ${item.confirmed ? 'pill-success' : ''}`}>
                  {item.confirmed ? 'Confirmed by you' : 'AI guess'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
