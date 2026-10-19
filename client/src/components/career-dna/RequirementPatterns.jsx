import EvidenceLevelBadge from './EvidenceLevelBadge.jsx';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function RequirementPatterns({ data }) {
  if (!data) return null;
  const { jobCount, minJobs, patterns } = data;

  return (
    <section className="dna-section-card" aria-labelledby="patterns-title">
      <div className="dna-section-header">
        <div>
          <h2 id="patterns-title" className="dna-section-title">What your saved jobs keep asking for</h2>
          <p className="muted text-sm">Skills that appear in at least two of your saved job descriptions, next to how well your profile backs them up.</p>
        </div>
      </div>

      {jobCount < minJobs ? (
        <div className="dna-empty-box">
          Save at least {minJobs} job descriptions to see patterns – you have {jobCount}. With fewer, a “pattern” is just one job’s wording.
        </div>
      ) : !patterns.length ? (
        <div className="dna-empty-box">No skill appears in more than one of your {jobCount} saved jobs yet.</div>
      ) : (
        <ul className="pattern-list">
          {patterns.slice(0, 12).map((p) => (
            <li key={p.skill} className="pattern-row">
              <div>
                <strong>{p.skill}</strong>
                <span className="muted text-sm">
                  {' '}– in {p.mentionedIn} of {plural(jobCount, 'saved job')}
                  {p.requiredIn ? `, required in ${p.requiredIn}` : ', always as nice to have'}
                </span>
              </div>
              <EvidenceLevelBadge level={p.level} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
