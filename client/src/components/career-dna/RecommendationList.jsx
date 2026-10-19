import { useId, useState } from 'react';
import { formatDate } from '../../constants.js';

const PRIORITY = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
const EFFORT = { small: 'Quick', medium: 'A few hours', large: 'Longer' };
const DECIDED = { dismissed: 'Dismissed', incorrect: 'Reported as wrong', outdated: 'No longer applies', snoozed: 'Snoozed' };

// The calculated priority, unless the user picked one. "Auto" hands it back to CareerPulse.
function PrioritySelect({ rec, busy, onAction }) {
  const change = (e) => onAction(rec, 'prioritize', { priority: e.target.value === 'auto' ? null : e.target.value });
  return (
    <select
      className={`priority-select rec-priority-${rec.priority}`}
      aria-label={`Priority for: ${rec.title}`}
      value={rec.userPriority ?? 'auto'}
      disabled={busy}
      onChange={change}
    >
      <option value="auto">{PRIORITY[rec.suggestedPriority]} (auto)</option>
      {Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
  );
}

function RecommendationCard({ rec, busy, onAction, shortcut }) {
  const accepted = rec.status === 'accepted';
  const act = (action) => () => onAction(rec, action);

  return (
    <li className={`rec-card priority-${rec.priority} ${accepted ? 'is-accepted' : ''}`}>
      <div className="rec-meta">
        <PrioritySelect rec={rec} busy={busy} onAction={onAction} />
        <span className="dna-pill">{EFFORT[rec.effort]}</span>
        {accepted && <span className="dna-pill pill-success">In progress</span>}
        {rec.targetRole && <span className="muted text-xs">For: {rec.targetRole}</span>}
      </div>

      <h3 className="rec-title">{rec.title}</h3>
      <p className="rec-why">{rec.why}</p>

      {rec.reasonResolved && (
        <div className="alert alert-success" role="status">
          This no longer applies – what prompted it has changed. Mark it done if you’re finished with it.
        </div>
      )}

      <details className="rec-details">
        <summary>Why am I seeing this?</summary>
        <ul>
          {rec.evidence.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
        {rec.uncertainty && <p className="text-sm muted">{rec.uncertainty}</p>}
        <p className="text-sm"><strong>Done when:</strong> {rec.completionCondition}</p>
      </details>

      <div className="rec-actions">
        {shortcut}
        {accepted ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={act('complete')}>Mark done</button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={act('accept')}>I’ll do this</button>
        )}
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={act('snooze')}>Remind me in a week</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={act('dismiss')}>{accepted ? 'Drop it' : 'Not for me'}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={act('incorrect')}>This is wrong</button>
      </div>
    </li>
  );
}

function DoneList({ items, busyId, onAction }) {
  if (!items.length) {
    return <div className="dna-empty-box">Nothing marked as done yet. Steps you finish show up here.</div>;
  }
  return (
    <ul className="done-list">
      {items.map((rec) => (
        <li key={rec._id}>
          <span className="done-check" aria-hidden="true">✓</span>
          <div className="done-body">
            <span className="plan-history-title">{rec.title}</span>
            <span className="muted text-xs">
              Done {formatDate(rec.statusChangedAt)}
              {rec.userNote && ` · “${rec.userNote}”`}
            </span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === rec._id} onClick={() => onAction(rec, 'reopen')}>Undo</button>
        </li>
      ))}
    </ul>
  );
}

const PRIORITY_TABS = [
  ['high', 'High priority'],
  ['medium', 'Medium'],
  ['low', 'Low'],
];

/** Active recommendations split by priority, a Done tab, and a collapsible record of other decisions. */
export default function RecommendationList({ data, busyId, onAction, shortcutFor }) {
  const [showHistory, setShowHistory] = useState(false);
  const [chosenTab, setChosenTab] = useState(null);
  const tabsId = useId();
  const { active, done, history } = data;

  const counts = Object.fromEntries(PRIORITY_TABS.map(([key]) => [key, active.filter((r) => r.priority === key).length]));
  counts.done = done.length;
  // High priority first; if it's empty, open the first priority that has something in it.
  const tab = chosenTab ?? PRIORITY_TABS.find(([key]) => counts[key])?.[0] ?? 'high';
  const shown = active.filter((r) => r.priority === tab);

  // Moving a step to another priority keeps this tab open instead of following the step.
  const handleAction = (rec, action, extra) => {
    if (action === 'prioritize') setChosenTab(tab);
    return onAction(rec, action, extra);
  };

  return (
    <>
      {(active.length > 0 || done.length > 0) && (
        <div className="plan-tabs" role="tablist" aria-label="Next steps">
          {[...PRIORITY_TABS, ['done', 'Done']].map(([key, label]) => (
            <button
              key={key}
              id={`${tabsId}-${key}`}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`${tabsId}-panel`}
              className={`plan-tab ${key === 'done' ? 'is-done' : ''} ${tab === key ? 'active' : ''}`}
              onClick={() => setChosenTab(key)}
            >
              {label} <span className="plan-tab-count">{counts[key]}</span>
            </button>
          ))}
        </div>
      )}

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {tab === 'done' ? (
          <DoneList items={done} busyId={busyId} onAction={onAction} />
        ) : shown.length ? (
          <ul className="rec-list">
            {shown.map((rec) => (
              <RecommendationCard key={rec._id} rec={rec} busy={busyId === rec._id} onAction={handleAction} shortcut={shortcutFor(rec)} />
            ))}
          </ul>
        ) : (
          <div className="dna-empty-box">
            {active.length
              ? 'Nothing at this priority right now.'
              : 'Nothing to suggest right now. New suggestions appear as you save jobs, add interview notes or update your profile.'}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="plan-history">
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Hide' : 'Show'} snoozed and dismissed ({history.length})
          </button>
          {showHistory && (
            <ul className="plan-history-list">
              {history.map((rec) => (
                <li key={rec._id}>
                  <div>
                    <span className="plan-history-title">{rec.title}</span>
                    <span className="muted text-xs">
                      {DECIDED[rec.status]}
                      {rec.status === 'snoozed' && rec.snoozedUntil
                        ? ` until ${formatDate(rec.snoozedUntil)}`
                        : rec.statusChangedAt && ` · ${formatDate(rec.statusChangedAt)}`}
                      {rec.userNote && ` · “${rec.userNote}”`}
                    </span>
                  </div>
                  {rec.status !== 'outdated' && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === rec._id} onClick={() => onAction(rec, 'reopen')}>Undo</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
