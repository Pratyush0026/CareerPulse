import { useEffect, useId, useState } from 'react';
import { IconArrowLeft, IconCheck, IconSparkles, IconTrash, IconEdit, IconClose } from '../Icons.jsx';

const STATUSES = ['Strong evidence of match', 'Partial evidence', 'No evidence yet', 'Potential mismatch', 'Requires clarification'];

const STATUS_CLASS = {
  'Strong evidence of match': 'badge-strong',
  'Partial evidence': 'badge-partial',
  'No evidence yet': 'badge-missing',
  'Potential mismatch': 'badge-mismatch',
  'Requires clarification': 'badge-clarify',
};

const TIER_CLASS = {
  'Strong Fit': 'tier-strong',
  'Moderate Fit': 'tier-moderate',
  'Potential Match with Gaps': 'tier-gaps',
  'Significant Mismatch': 'tier-mismatch',
  'Limited Evidence': 'tier-neutral',
};

const FILTERS = [
  ['ALL', 'All', () => true],
  ['REQUIRED', 'Required', (m) => m.importance === 'required'],
  ['STRONG', 'Strong', (m, s) => s === 'Strong evidence of match'],
  ['PARTIAL', 'Partial', (m, s) => s === 'Partial evidence'],
  ['MISSING', 'No evidence yet', (m, s) => s === 'No evidence yet'],
  ['UNCLEAR', 'Unclear or mismatch', (m, s) => s === 'Requires clarification' || s === 'Potential mismatch'],
];

const effectiveStatus = (m) => (m.userOverride?.isOverridden && m.userOverride.userStatus ? m.userOverride.userStatus : m.matchStatus);
const percent = (value) => (value == null ? '–' : `${value}%`);

function CorrectionDialog({ match, onSave, onClose }) {
  const [status, setStatus] = useState(match.userOverride?.userStatus || match.matchStatus);
  const [note, setNote] = useState(match.userOverride?.userNote || '');
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), status: useId(), note: useId() };

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (payload) => {
    setSaving(true);
    try {
      await onSave(payload);
      onClose();
    } catch {
      // Error already shown; keep the dialog open.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save({ userStatus: status, userNote: note });
        }}
      >
        <div className="modal-head">
          <h2 id={ids.title}>Correct this requirement</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconClose size={18} /></button>
        </div>
        <p className="muted text-sm">
          <strong>{match.requirement}</strong> – CareerPulse said “{match.matchStatus}”. Your correction changes the score but not your profile.
        </p>
        <label htmlFor={ids.status}>Status</label>
        <select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value)} autoFocus>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label htmlFor={ids.note}>Why (optional)</label>
        <textarea id={ids.note} rows="2" maxLength={500} placeholder="e.g. Used it for two years at my last job" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="modal-actions">
          {match.userOverride?.isOverridden && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => save({ userStatus: null })}>Remove correction</button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save correction'}</button>
        </div>
      </form>
    </div>
  );
}

