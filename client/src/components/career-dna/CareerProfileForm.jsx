import { useId, useState } from 'react';
import { IconTrash, IconPlus, IconCheck } from '../Icons.jsx';

const SKILL_CATEGORIES = ['Technical', 'Framework / Tool', 'Soft Skill', 'Domain', 'Other'];

const lines = (value) => value.split('\n').map((v) => v.trim()).filter(Boolean);
const commas = (value) => value.split(',').map((v) => v.trim()).filter(Boolean);

function Field({ label, hint, className = '', children }) {
  const id = useId();
  return (
    <div className={`dna-field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

function TextField({ label, value, onChange, hint, className, multiline, rows = 2, ...rest }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) =>
        multiline ? (
          <textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
        ) : (
          <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
        )
      }
    </Field>
  );
}

function SelectField({ label, value, onChange, options, className }) {
  return (
    <Field label={label} className={className}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>{optionLabel}</option>
          ))}
        </select>
      )}
    </Field>
  );
}

const FromResume = ({ confirmed, onToggle }) => (
  <span className="dna-provenance">
    <span className={`dna-source-badge ${confirmed ? 'confirmed' : ''}`}>{confirmed ? 'Confirmed' : 'From resume · unconfirmed'}</span>
    <button type="button" className="btn btn-ghost btn-sm" aria-pressed={confirmed} onClick={onToggle}>
      {confirmed ? 'Unconfirm' : 'Confirm'}
    </button>
  </span>
);

function toFormState(data) {
  const goals = data.goals ?? {};
  return {
    headline: data.headline ?? '',
    summary: data.summary ?? '',
    yearsOfExperience: data.yearsOfExperience ?? '',
    links: { portfolio: '', github: '', linkedin: '', ...data.links },
    goals: {
      primaryRole: goals.primaryRole ?? '',
      secondaryRoles: (goals.secondaryRoles ?? []).join(', '),
      locations: (goals.locations ?? []).join(', '),
      remotePreference: goals.remotePreference ?? '',
      salaryMin: goals.salary?.min ?? '',
      salaryMax: goals.salary?.max ?? '',
      salaryCurrency: goals.salary?.currency ?? 'INR',
      salaryPeriod: goals.salary?.period ?? 'per_year',
      experienceLevel: goals.experienceLevel ?? '',
      employmentType: goals.employmentType ?? '',
      skillsToImprove: (goals.skillsToImprove ?? []).join(', '),
      careerGoalsOrConstraints: goals.careerGoalsOrConstraints ?? '',
    },
    skills: (data.skills ?? []).map((s) => ({
      name: s.name ?? '',
      category: s.category ?? 'Technical',
      source: s.source ?? 'user_input',
      evidence: s.evidence ?? '',
      isConfirmed: s.source === 'resume' ? s.isConfirmed === true : true,
    })),
    toolsAndFrameworks: (data.toolsAndFrameworks ?? []).join(', '),
    experience: (data.experience ?? []).map((e) => ({
      role: e.role ?? '',
      company: e.company ?? '',
      location: e.location ?? '',
      startDate: e.startDate ?? '',
      endDate: e.endDate ?? '',
      current: Boolean(e.current),
      description: e.description ?? '',
      achievements: (e.achievements ?? []).join('\n'),
      measurableOutcomes: (e.measurableOutcomes ?? []).join('\n'),
      source: e.source ?? 'user_input',
      isConfirmed: e.source === 'resume' ? e.isConfirmed === true : true,
    })),
    projects: (data.projects ?? []).map((p) => ({
      title: p.title ?? '',
      role: p.role ?? '',
      description: p.description ?? '',
      technologies: (p.technologies ?? []).join(', '),
      outcomes: (p.outcomes ?? []).join('\n'),
      link: p.link ?? '',
      source: p.source ?? 'user_input',
      isConfirmed: p.source === 'resume' ? p.isConfirmed === true : true,
    })),
    education: (data.education ?? []).map((e) => ({
      degree: e.degree ?? '',
      institution: e.institution ?? '',
      fieldOfStudy: e.fieldOfStudy ?? '',
      startYear: e.startYear ?? '',
      endYear: e.endYear ?? '',
    })),
    certifications: (data.certifications ?? []).map((c) => ({
      name: c.name ?? '',
      issuer: c.issuer ?? '',
      issueDate: c.issueDate ?? '',
      credentialUrl: c.credentialUrl ?? '',
    })),
    achievements: (data.achievements ?? []).join('\n'),
    inferredInterests: (data.inferredInterests ?? []).map((i) => ({ interest: i.interest ?? '', confidence: i.confidence, confirmed: Boolean(i.confirmed) })),
    missingOrAmbiguous: data.missingOrAmbiguous ?? [],
  };
}

function toPayload(form) {
  const { goals } = form;
  return {
    headline: form.headline,
    summary: form.summary,
    yearsOfExperience: form.yearsOfExperience === '' ? null : Number(form.yearsOfExperience),
    links: form.links,
    goals: {
      primaryRole: goals.primaryRole,
      secondaryRoles: commas(goals.secondaryRoles),
      locations: commas(goals.locations),
      remotePreference: goals.remotePreference || null,
      salary: {
        min: goals.salaryMin === '' ? null : Number(goals.salaryMin),
        max: goals.salaryMax === '' ? null : Number(goals.salaryMax),
        currency: goals.salaryCurrency,
        period: goals.salaryPeriod,
      },
      experienceLevel: goals.experienceLevel || null,
      employmentType: goals.employmentType || null,
      skillsToImprove: commas(goals.skillsToImprove),
      careerGoalsOrConstraints: goals.careerGoalsOrConstraints,
    },
    skills: form.skills,
    toolsAndFrameworks: commas(form.toolsAndFrameworks),
    experience: form.experience.map((e) => ({ ...e, achievements: lines(e.achievements), measurableOutcomes: lines(e.measurableOutcomes) })),
    projects: form.projects.map((p) => ({ ...p, technologies: commas(p.technologies), outcomes: lines(p.outcomes) })),
    education: form.education,
    certifications: form.certifications,
    achievements: lines(form.achievements),
    inferredInterests: form.inferredInterests,
    missingOrAmbiguous: form.missingOrAmbiguous,
  };
}

const EMPTY = {
  experience: { role: '', company: '', location: '', startDate: '', endDate: '', current: false, description: '', achievements: '', measurableOutcomes: '', source: 'user_input', isConfirmed: true },
  projects: { title: '', role: '', description: '', technologies: '', outcomes: '', link: '', source: 'user_input', isConfirmed: true },
  education: { degree: '', institution: '', fieldOfStudy: '', startYear: '', endYear: '' },
  certifications: { name: '', issuer: '', issueDate: '', credentialUrl: '' },
};

// On a long form, Enter in a text box shouldn't save half-finished work – only the Save buttons do.
const blockEnterSubmit = (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') e.preventDefault();
};

// Scrolling the page over a focused number box would quietly change it (300000 → 299982).
const keepValueOnScroll = (e) => e.currentTarget.blur();

/** mode: 'review' (fresh resume extraction), 'edit' or 'create'. */
export default function CareerProfileForm({ initialData = {}, mode = 'edit', onSave, onCancel, isSaving }) {
  const [form, setForm] = useState(() => toFormState(initialData));
  const [newSkill, setNewSkill] = useState({ name: '', category: 'Technical' });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setGoal = (key, value) => setForm((f) => ({ ...f, goals: { ...f.goals, [key]: value } }));
  const setItem = (list, index, patch) =>
    setForm((f) => ({ ...f, [list]: f[list].map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  const addItem = (list) => setForm((f) => ({ ...f, [list]: [...f[list], { ...EMPTY[list] }] }));
  const removeItem = (list, index) => setForm((f) => ({ ...f, [list]: f[list].filter((_, i) => i !== index) }));

  const unconfirmedSkills = form.skills.filter((s) => !s.isConfirmed).length;

  const addSkill = () => {
    const name = newSkill.name.trim();
    if (!name || form.skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
    set('skills', [...form.skills, { name, category: newSkill.category, source: 'user_input', evidence: '', isConfirmed: true }]);
    setNewSkill({ ...newSkill, name: '' });
  };

  const submit = (e) => {
    e.preventDefault();
    onSave(toPayload(form));
  };

  const title = { review: 'Review your extracted profile', create: 'Build your profile', edit: 'Edit your profile' }[mode];

  return (
    <form className="dna-form" onSubmit={submit} onKeyDown={blockEnterSubmit}>
      <div className="dna-form-header">
        <div>
          <h2>{title}</h2>
          <p className="muted">
            {mode === 'review'
              ? 'This is what the AI read from your resume. Nothing is saved until you click save – fix anything that’s wrong and confirm what’s right.'
              : 'Everything here is optional. The more you add, the more specific Career DNA can be.'}
          </p>
        </div>
      </div>

      {mode === 'review' && form.missingOrAmbiguous.length > 0 && (
        <div className="dna-form-card dna-review-gaps">
          <h3 className="dna-card-title">Things the AI couldn’t find or wasn’t sure about</h3>
          <ul>
            {form.missingOrAmbiguous.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      <div className="dna-form-card">
        <h3 className="dna-card-title">Career identity</h3>
        <div className="dna-form-row">
          <TextField className="flex-2" label="Professional headline" value={form.headline} onChange={(v) => set('headline', v)} placeholder="e.g. Frontend developer – React & TypeScript" maxLength={160} />
          <Field className="flex-1" label="Years of experience" hint="Leave blank if you’re not sure.">
            {(id) => (
              <input id={id} type="number" onWheel={keepValueOnScroll} min="0" max="60" step="0.5" value={form.yearsOfExperience} onChange={(e) => set('yearsOfExperience', e.target.value)} />
            )}
          </Field>
        </div>
        <TextField multiline rows={3} label="Summary" value={form.summary} onChange={(v) => set('summary', v)} maxLength={2000} />
        <div className="dna-form-row">
          {[['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['portfolio', 'Portfolio / website']].map(([key, label]) => (
            <TextField key={key} className="flex-1" label={label} value={form.links[key]} onChange={(v) => set('links', { ...form.links, [key]: v })} placeholder="https://" inputMode="url" />
          ))}
        </div>
      </div>

      <div className="dna-form-card">
        <h3 className="dna-card-title">Target roles & preferences</h3>
        <div className="dna-form-row">
          <TextField className="flex-2" label="Primary target role" value={form.goals.primaryRole} onChange={(v) => setGoal('primaryRole', v)} placeholder="e.g. Frontend Engineer" />
          <TextField className="flex-2" label="Other roles you’d consider" hint="Separate with commas." value={form.goals.secondaryRoles} onChange={(v) => setGoal('secondaryRoles', v)} />
        </div>
        <div className="dna-form-row">
          <TextField className="flex-2" label="Preferred locations" hint="Separate with commas." value={form.goals.locations} onChange={(v) => setGoal('locations', v)} placeholder="e.g. Bengaluru, Pune" />
          <SelectField className="flex-1" label="Work setup" value={form.goals.remotePreference} onChange={(v) => setGoal('remotePreference', v)}
            options={[['', 'Not set'], ['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'On-site'], ['flexible', 'Flexible']]} />
          <SelectField className="flex-1" label="Level you’re targeting" value={form.goals.experienceLevel} onChange={(v) => setGoal('experienceLevel', v)}
            options={[['', 'Not set'], ['entry', 'Entry'], ['mid', 'Mid'], ['senior', 'Senior'], ['lead', 'Lead / Staff'], ['executive', 'Executive']]} />
          <SelectField className="flex-1" label="Employment type" value={form.goals.employmentType} onChange={(v) => setGoal('employmentType', v)}
            options={[['', 'Not set'], ['full-time', 'Full-time'], ['part-time', 'Part-time'], ['contract', 'Contract'], ['internship', 'Internship'], ['any', 'Any']]} />
        </div>
        <div className="dna-form-row">
          <Field className="flex-1" label="Expected salary – from">
            {(id) => <input id={id} type="number" onWheel={keepValueOnScroll} min="0" value={form.goals.salaryMin} onChange={(e) => setGoal('salaryMin', e.target.value)} />}
          </Field>
          <Field className="flex-1" label="to">
            {(id) => <input id={id} type="number" onWheel={keepValueOnScroll} min="0" value={form.goals.salaryMax} onChange={(e) => setGoal('salaryMax', e.target.value)} />}
          </Field>
          <SelectField className="flex-1" label="Currency" value={form.goals.salaryCurrency} onChange={(v) => setGoal('salaryCurrency', v)}
            options={[['INR', 'INR (₹)'], ['USD', 'USD ($)'], ['EUR', 'EUR (€)'], ['GBP', 'GBP (£)']]} />
          <SelectField className="flex-1" label="Per" value={form.goals.salaryPeriod} onChange={(v) => setGoal('salaryPeriod', v)}
            options={[['per_year', 'Year'], ['per_month', 'Month']]} />
        </div>
        <TextField label="Skills you want to get better at" hint="Separate with commas." value={form.goals.skillsToImprove} onChange={(v) => setGoal('skillsToImprove', v)} />
        <TextField multiline label="Goals or constraints" hint="Anything that shapes your search – notice period, relocation, visa, timeline…" value={form.goals.careerGoalsOrConstraints} onChange={(v) => setGoal('careerGoalsOrConstraints', v)} maxLength={2000} />
      </div>

      <div className="dna-form-card">
        <div className="dna-card-header-action">
          <h3 className="dna-card-title">Skills</h3>
          {unconfirmedSkills > 0 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set('skills', form.skills.map((s) => ({ ...s, isConfirmed: true })))}>
              <IconCheck size={14} /> Confirm all {unconfirmedSkills}
            </button>
          )}
        </div>
        <p className="muted text-sm">
          Skills read from your resume stay <strong>unconfirmed</strong> until you confirm them. Only confirm what you’d be comfortable discussing in an interview.
        </p>

        <div className="dna-add-skill-row">
          <input
            type="text"
            aria-label="New skill"
            placeholder="Add a skill, e.g. GraphQL"
            value={newSkill.name}
            onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSkill();
              }
            }}
          />
          <select aria-label="Skill category" value={newSkill.category} onChange={(e) => setNewSkill({ ...newSkill, category: e.target.value })}>
            {SKILL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button type="button" className="btn btn-secondary" onClick={addSkill}>
            <IconPlus size={15} /> Add
          </button>
        </div>

        <div className="dna-skills-tag-cloud">
          {form.skills.map((skill, i) => (
            <div key={skill.name} className={`dna-skill-chip ${skill.isConfirmed ? 'confirmed' : 'unconfirmed'}`} title={skill.evidence ? `Resume: “${skill.evidence}”` : undefined}>
              <span className="dna-skill-name">{skill.name}</span>
              <span className="dna-skill-cat">{skill.source === 'resume' ? (skill.isConfirmed ? 'confirmed' : 'from resume') : 'added by you'}</span>
              {skill.source === 'resume' && (
                <button
                  type="button"
                  className="dna-skill-toggle-btn"
                  aria-pressed={skill.isConfirmed}
                  aria-label={`${skill.isConfirmed ? 'Unconfirm' : 'Confirm'} ${skill.name}`}
                  onClick={() => setItem('skills', i, { isConfirmed: !skill.isConfirmed })}
                >
                  {skill.isConfirmed ? <IconCheck size={13} /> : '○'}
                </button>
              )}
              <button type="button" className="dna-skill-del-btn" aria-label={`Remove ${skill.name}`} onClick={() => removeItem('skills', i)}>×</button>
            </div>
          ))}
          {!form.skills.length && <div className="muted text-sm">No skills yet.</div>}
        </div>

        <TextField label="Other tools & frameworks" hint="Separate with commas." value={form.toolsAndFrameworks} onChange={(v) => set('toolsAndFrameworks', v)} />
      </div>

      <div className="dna-form-card">
        <div className="dna-card-header-action">
          <h3 className="dna-card-title">Work experience</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => addItem('experience')}><IconPlus size={14} /> Add role</button>
        </div>
        <div className="dna-sub-list">
          {form.experience.map((exp, i) => (
            <div key={i} className="dna-sub-card">
              <div className="dna-sub-card-header">
                <span className="dna-sub-card-index">{exp.role || exp.company ? `${exp.role || 'Role'} · ${exp.company || 'Company'}` : `Role ${i + 1}`}</span>
                <span className="dna-sub-card-tools">
                  {exp.source === 'resume' && <FromResume confirmed={exp.isConfirmed} onToggle={() => setItem('experience', i, { isConfirmed: !exp.isConfirmed })} />}
                  <button type="button" className="icon-btn danger" aria-label="Remove role" onClick={() => removeItem('experience', i)}><IconTrash size={16} /></button>
                </span>
              </div>
              <div className="dna-form-row">
                <TextField className="flex-2" label="Role" value={exp.role} onChange={(v) => setItem('experience', i, { role: v })} />
                <TextField className="flex-2" label="Company" value={exp.company} onChange={(v) => setItem('experience', i, { company: v })} />
                <TextField className="flex-1" label="Location" value={exp.location} onChange={(v) => setItem('experience', i, { location: v })} />
              </div>
              <div className="dna-form-row">
                <TextField className="flex-1" label="Start" value={exp.startDate} onChange={(v) => setItem('experience', i, { startDate: v })} placeholder="e.g. Mar 2022" />
                <TextField className="flex-1" label="End" value={exp.current ? '' : exp.endDate} disabled={exp.current} onChange={(v) => setItem('experience', i, { endDate: v })} placeholder={exp.current ? 'Present' : 'e.g. Jan 2024'} />
                <div className="dna-field flex-1 dna-checkbox-field">
                  <label className="dna-checkbox-label">
                    <input type="checkbox" checked={exp.current} onChange={(e) => setItem('experience', i, { current: e.target.checked, endDate: '' })} />
                    I work here now
                  </label>
                </div>
              </div>
              <TextField multiline label="What you did" value={exp.description} onChange={(v) => setItem('experience', i, { description: v })} />
              <TextField multiline label="Achievements" hint="One per line." value={exp.achievements} onChange={(v) => setItem('experience', i, { achievements: v })} />
              <TextField multiline label="Measurable results" hint="One per line – only numbers you can back up." value={exp.measurableOutcomes} onChange={(v) => setItem('experience', i, { measurableOutcomes: v })} />
            </div>
          ))}
          {!form.experience.length && <div className="muted text-sm">No roles yet.</div>}
        </div>
      </div>

      <div className="dna-form-card">
        <div className="dna-card-header-action">
          <h3 className="dna-card-title">Projects</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => addItem('projects')}><IconPlus size={14} /> Add project</button>
        </div>
        <div className="dna-sub-list">
          {form.projects.map((project, i) => (
            <div key={i} className="dna-sub-card">
              <div className="dna-sub-card-header">
                <span className="dna-sub-card-index">{project.title || `Project ${i + 1}`}</span>
                <span className="dna-sub-card-tools">
                  {project.source === 'resume' && <FromResume confirmed={project.isConfirmed} onToggle={() => setItem('projects', i, { isConfirmed: !project.isConfirmed })} />}
                  <button type="button" className="icon-btn danger" aria-label="Remove project" onClick={() => removeItem('projects', i)}><IconTrash size={16} /></button>
                </span>
              </div>
              <div className="dna-form-row">
                <TextField className="flex-2" label="Title" value={project.title} onChange={(v) => setItem('projects', i, { title: v })} />
                <TextField className="flex-1" label="Your role" value={project.role} onChange={(v) => setItem('projects', i, { role: v })} />
                <TextField className="flex-2" label="Link" value={project.link} onChange={(v) => setItem('projects', i, { link: v })} placeholder="https://" inputMode="url" />
              </div>
              <TextField label="Technologies" hint="Separate with commas." value={project.technologies} onChange={(v) => setItem('projects', i, { technologies: v })} />
              <TextField multiline label="Description" value={project.description} onChange={(v) => setItem('projects', i, { description: v })} />
              <TextField multiline label="Outcomes" hint="One per line." value={project.outcomes} onChange={(v) => setItem('projects', i, { outcomes: v })} />
            </div>
          ))}
          {!form.projects.length && <div className="muted text-sm">No projects yet.</div>}
        </div>
      </div>

      <div className="dna-form-card">
        <div className="dna-card-header-action">
          <h3 className="dna-card-title">Education</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => addItem('education')}><IconPlus size={14} /> Add education</button>
        </div>
        <div className="dna-sub-list">
          {form.education.map((edu, i) => (
            <div key={i} className="dna-sub-card">
              <div className="dna-sub-card-header">
                <span className="dna-sub-card-index">{edu.degree || `Education ${i + 1}`}</span>
                <button type="button" className="icon-btn danger" aria-label="Remove education" onClick={() => removeItem('education', i)}><IconTrash size={16} /></button>
              </div>
              <div className="dna-form-row">
                <TextField className="flex-2" label="Degree" value={edu.degree} onChange={(v) => setItem('education', i, { degree: v })} />
                <TextField className="flex-2" label="Institution" value={edu.institution} onChange={(v) => setItem('education', i, { institution: v })} />
              </div>
              <div className="dna-form-row">
                <TextField className="flex-2" label="Field of study" value={edu.fieldOfStudy} onChange={(v) => setItem('education', i, { fieldOfStudy: v })} />
                <TextField className="flex-1" label="Start year" value={edu.startYear} onChange={(v) => setItem('education', i, { startYear: v })} />
                <TextField className="flex-1" label="End year" value={edu.endYear} onChange={(v) => setItem('education', i, { endYear: v })} />
              </div>
            </div>
          ))}
          {!form.education.length && <div className="muted text-sm">No education yet.</div>}
        </div>
      </div>

      <div className="dna-form-card">
        <div className="dna-card-header-action">
          <h3 className="dna-card-title">Certifications & achievements</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => addItem('certifications')}><IconPlus size={14} /> Add certification</button>
        </div>
        <div className="dna-sub-list">
          {form.certifications.map((cert, i) => (
            <div key={i} className="dna-sub-card">
              <div className="dna-form-row">
                <TextField className="flex-2" label="Certification" value={cert.name} onChange={(v) => setItem('certifications', i, { name: v })} />
                <TextField className="flex-1" label="Issuer" value={cert.issuer} onChange={(v) => setItem('certifications', i, { issuer: v })} />
                <TextField className="flex-1" label="Date" value={cert.issueDate} onChange={(v) => setItem('certifications', i, { issueDate: v })} />
                <button type="button" className="icon-btn danger dna-inline-remove" aria-label="Remove certification" onClick={() => removeItem('certifications', i)}><IconTrash size={16} /></button>
              </div>
            </div>
          ))}
        </div>
        <TextField multiline label="Other achievements" hint="One per line – awards, competitions, publications." value={form.achievements} onChange={(v) => set('achievements', v)} />
      </div>

      {form.inferredInterests.length > 0 && (
        <div className="dna-form-card">
          <h3 className="dna-card-title">
            Interests the AI inferred <span className="dna-tag-pill">AI guess</span>
          </h3>
          <p className="muted text-sm">Guessed from your history – confirm only the ones that are true.</p>
          <div className="dna-interests-grid">
            {form.inferredInterests.map((item, i) => (
              <div key={item.interest} className={`dna-interest-card ${item.confirmed ? 'confirmed' : ''}`}>
                <span className="dna-interest-text">{item.interest}</span>
                <div className="dna-interest-actions">
                  <button type="button" className={`btn btn-sm ${item.confirmed ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={item.confirmed} onClick={() => setItem('inferredInterests', i, { confirmed: !item.confirmed })}>
                    {item.confirmed ? 'Confirmed' : 'Confirm'}
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Dismiss ${item.interest}`} onClick={() => removeItem('inferredInterests', i)}>×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticks to the bottom of the screen so saving never needs a scroll. */}
      <div className="dna-form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={isSaving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={isSaving}>
          {isSaving ? 'Saving…' : mode === 'review' ? 'Save reviewed profile' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}
