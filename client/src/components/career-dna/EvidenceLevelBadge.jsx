const LEVELS = {
  'Assessment-validated': { className: 'badge-evidence-assessment', label: 'Assessment-validated' },
  'Supported by a project or experience': { className: 'badge-evidence-supported', label: 'Shown in a project or role' },
  'User-confirmed': { className: 'badge-evidence-confirmed', label: 'Confirmed by you' },
  Mentioned: { className: 'badge-evidence-mentioned', label: 'Only on your resume' },
  'Needs more evidence': { className: 'badge-evidence-needed', label: 'Needs evidence' },
};

export default function EvidenceLevelBadge({ level, size = 'md' }) {
  const { className, label } = LEVELS[level] ?? LEVELS['Needs more evidence'];
  return (
    <span className={`evidence-level-badge ${className} size-${size}`} title={level}>
      <span className="evidence-badge-dot" aria-hidden="true" />
      <span className="evidence-badge-text">{label}</span>
    </span>
  );
}