export default function JobFitAnalysisView({ job, onBack, onDelete, onOverrideMatch }) {
  const [filter, setFilter] = useState('ALL');
  const [editing, setEditing] = useState(null);

  const { company, role, createdAt, extractedRequirements: req = {}, fitAnalysis: fit = {} } = job;
  const matches = fit.requirementMatches ?? [];
  const breakdown = fit.scoringBreakdown ?? {};
  const insufficient = fit.fitTier === 'Insufficient Data';
  const [, , test] = FILTERS.find(([key]) => key === filter);
  const visible = matches.filter((m) => test(m, effectiveStatus(m)));

  return (
    <div className="job-fit-view">
      <div className="job-fit-header">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onBack}><IconArrowLeft size={14} /> All analyses</button>
        <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={onDelete}><IconTrash size={14} /> Delete</button>
      </div>

      <div className="job-hero-card">
        <div className="job-hero-info">
          <div className="job-hero-company">{company}</div>
          <h1 className="job-hero-title">{role}</h1>
          <div className="job-hero-meta">
            <span className="dna-pill">Seniority: {req.seniority || 'Not specified'}</span>
            {req.experienceYears?.text && <span className="dna-pill">{req.experienceYears.text}</span>}
            <span className="job-hero-date muted">Analysed {new Date(createdAt).toLocaleDateString('en-IN')}</span>
          </div>
        </div>

        <div className="job-score-box">
          <div className="job-score-header">
            <div className="job-score-circle">
              <span className="job-score-number">{insufficient ? '–' : `${fit.overallFitScore}%`}</span>
              <span className="job-score-label">Evidence coverage</span>
            </div>
            <div className="job-score-meta">
              <span className={`fit-tier-badge ${TIER_CLASS[fit.fitTier] ?? 'tier-neutral'}`}>{fit.fitTier}</span>
              <div className="job-score-subtext muted text-xs">
                {breakdown.matchedRequirementsCount ?? 0} of {breakdown.totalRequirementsCount ?? 0} requirements covered
              </div>
            </div>
          </div>
          <div className="job-score-breakdown">
            {[['Required', breakdown.requiredCoveragePercent, 'fill-required'], ['Nice to have', breakdown.preferredCoveragePercent, 'fill-preferred']].map(([label, value, cls]) => (
              <div key={label} className="score-meter-row">
                <div className="score-meter-labels"><span>{label}</span><strong>{percent(value)}</strong></div>
                <div className="score-meter-track"><div className={`score-meter-fill ${cls}`} style={{ width: `${value ?? 0}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="job-formula-note text-xs muted"><strong>How this is worked out:</strong> {fit.formulaExplanation}</p>
        </div>
      </div>

      <div className="job-highlights-grid">
        <div className="highlight-card card-strengths">
          <h3><IconCheck size={16} /> Backed by your profile</h3>
          {fit.strengths?.length ? (
            <ul className="highlight-list">{fit.strengths.slice(0, 6).map((s) => <li key={s}>{s}</li>)}</ul>
          ) : (
            <p className="muted text-sm">Nothing on your profile directly shows these requirements yet.</p>
          )}
        </div>
        <div className="highlight-card card-missing">
          <h3><IconSparkles size={16} /> Not on your profile yet</h3>
          <p className="highlight-subtitle muted text-xs">No evidence means it isn’t written down yet – not that you lack the skill.</p>
          {fit.missingEvidence?.length || fit.confirmedGaps?.length ? (
            <div className="missing-evidence-chips">
              {fit.missingEvidence?.map((s) => <span key={s} className="missing-skill-chip">{s}</span>)}
              {fit.confirmedGaps?.map((g) => <span key={`gap-${g}`} className="confirmed-gap-chip" title="A hard requirement your profile doesn’t meet">{g}</span>)}
            </div>
          ) : (
            <p className="muted text-sm">Every requirement has at least some evidence.</p>
          )}
        </div>
      </div>

      <section className="job-requirements-section">
        <div className="job-requirements-header">
          <div>
            <h2>Requirement by requirement</h2>
            <p className="muted text-sm">Each line shows what supports it on your profile. If something is wrong, correct it.</p>
          </div>
          <div className="evidence-filter-tabs" role="group" aria-label="Filter requirements">
            {FILTERS.map(([key, label, match]) => (
              <button key={key} type="button" aria-pressed={filter === key} className={`evidence-tab ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>
                {label} ({matches.filter((m) => match(m, effectiveStatus(m))).length})
              </button>
            ))}
          </div>
        </div>

        {!visible.length ? (
          <div className="dna-empty-box">No requirements in this group.</div>
        ) : (
          <div className="requirement-cards-grid">
            {visible.map((m) => {
              const status = effectiveStatus(m);
              return (
                <article key={m._id} className="requirement-match-card">
                  <div className="requirement-card-top">
                    <div className="requirement-name-wrap">
                      <div className="requirement-pills">
                        <span className={`dna-pill ${m.importance === 'required' ? 'pill-required' : 'pill-preferred'}`}>{m.importance === 'required' ? 'Required' : 'Nice to have'}</span>
                        <span className="dna-pill">{m.requirementType}</span>
                        <span className="dna-pill">Evidence: {m.evidenceQuality}</span>
                        {m.userOverride?.isOverridden && <span className="dna-pill pill-overridden">Corrected by you</span>}
                      </div>
                      <h4 className="requirement-title">{m.requirement}</h4>
                    </div>
                    <div className="requirement-status-wrap">
                      <span className={`fit-status-badge ${STATUS_CLASS[status]}`}>{status}</span>
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing(m)}><IconEdit size={12} /> Correct</button>
                    </div>
                  </div>

                  <div className="requirement-evidence-body">
                    {m.candidateEvidence?.length > 0 && (
                      <div className="evidence-proof-snippet">
                        <span className="evidence-proof-label">On your profile:</span>
                        <ul className="evidence-sources-list">{m.candidateEvidence.map((e) => <li key={e}>{e}</li>)}</ul>
                      </div>
                    )}
                    {m.missingOrUncertain && (
                      <div className="evidence-gap-snippet">
                        <span className="evidence-gap-label">Missing or unclear:</span>
                        <span className="evidence-gap-text">{m.missingOrUncertain}</span>
                      </div>
                    )}
                    {m.userOverride?.isOverridden && m.userOverride.userNote && (
                      <div className="user-override-note text-xs"><strong>Your note:</strong> {m.userOverride.userNote}</div>
                    )}
                    {m.recommendedNextStep && (
                      <div className="recommended-step-box">
                        <span className="step-label">Next step:</span>
                        <span className="step-text">{m.recommendedNextStep}</span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {(req.explicitConstraints?.length > 0 || req.ambiguousOrUnknown?.length > 0) && (
        <section className="dna-section-card">
          <h2 className="dna-section-title">Also in this job</h2>
          {req.explicitConstraints?.length > 0 && (
            <>
              <p className="muted text-sm">Conditions to check yourself:</p>
              <ul className="dna-bullet-list">{req.explicitConstraints.map((c) => <li key={c}>{c}</li>)}</ul>
            </>
          )}
          {req.ambiguousOrUnknown?.length > 0 && (
            <>
              <p className="muted text-sm">Vague requirements that weren’t scored:</p>
              <ul className="dna-bullet-list">{req.ambiguousOrUnknown.map((c) => <li key={c}>{c}</li>)}</ul>
            </>
          )}
        </section>
      )}

      {fit.tailoredRecommendations?.length > 0 && (
        <section className="job-tailoring-card">
          <div className="tailoring-header">
            <h3><IconSparkles size={16} /> What to put forward</h3>
            <p className="muted text-sm">Based only on what’s already on your profile – nothing is added or invented.</p>
          </div>
          <div className="tailoring-items-grid">
            {fit.tailoredRecommendations.map((rec) => (
              <div key={rec.section} className="tailoring-item-card">
                <div className="tailoring-section-title">{rec.section}</div>
                <blockquote className="tailoring-original">“{rec.originalSnippet}”</blockquote>
                <div className="tailoring-suggestion">{rec.suggestedEmphasis}</div>
                <div className="tailoring-rationale muted text-xs">{rec.rationale}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {editing && <CorrectionDialog match={editing} onClose={() => setEditing(null)} onSave={(payload) => onOverrideMatch(editing._id, payload)} />}
    </div>
  );
}
