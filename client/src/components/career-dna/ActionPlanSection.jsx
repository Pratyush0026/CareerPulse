import { useCallback, useEffect, useRef, useState } from 'react';
import { IconCheck, IconBriefcase, IconChart } from '../Icons.jsx';
import RecommendationList from './RecommendationList.jsx';
import InterviewNotes from './InterviewNotes.jsx';
import ExperimentsPanel from './ExperimentsPanel.jsx';
import { api } from '../../api.js';

const DECISION_MESSAGE = {
  accept: 'Added to your plan.',
  complete: 'Marked as done.',
  snooze: 'It’ll come back in a week.',
  dismiss: 'Dismissed. It won’t be suggested again.',
  incorrect: 'Thanks. It won’t be suggested again.',
  reopen: 'Back in your plan.',
};
const PRIORITY_NAME = { high: 'High priority', medium: 'Medium', low: 'Low' };

function confirmation(action, priority) {
  if (action !== 'prioritize') return DECISION_MESSAGE[action];
  return priority ? `Moved to ${PRIORITY_NAME[priority]}.` : 'Back to the suggested priority.';
}

// Loads one part of the plan. Each part fails on its own, so one error doesn't hide the rest.
// Only the latest request counts: a slower, older response must not overwrite a newer one.
function useResource(fetcher) {
  const [resource, setResource] = useState({ state: 'loading', data: null });
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const data = await fetcher();
      if (request === latest.current) setResource({ state: 'ready', data });
    } catch {
      if (request === latest.current) setResource((r) => ({ ...r, state: 'error' }));
    }
  }, [fetcher]);
  return [resource, load];
}

function PlanCard({ icon, title, intro, resource, what, onRetry, children }) {
  return (
    <section className="dna-section-card">
      <div className="dna-section-header">
        <div>
          <h2 className="dna-section-title">{icon} {title}</h2>
          <p className="muted text-sm">{intro}</p>
        </div>
      </div>
      {resource.state === 'loading' && !resource.data && <div className="dna-empty-box">Loading {what}…</div>}
      {resource.state === 'error' && !resource.data && (
        <div className="dna-empty-box" role="alert">
          Couldn’t load {what}. <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Try again</button>
        </div>
      )}
      {resource.data && children(resource.data)}
    </section>
  );
}

