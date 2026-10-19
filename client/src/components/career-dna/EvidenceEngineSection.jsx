import { useMemo, useState } from 'react';
import { IconSearch, IconSync } from '../Icons.jsx';
import EvidenceLevelBadge from './EvidenceLevelBadge.jsx';

const LEVELS = [
  { key: 'ALL', label: 'All skills', match: () => true },
  { key: 'ASSESSED', label: 'Assessment-validated', level: 'Assessment-validated', tone: 'text-indigo' },
  { key: 'SUPPORTED', label: 'Shown in a project or role', level: 'Supported by a project or experience', tone: 'text-indigo' },
  { key: 'CONFIRMED', label: 'Confirmed by you', level: 'User-confirmed', tone: 'text-emerald' },
  { key: 'MENTIONED', label: 'Only on your resume', level: 'Mentioned', tone: 'text-amber' },
  { key: 'NEEDS', label: 'Needs evidence', level: 'Needs more evidence', tone: 'text-rose' },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function EvidenceEngineSection({ evidenceOverview = [], error, onRetry, onInspectSkill, onRebuildEvidence, isRebuilding }) {
  const [selected, setSelected] = useState('ALL');
  const [query, setQuery] = useState('');

  const counts = useMemo(
    () => Object.fromEntries(LEVELS.map((l) => [l.key, l.key === 'ALL' ? evidenceOverview.length : evidenceOverview.filter((s) => s.level === l.level).length])),
    [evidenceOverview]
  );

  const visible = useMemo(() => {
    const level = LEVELS.find((l) => l.key === selected);
    const q = query.trim().toLowerCase();
    return evidenceOverview.filter(
      (s) => (selected === 'ALL' || s.level === level.level) && (!q || s.skill.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q))
    );
  }, [evidenceOverview, selected, query]);

  // Hide empty levels (except "All") so the filter row stays short.
  const tabs = LEVELS.filter((l) => l.key === 'ALL' || counts[l.key] > 0 || l.key === selected);

  return (
    <section className="dna-section-card evidence-engine-card" aria-labelledby="evidence-title">
      <div className="dna-section-header">
        <div>
          <h2 id="evidence-title" className="dna-section-title">Skills & evidence</h2>
          <p className="muted text-sm">
            Why Career DNA believes each skill: where it appears on your profile, and whether you confirmed it.
            A skill without evidence isn’t a skill you lack – it just isn’t documented yet.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRebuildEvidence} disabled={isRebuilding}>
          <IconSync size={13} /> {isRebuilding ? 'Rebuilding…' : 'Rebuild from profile'}
        </button>
      </div>

      {error ? (
        <div className="dna-empty-box" role="alert">
          Couldn’t load your evidence. <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Try again</button>
        </div>
      ) : !evidenceOverview.length ? (
        <div className="dna-empty-box">No evidence yet. Add skills, roles or projects to your profile and it will appear here.</div>
      ) : (
        <>
          <div className="evidence-controls-bar">
            <label className="evidence-search-box">
              <IconSearch size={15} />
              <input type="search" aria-label="Search skills" placeholder="Search skills…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="evidence-filter-tabs" role="group" aria-label="Filter by evidence level">
              {tabs.map((l) => (
                <button key={l.key} type="button" aria-pressed={selected === l.key} className={`evidence-tab ${selected === l.key ? 'active' : ''}`} onClick={() => setSelected(l.key)}>
                  {l.label} ({counts[l.key]})
                </button>
              ))}
            </div>
          </div>

          {!visible.length ? (
            <div className="dna-empty-box">No skills match this filter.</div>
          ) : (
            <div className="evidence-skills-grid">
              {visible.map((item) => {
                const b = item.sourcesBreakdown ?? {};
                return (
                  <article key={item.skill} className="evidence-skill-card">
                    <div className="evidence-card-top">
                      <div className="evidence-card-title-group">
                        <h3 className="evidence-skill-title">{item.skill}</h3>
                        <span className="dna-pill category-pill">{item.category}</span>
                      </div>
                      <EvidenceLevelBadge level={item.level} size="sm" />
                    </div>
                    <p className="evidence-provenance-text">{item.summary}</p>
                    <div className="evidence-card-footer">
                      <div className="evidence-proof-counts">
                        {b.projects > 0 && <span className="proof-pill">{plural(b.projects, 'project')}</span>}
                        {b.experience > 0 && <span className="proof-pill">{plural(b.experience, 'role')}</span>}
                        {b.resume > 0 && <span className="proof-pill">Resume</span>}
                        {b.rejected > 0 && <span className="proof-pill muted">{b.rejected} marked wrong</span>}
                      </div>
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => onInspectSkill(item)}>
                        Why this level?
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
