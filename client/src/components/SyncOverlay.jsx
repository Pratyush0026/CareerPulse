const STEPS = [
  { phase: 'searching', label: 'Search' },
  { phase: 'downloading', label: 'Read' },
  { phase: 'classifying', label: 'Classify' },
];

const RING_SIZE = 168;
const STROKE = 10;
const RADIUS = (RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function describe({ phase, done, total }) {
  if (phase === 'downloading') return { title: 'Reading your job emails', detail: total ? `${done} of ${total} emails` : null };
  if (phase === 'classifying') return { title: 'AI is sorting your updates', detail: total ? `${done} of ${total} emails` : null };
  return { title: 'Looking for new job emails', detail: 'Checking Gmail' };
}

export default function SyncOverlay({ job }) {
  if (job?.status !== 'running') return null;

  const percent = Math.min(job.percent ?? 0, 99);
  const { title, detail } = describe(job);
  const activeIndex = STEPS.findIndex((s) => s.phase === job.phase);

  return (
    <div className="sync-overlay" role="dialog" aria-modal="true" aria-labelledby="sync-overlay-title">
      <div className="sync-overlay-card">
        <div
          className="sync-ring"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{ width: RING_SIZE, height: RING_SIZE }}
        >
          <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
            <defs>
              <linearGradient id="sync-ring-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#5eead4" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            <circle className="sync-ring-track" cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RADIUS} strokeWidth={STROKE} />
            <circle
              className="sync-ring-bar"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              stroke="url(#sync-ring-gradient)"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
            />
          </svg>
          <div className="sync-ring-center">
            <div className="sync-logo">
              <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden>
                <path className="sync-logo-pulse" d="M5 17h5l3-7 5 13 3-6h6" pathLength="100" />
              </svg>
            </div>
            <div className="sync-percent" aria-live="polite">
              {percent}
              <span>%</span>
            </div>
          </div>
        </div>

        <h2 id="sync-overlay-title">{title}</h2>
        {detail && <p className="sync-detail">{detail}</p>}

        <ol className="sync-steps">
          {STEPS.map((step, i) => (
            <li key={step.phase} className={i < activeIndex ? 'done' : i === activeIndex ? 'active' : ''}>
              <span className="sync-step-dot" />
              {step.label}
            </li>
          ))}
        </ol>

        <p className="sync-hint">Your board will update when this finishes. You can leave this tab open.</p>
      </div>
    </div>
  );
}