export default function ActionPlanSection({ notify, confirm, active, refreshKey, onEditProfile, onOpenJobFit }) {
  const [recs, loadRecs] = useResource(api.getRecommendations);
  const [interviews, loadInterviews] = useResource(api.getInterviews);
  const [experiments, loadExperiments] = useResource(api.getExperiments);
  const [busyId, setBusyId] = useState(null);
  const [suggestingId, setSuggestingId] = useState(null);

  // Reloaded whenever the tab is opened, since saving jobs or editing the profile changes the plan.
  useEffect(() => {
    if (!active) return;
    loadRecs();
    loadInterviews();
    loadExperiments();
  }, [active, refreshKey, loadRecs, loadInterviews, loadExperiments]);

  const decide = async (rec, action, extra = {}) => {
    setBusyId(rec._id);
    try {
      await api.updateRecommendation(rec._id, { action, ...extra });
      await loadRecs();
      notify?.(confirmation(action, extra.priority), 'success');
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t update your plan' });
    } finally {
      setBusyId(null);
    }
  };

  const shortcutFor = (rec) => {
    if (rec.kind === 'add_jobs') {
      return <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenJobFit}>Open Job fit</button>;
    }
    if (['set_goal', 'show_evidence', 'close_gap'].includes(rec.kind)) {
      return <button type="button" className="btn btn-secondary btn-sm" onClick={onEditProfile}>Edit profile</button>;
    }
    return null;
  };

  // Throws on failure so the dialog stays open with what the user typed.
  const saveNotes = async (applicationId, notes) => {
    try {
      await api.saveInterviewNotes(applicationId, notes);
      notify?.(notes.practiceAreas.length ? 'Notes saved. Practice areas were added to your plan.' : 'Notes saved.', 'success');
      await Promise.all([loadInterviews(), loadRecs()]);
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t save your notes' });
      throw err;
    }
  };

  const suggestPractice = async (reflection) => {
    setSuggestingId(reflection._id);
    try {
      const updated = await api.suggestPractice(reflection._id);
      const count = updated.insights?.learningNeeds?.length ?? 0;
      notify?.(count ? `${count} suggestion${count === 1 ? '' : 's'} added below your notes.` : 'Nothing specific stood out in these notes.', 'success');
      await loadInterviews();
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t get suggestions' });
    } finally {
      setSuggestingId(null);
    }
  };

  const addPractice = (reflection, area) =>
    saveNotes(reflection.applicationId, {
      topics: reflection.topics,
      difficultQuestions: reflection.difficultQuestions,
      feedback: reflection.feedback,
      practiceAreas: [...reflection.practiceAreas, area],
    }).catch(() => {});

  const deleteNotes = async (reflection) => {
    const ok = await confirm?.({ title: 'Delete these notes?', message: `Your notes for ${reflection.company} will be removed.`, confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await api.deleteInterviewNotes(reflection._id);
      await Promise.all([loadInterviews(), loadRecs()]);
    } catch (err) {
      notify?.(err.message, 'error');
    }
  };

  const createExperiment = async (body) => {
    try {
      await api.createExperiment(body);
      notify?.('Experiment started.', 'success');
      await loadExperiments();
    } catch (err) {
      notify?.(err.message, 'error', { title: 'Couldn’t start the experiment' });
      throw err;
    }
  };

  const updateExperiment = async (experiment, body) => {
    try {
      await api.updateExperiment(experiment._id, body);
      if (body.action === 'finish') notify?.('Finished. The result is saved as it stands today.', 'success');
      await loadExperiments();
    } catch (err) {
      notify?.(err.message, 'error');
    }
  };

  const deleteExperiment = async (experiment) => {
    const ok = await confirm?.({ title: 'Delete this experiment?', message: 'Its result will be removed too.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await api.deleteExperiment(experiment._id);
      await loadExperiments();
    } catch (err) {
      notify?.(err.message, 'error');
    }
  };

  return (
    <div className="action-plan">
      <PlanCard
        icon={<IconCheck size={18} />}
        title="Your next steps"
        intro="Worked out from your saved jobs, profile evidence, upcoming interviews and your own notes. Open “Why am I seeing this?” on any step to check the reasoning."
        resource={recs}
        what="your plan"
        onRetry={loadRecs}
      >
        {(data) => <RecommendationList data={data} busyId={busyId} onAction={decide} shortcutFor={shortcutFor} />}
      </PlanCard>

      <PlanCard
        icon={<IconBriefcase size={18} />}
        title="Interview notes"
        intro="After an interview, note what came up and what the interviewer said. Only the areas you choose to practise turn into tasks; a rejection is never read as anything."
        resource={interviews}
        what="your interview notes"
        onRetry={loadInterviews}
      >
        {(data) => (
          <InterviewNotes
            data={data}
            suggestingId={suggestingId}
            onSave={saveNotes}
            onDelete={deleteNotes}
            onSuggest={suggestPractice}
            onAddPractice={addPractice}
          />
        )}
      </PlanCard>

      <PlanCard
        icon={<IconChart size={18} />}
        title="Experiments"
        intro="Try one change to how you apply and compare it with your own numbers. Small samples and uncontrolled comparisons are called out, never dressed up as proof."
        resource={experiments}
        what="your experiments"
        onRetry={loadExperiments}
      >
        {(data) => <ExperimentsPanel experiments={data} onCreate={createExperiment} onUpdate={updateExperiment} onDelete={deleteExperiment} />}
      </PlanCard>
    </div>
  );
}
