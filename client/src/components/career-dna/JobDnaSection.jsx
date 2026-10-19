import { useCallback, useEffect, useId, useState } from 'react';
import { IconBriefcase, IconSparkles, IconTrash, IconLink, IconMail, IconExternalLink } from '../Icons.jsx';
import ApplicationPicker from './ApplicationPicker.jsx';
import JobFitAnalysisView from './JobFitAnalysisView.jsx';
import RequirementPatterns from './RequirementPatterns.jsx';
import { api } from '../../api.js';
import { gmailUrl } from '../../constants.js';

const MIN_CHARS = 80;
const EMPTY_FORM = { company: '', role: '', description: '', applicationId: '' };

const scoreLabel = (fit) => (!fit || fit.fitTier === 'Insufficient Data' ? '–' : `${fit.overallFitScore}%`);

export default function JobDnaSection({ notify, confirm, gmailAccount, refreshKey, profile, onEditProfile }) {
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [patterns, setPatterns] = useState(null);
  const [state, setState] = useState('loading');
  const [analyzing, setAnalyzing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const ids = { app: useId(), company: useId(), role: useId(), description: useId() };

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [jobList, appList, patternData] = await Promise.all([api.getAnalyzedJobs(), api.getTrackedApplications(), api.getRequirementPatterns()]);
      setJobs(jobList);
      setApplications(appList);
      setPatterns(patternData);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const pickApplication = (applicationId) => {
    const app = applications.find((a) => a._id === applicationId);
    setForm((f) => ({ ...f, applicationId, company: app?.company ?? f.company, role: app?.role ?? f.role }));
  };

  const analyze = async (e) => {
    e.preventDefault();
    setAnalyzing(true);
    try {
      const result = await api.analyzeJob({
        company: form.company,
        role: form.role,
        rawJobDescription: form.description,
        applicationId: form.applicationId || null,
      });
      setJobs((list) => [result, ...list.filter((j) => j._id !== result._id)]);
      api.getRequirementPatterns().then(setPatterns).catch(() => {});
      setSelected(result);
      setForm(EMPTY_FORM);
      notify?.(
        result.reused ? 'You analysed this description before, so the saved requirements were reused and the fit recalculated.' : 'Requirements extracted and compared with your profile.',
        'success',
        { title: 'Job analysed' }
      );
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Analysis failed' });
    } finally {
      setAnalyzing(false);
    }
  };

  const open = async (job) => {
    try {
      setSelected(await api.getJobDetail(job._id));
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t open analysis' });
    }
  };

  const remove = async (job) => {
    const ok = await confirm?.({
      title: 'Delete this analysis?',
      message: `${job.role} at ${job.company} and its fit breakdown will be removed.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.deleteAnalyzedJob(job._id);
      setJobs((list) => list.filter((j) => j._id !== job._id));
      if (selected?._id === job._id) setSelected(null);
      api.getRequirementPatterns().then(setPatterns).catch(() => {});
      notify?.('Analysis deleted.', 'info');
    } catch (err) {
      notify?.(err.message, 'error');
    }
  };

  // Throws on failure so the correction dialog stays open with what the user typed.
  const correct = async (matchId, payload) => {
    try {
      const updated = await api.overrideRequirementMatch(selected._id, { matchId, ...payload });
      setSelected(updated);
      setJobs((list) => list.map((j) => (j._id === updated._id ? { ...j, fitAnalysis: updated.fitAnalysis } : j)));
      notify?.(payload.userStatus ? 'Correction saved and the score recalculated.' : 'Correction removed.', 'success');
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t save correction' });
      throw err;
    }
  };

  if (selected) {
    return (
      <JobFitAnalysisView
        job={selected}
        onBack={() => setSelected(null)}
        onDelete={() => remove(selected)}
        onOverrideMatch={correct}
      />
    );
  }

  const tooShort = form.description.trim().length < MIN_CHARS;
  const linked = applications.find((app) => app._id === form.applicationId);
  const skillCount = profile?.skills?.length ?? 0;
  const workCount = (profile?.experience?.length ?? 0) + (profile?.projects?.length ?? 0);
  const thinProfile = skillCount < 3 || workCount === 0;

  return (
    <div className="job-dna-section">
      <section className="dna-section-card job-intake-card">
        <div className="dna-section-header">
          <div>
            <h2 className="dna-section-title"><IconSparkles size={18} /> Check your fit for a job</h2>
            <p className="muted text-sm">
              Paste a job description. Career DNA separates required from nice-to-have skills and shows, requirement by requirement, what on your profile supports each one.
            </p>
          </div>
        </div>

        {thinProfile && (
          <div className="alert" role="note">
            Your profile has {skillCount} skill{skillCount === 1 ? '' : 's'} and {workCount ? workCount : 'no'} roles or projects, so most requirements
            will show “No evidence yet”. That says more about what’s written down than about you.{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEditProfile}>Add to your profile</button>
          </div>
        )}

        <form className="job-intake-form" onSubmit={analyze}>
          <div className="dna-form-row">
            <div className="dna-field flex-1">
              <label htmlFor={ids.app}>Link to a tracked application (optional)</label>
              <ApplicationPicker id={ids.app} applications={applications} value={form.applicationId} onChange={pickApplication} />
              {(linked?.lastMessageId || linked?.link) && (
                <div className="app-picker-sources">
                  <span>Find the description:</span>
                  {linked.lastMessageId && (
                    <a href={gmailUrl(linked.lastMessageId, gmailAccount)} target="_blank" rel="noopener noreferrer">
                      <IconMail size={13} /> Email
                    </a>
                  )}
                  {linked.link && (
                    <a href={linked.link} target="_blank" rel="noopener noreferrer" title={linked.link}>
                      <IconExternalLink size={13} /> Link in the email
                    </a>
                  )}
                </div>
              )}
            </div>
            <div className="dna-field flex-1">
              <label htmlFor={ids.company}>Company</label>
              <input id={ids.company} type="text" maxLength={120} placeholder="e.g. Razorpay" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </div>
            <div className="dna-field flex-1">
              <label htmlFor={ids.role}>Role</label>
              <input id={ids.role} type="text" maxLength={120} placeholder="e.g. Frontend Engineer" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
            </div>
          </div>

          <div className="dna-field">
            <div className="job-desc-label-row">
              <label htmlFor={ids.description}>Job description</label>
              <span className="text-xs muted">{form.description.length.toLocaleString()} / 20,000 characters</span>
            </div>
            <textarea
              id={ids.description}
              rows="7"
              maxLength={20000}
              placeholder="Paste the full post, including responsibilities and requirements."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="job-intake-actions">
            <p className="text-xs muted job-intake-note">
              The description is sent to Google Gemini to read the requirements, then saved to your account. The comparison with your profile runs on CareerPulse.
            </p>
            <button type="submit" className="btn btn-primary" disabled={analyzing || tooShort}>
              {analyzing ? <><span className="spinner" /> Analysing…</> : <><IconSparkles size={16} /> Analyse fit</>}
            </button>
          </div>
        </form>
      </section>

      {state === 'ready' && <RequirementPatterns data={patterns} />}

      <section className="dna-section-card">
        <div className="dna-section-header">
          <div>
            <h2 className="dna-section-title"><IconBriefcase size={18} /> Saved analyses{state === 'ready' ? ` (${jobs.length})` : ''}</h2>
            <p className="muted text-sm">Scores update automatically when you change your profile or evidence.</p>
          </div>
        </div>

        {state === 'loading' && <div className="dna-empty-box">Loading saved analyses…</div>}
        {state === 'error' && (
          <div className="dna-empty-box" role="alert">
            Couldn’t load your saved analyses. <button type="button" className="btn btn-ghost btn-sm" onClick={load}>Try again</button>
          </div>
        )}
        {state === 'ready' && !jobs.length && <div className="dna-empty-box">Nothing analysed yet. Paste a job description above to start.</div>}

        {state === 'ready' && jobs.length > 0 && (
          <div className="analyzed-jobs-grid">
            {jobs.map((job) => {
              const fit = job.fitAnalysis;
              const required = fit?.scoringBreakdown?.requiredCoveragePercent;
              return (
                <article key={job._id} className="analyzed-job-card">
                  <div className="analyzed-job-top">
                    <div>
                      <div className="analyzed-job-company">{job.company}</div>
                      <h3 className="analyzed-job-role">{job.role}</h3>
                    </div>
                    <div className="analyzed-score-badge" title="Evidence coverage, not a hiring probability">
                      <span className="analyzed-score-num">{scoreLabel(fit)}</span>
                      <span className="analyzed-score-label">coverage</span>
                    </div>
                  </div>
                  <div className="analyzed-job-details">
                    <span className="dna-pill">{fit?.fitTier ?? 'Not analysed'}</span>
                    {job.applicationId?.stage && <span className="dna-pill pill-linked"><IconLink size={11} /> {job.applicationId.stage}</span>}
                    {required != null && <span className="text-xs muted">Required skills covered: {required}%</span>}
                  </div>
                  <div className="analyzed-job-footer">
                    <span className="text-xs muted">{new Date(job.createdAt).toLocaleDateString('en-IN')}</span>
                    <div className="analyzed-card-actions">
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => open(job)}>See breakdown</button>
                      <button type="button" className="icon-btn danger" aria-label={`Delete analysis for ${job.role}`} onClick={() => remove(job)}>
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
