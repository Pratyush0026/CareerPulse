import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { STAGES, timeAgo } from '../constants.js';

const LIMIT = 100;

const FILTERS = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'job', label: 'Job updates', test: (item) => item.isJobRelated },
  { value: 'ignored', label: 'Not job-related', test: (item) => !item.isJobRelated && item.method !== 'rule' },
  { value: 'rule', label: 'Skipped by rules', test: (item) => item.method === 'rule' },
];

const stageColor = (stage) => STAGES.find((s) => s.id === stage)?.color || 'var(--muted)';

function ActivityTitle({ item }) {
  if (item.isJobRelated) {
    if (!item.company) return <strong>Job email (not linked to a card)</strong>;
    return (
      <>
        <strong>{item.company}</strong>
        {item.role ? ` · ${item.role}` : ''}
      </>
    );
  }
  return <span className="muted">{item.method === 'rule' ? `Skipped: ${item.skipReason}` : 'Not job-related'}</span>;
}

export default function ActivityPage({ refreshKey }) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    api
      .activity(LIMIT)
      .then((data) => {
        if (cancelled) return;
        setItems(data);
        setState('ready');
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, items.filter(f.test).length])), [items]);
  const visible = useMemo(() => items.filter(FILTERS.find((f) => f.value === filter).test), [items, filter]);

  return (
    <>
      <div className="page-head">
        <h2>AI activity</h2>
        <p>
          The last {LIMIT} emails CareerPulse looked at. Results below 60% confidence don’t change your board.
          Email content is never stored.
        </p>
      </div>

      <section className="panel">
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={filter === f.value}
              className={`tab ${filter === f.value ? 'active' : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              <span className="tab-count">{counts[f.value]}</span>
            </button>
          ))}
        </div>

        {state === 'loading' && <div className="empty">Loading activity…</div>}
        {state === 'error' && <div className="empty">Couldn’t load activity. Refresh to try again.</div>}
        {state === 'ready' && !visible.length && (
          <div className="empty">{items.length ? 'Nothing in this category.' : 'No emails processed yet. Click “Sync Gmail” to start.'}</div>
        )}

        {state === 'ready' && visible.length > 0 && (
          <ul className="activity">
            {visible.map((item) => (
              <li key={item.id}>
                <span
                  className="activity-dot"
                  style={{ background: item.isJobRelated ? stageColor(item.stageDetected) : 'var(--border-strong)' }}
                />
                <div className="activity-main">
                  <div className="activity-title"><ActivityTitle item={item} /></div>
                  <div className="activity-meta">{timeAgo(item.processedAt)}</div>
                </div>
                {item.stageDetected && (
                  <span className="stage-badge" style={{ '--stage-color': stageColor(item.stageDetected) }}>{item.stageDetected}</span>
                )}
                {item.method === 'rule' ? (
                  <span className="confidence rule" title="Skipped without AI">rule</span>
                ) : (
                  <span className={`confidence ${item.confidence < 0.6 ? 'low' : ''}`} title="AI confidence">
                    {Math.round(item.confidence * 100)}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
