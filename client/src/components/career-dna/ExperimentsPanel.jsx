import { useEffect, useId, useState } from 'react';
import { IconClose, IconTrash } from '../Icons.jsx';
import { PLATFORMS, formatDate } from '../../constants.js';

const TEMPLATES = {
  tailored_resumes: {
    label: 'Tailor resumes',
    hypothesis: 'Tailoring my resume to each job gets more replies.',
    action: 'Tailor the resume for every application during the experiment.',
    metric: 'response_rate',
    comparison: 'before_after',
  },
  practice_topic: {
    label: 'Practise a recurring interview topic',
    hypothesis: 'Two weeks of practice on a topic that keeps coming up gets me further in interviews.',
    action: 'Practise the topic a few times a week.',
    metric: 'interview_rate',
    comparison: 'before_after',
  },
  referral_vs_portal: {
    label: 'Referrals vs job portals',
    hypothesis: 'Applications through a referral get more replies than portal applications.',
    action: 'Apply through both during the experiment.',
    metric: 'response_rate',
    comparison: 'platforms',
    platforms: ['referral', 'Naukri'],
  },
  skill_update: {
    label: 'After updating a skill',
    hypothesis: 'Showing a newly built skill on my resume gets more replies.',
    action: 'Update the resume with the new skill and keep applying as usual.',
    metric: 'response_rate',
    comparison: 'before_after',
  },
  custom: { label: 'Something else', hypothesis: '', action: '', metric: 'response_rate', comparison: 'before_after' },
};

const METRIC_LABEL = { response_rate: 'Response rate', interview_rate: 'Interview rate' };
const METRIC_HINT = {
  response_rate: 'Share of applications that heard back at all – a test, an interview, an offer or a rejection.',
  interview_rate: 'Share of applications that reached an interview or an offer.',
};
const HIT_LABEL = { response_rate: 'Heard back', interview_rate: 'Reached interview' };
const STATUS_LABEL = { active: 'Running', finished: 'Finished', abandoned: 'Stopped early' };
const CHOOSABLE_PLATFORMS = PLATFORMS.filter((p) => p !== 'unknown');

