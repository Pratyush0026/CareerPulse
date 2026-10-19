import { useEffect, useId, useRef, useState } from 'react';
import { IconClose, IconPlus, IconTrash } from '../Icons.jsx';
import EvidenceLevelBadge from './EvidenceLevelBadge.jsx';

const TYPE_LABELS = {
  work_experience: 'Role',
  project: 'Project',
  resume_claim: 'Resume',
  user_declaration: 'Your confirmation',
  interview_feedback: 'Interview feedback',
  assessment: 'Assessment',
  other: 'Other',
};

// Assessments can't be added by hand – they only come from assessments taken in CareerPulse.
const ADDABLE_TYPES = [
  ['project', 'Project'],
  ['work_experience', 'Role'],
  ['interview_feedback', 'Interview feedback'],
  ['other', 'Other'],
];

export default function SkillEvidenceModal({ skillData, onClose, onAddEvidence, onSetStatus, onDeleteEvidence }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ evidenceType: 'project', sourceTitle: '', supportingContext: '' });
  const [submitting, setSubmitting] = useState(false);
  const closeRef = useRef(null);
  const ids = { type: useId(), title: useId(), context: useId(), heading: useId() };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { skill, category = 'Technical', level, summary, sourcesBreakdown = {}, evidence = [], jobDemand } = skillData;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.sourceTitle.trim()) return;
    setSubmitting(true);
    try {
      await onAddEvidence({ skillName: skill, category, ...form });
      setAdding(false);
      setForm({ evidenceType: 'project', sourceTitle: '', supportingContext: '' });
    } catch {
      // The page already showed the error; keep the form so nothing typed is lost.
    } finally {
      setSubmitting(false);
    }
  };

  const stats = [
    ['Roles', sourcesBreakdown.experience],
    ['Projects', sourcesBreakdown.projects],
    ['Resume', sourcesBreakdown.resume],
    ['Confirmed by you', sourcesBreakdown.userConfirmed],
    ['Marked wrong', sourcesBreakdown.rejected],
  ];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal evidence-modal-card" role="dialog" aria-modal="true" aria-labelledby={ids.heading} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="evidence-modal-badge-row">
              <span className="dna-pill">{category}</span>
              <EvidenceLevelBadge level={level} size="sm" />
            </div>
            <h2 id={ids.heading} className="evidence-modal-title">{skill}</h2>
            <p className="evidence-modal-summary">{summary}</p>
            {jobDemand?.jobCount > 0 && (
              <p className="muted text-sm">
                {jobDemand.requiredIn + jobDemand.preferredIn
                  ? `Asked for in ${jobDemand.requiredIn + jobDemand.preferredIn} of your ${jobDemand.jobCount} saved jobs (required in ${jobDemand.requiredIn}).`
                  : `None of your ${jobDemand.jobCount} saved jobs ask for it.`}
              </p>
            )}
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <IconClose size={18} />
          </button>
        </div>

        <div className="evidence-sources-bar">
          {stats.map(([label, value]) => (
            <div key={label} className="evidence-sources-stat">
              <span className="stat-label">{label}</span>
              <span className="stat-val">{value || 0}</span>
            </div>
          ))}
        </div>

        <div className="evidence-records-section">
          <div className="evidence-records-header">
            <h3>Where this comes from</h3>
            <button type="button" className="btn btn-secondary btn-sm" aria-expanded={adding} onClick={() => setAdding(!adding)}>
              <IconPlus size={14} /> {adding ? 'Cancel' : 'Add evidence'}
            </button>
          </div>

          {adding && (
            <form className="evidence-add-form" onSubmit={submit}>
              <div className="dna-form-row">
                <div className="dna-field flex-1">
                  <label htmlFor={ids.type}>Kind</label>
                  <select id={ids.type} value={form.evidenceType} onChange={(e) => setForm({ ...form, evidenceType: e.target.value })}>
                    {ADDABLE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div className="dna-field flex-2">
                  <label htmlFor={ids.title}>Title</label>
                  <input id={ids.title} type="text" required maxLength={160} placeholder="e.g. Payments dashboard at Acme" value={form.sourceTitle} onChange={(e) => setForm({ ...form, sourceTitle: e.target.value })} />
                </div>
              </div>
              <div className="dna-field">
                <label htmlFor={ids.context}>How you used {skill}</label>
                <textarea id={ids.context} rows="2" maxLength={1000} value={form.supportingContext} onChange={(e) => setForm({ ...form, supportingContext: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>{submitting ? 'Adding…' : 'Add evidence'}</button>
              </div>
            </form>
          )}

          {!evidence.length ? (
            <div className="dna-empty-box">No evidence for this skill yet.</div>
          ) : (
            <ul className="evidence-items-list">
              {evidence.map((item) => {
                const rejected = item.status === 'rejected';
                return (
                  <li key={item._id} className={`evidence-log-item ${rejected ? 'is-rejected' : item.isConfirmed ? 'is-confirmed' : 'is-unconfirmed'}`}>
                    <div className="evidence-item-top">
                      <div className="evidence-item-badges">
                        <span className="dna-pill type-pill">{TYPE_LABELS[item.evidenceType] ?? 'Other'}</span>
                        <span className="dna-pill status-pill">{item.origin === 'user' ? 'Added by you' : 'From your profile'}</span>
                        {rejected && <span className="dna-pill status-pill">Marked wrong</span>}
                      </div>
                      <div className="evidence-item-actions">
                        {item.origin === 'user' ? (
                          <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => onDeleteEvidence(item._id)}>
                            <IconTrash size={14} /> Delete
                          </button>
                        ) : item.evidenceType === 'user_declaration' ? (
                          <span className="text-xs muted">Change it in Edit profile</span>
                        ) : (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSetStatus(item._id, rejected ? 'active' : 'rejected')}>
                            {rejected ? 'Restore' : 'This is wrong'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="evidence-source-title">{item.sourceTitle}</div>
                    {item.supportingContext && <blockquote className="evidence-context-quote">“{item.supportingContext}”</blockquote>}
                    {item.notes && <div className="evidence-notes-text">Note: {item.notes}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