// The local calendar day. toISOString() gives the UTC one, which is yesterday before 5:30 am in India.
const isoDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (days) => isoDay(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

function ExperimentDialog({ onCreate, onClose }) {
  const ids = { title: useId(), template: useId(), hypothesis: useId(), action: useId(), metric: useId(), compare: useId(), start: useId(), end: useId() };
  const [form, setForm] = useState({ template: 'tailored_resumes', ...TEMPLATES.tailored_resumes, platforms: ['referral', 'Naukri'], startDate: inDays(0), endDate: inDays(14) });
  const [saving, setSaving] = useState(false);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickTemplate = (e) => {
    const { label, ...defaults } = TEMPLATES[e.target.value];
    setForm((f) => ({ ...f, ...defaults, platforms: defaults.platforms ?? f.platforms, template: e.target.value }));
  };
  const setPlatform = (index) => (e) => setForm((f) => ({ ...f, platforms: f.platforms.map((p, i) => (i === index ? e.target.value : p)) }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onCreate({ ...form, startDate: new Date(`${form.startDate}T00:00:00`), endDate: new Date(`${form.endDate}T23:59:59`) });
      onClose();
    } catch {
      // The error is shown as a toast; keep the form as it is.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal dna-modal" role="dialog" aria-modal="true" aria-labelledby={ids.title} onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2 id={ids.title}>Start an experiment</h2>
            <p className="muted text-sm">Try one change for a while and see what your own applications say.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconClose size={18} /></button>
        </div>

        <label htmlFor={ids.template}>Idea</label>
        <select id={ids.template} value={form.template} onChange={pickTemplate}>
          {Object.entries(TEMPLATES).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
        </select>
        <label htmlFor={ids.hypothesis}>What you expect</label>
        <input id={ids.hypothesis} maxLength={300} value={form.hypothesis} onChange={set('hypothesis')} required />
        <label htmlFor={ids.action}>What you’ll do</label>
        <textarea id={ids.action} rows="3" maxLength={500} value={form.action} onChange={set('action')} required />

        <div className="dna-form-row">
          <div className="dna-field flex-1">
            <label htmlFor={ids.metric}>Measure</label>
            <select id={ids.metric} value={form.metric} onChange={set('metric')}>
              {Object.entries(METRIC_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <div className="dna-field flex-1">
            <label htmlFor={ids.compare}>Compare</label>
            <select id={ids.compare} value={form.comparison} onChange={set('comparison')}>
              <option value="before_after">Before vs during</option>
              <option value="platforms">Two platforms</option>
            </select>
          </div>
        </div>
        <p className="text-xs muted">{METRIC_HINT[form.metric]}</p>

        {form.comparison === 'platforms' && (
          <div className="dna-form-row">
            {[0, 1].map((i) => (
              <div className="dna-field flex-1" key={i}>
                <label htmlFor={`${ids.compare}-${i}`}>{i === 0 ? 'Platform' : 'Against'}</label>
                <select id={`${ids.compare}-${i}`} value={form.platforms[i]} onChange={setPlatform(i)}>
                  {CHOOSABLE_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className="dna-form-row">
          <div className="dna-field flex-1">
            <label htmlFor={ids.start}>From</label>
            <input id={ids.start} type="date" value={form.startDate} onChange={set('startDate')} required />
          </div>
          <div className="dna-field flex-1">
            <label htmlFor={ids.end}>To</label>
            <input id={ids.end} type="date" value={form.endDate} onChange={set('endDate')} required />
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Starting…' : 'Start experiment'}</button>
        </div>
      </form>
    </div>
  );
}

function ExperimentCard({ experiment, onUpdate, onDelete }) {
  const [outcome, setOutcome] = useState(experiment.observedOutcome);
  const [busy, setBusy] = useState(false);
  const update = async (body) => {
    setBusy(true);
    try {
      await onUpdate(experiment, body);
    } finally {
      setBusy(false);
    }
  };
  const { result } = experiment;
  const ended = experiment.status !== 'active';

  return (
    <li className="experiment-card">
      <div className="experiment-head">
        <div>
          <h3 className="rec-title">{experiment.hypothesis}</h3>
          <div className="muted text-xs">
            {experiment.action} · {formatDate(experiment.startDate)} – {formatDate(experiment.endDate)} · {METRIC_LABEL[experiment.metric]}
          </div>
        </div>
        <span className={`dna-pill ${experiment.status === 'active' ? 'pill-success' : ''}`}>{STATUS_LABEL[experiment.status]}</span>
      </div>

      {result?.groups && (
        <>
          <table className="experiment-groups">
            <thead>
              <tr><th scope="col">Group</th><th scope="col">Applications</th><th scope="col">{HIT_LABEL[experiment.metric]}</th><th scope="col">Rate</th></tr>
            </thead>
            <tbody>
              {result.groups.map((g) => (
                <tr key={g.label}>
                  <th scope="row">{g.label}</th>
                  <td>{g.applications}</td>
                  <td>{g.hits}</td>
                  <td>{g.rate === null ? '–' : `${g.rate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="experiment-conclusion">{result.conclusion}</p>
          <ul className="experiment-limitations">
            {result.limitations.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </>
      )}

      {ended && (
        <div className="experiment-outcome">
          <label htmlFor={`outcome-${experiment._id}`} className="text-sm">What you noticed</label>
          <textarea id={`outcome-${experiment._id}`} rows="2" maxLength={1000} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </div>
      )}

      <div className="rec-actions">
        {experiment.status === 'active' && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => update({ action: 'finish' })}>Finish now</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => update({ action: 'abandon' })}>Stop without a result</button>
          </>
        )}
        {ended && outcome !== experiment.observedOutcome && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => update({ observedOutcome: outcome })}>Save note</button>
        )}
        <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => onDelete(experiment)}><IconTrash size={14} /> Delete</button>
      </div>
    </li>
  );
}

export default function ExperimentsPanel({ experiments, onCreate, onUpdate, onDelete }) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="plan-toolbar">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating(true)}>Start an experiment</button>
      </div>
      {experiments.length ? (
        <ul className="rec-list">
          {experiments.map((e) => <ExperimentCard key={e._id} experiment={e} onUpdate={onUpdate} onDelete={onDelete} />)}
        </ul>
      ) : (
        <div className="dna-empty-box">
          No experiments yet. Pick one change – like tailoring resumes or asking for referrals – and compare it with your own numbers.
        </div>
      )}
      {creating && <ExperimentDialog onCreate={onCreate} onClose={() => setCreating(false)} />}
    </>
  );
}
