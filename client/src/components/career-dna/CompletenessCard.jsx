import { IconCheck } from '../Icons.jsx';

export default function CompletenessCard({ completeness, openQuestions = [], onEditSection }) {
  if (!completeness) return null;
  const { score = 0, breakdown = {}, missing = [] } = completeness;

  return (
    <div className="dna-completeness-card">
      <div className="dna-completeness-header">
        <div className="dna-completeness-circle-wrap">
          <div className="dna-completeness-num">{score}%</div>
          <div className="dna-completeness-label">Completeness</div>
        </div>
        <div className="dna-completeness-info">
          <div className="dna-completeness-title">
            Profile Completeness
            
          </div>
          <p className="dna-completeness-desc">
            How much of your profile is filled in – not a measure of how employable you are. More detail makes job fit checks more specific.
          </p>

          <div className="dna-progress-bar-bg">
            <div className="dna-progress-bar-fill" style={{ width: `${score}%` }} />
          </div>
        </div>
      </div>

      <div className="dna-breakdown-grid">
        <div className="dna-breakdown-item">
          <span className="dna-breakdown-label">Identity</span>
          <span className="dna-breakdown-val">{breakdown.identity ?? 0} / 20</span>
        </div>
        <div className="dna-breakdown-item">
          <span className="dna-breakdown-label">Experience</span>
          <span className="dna-breakdown-val">{breakdown.experience ?? 0} / 25</span>
        </div>
        <div className="dna-breakdown-item">
          <span className="dna-breakdown-label">Skills</span>
          <span className="dna-breakdown-val">{breakdown.skills ?? 0} / 25</span>
        </div>
        <div className="dna-breakdown-item">
          <span className="dna-breakdown-label">Goals</span>
          <span className="dna-breakdown-val">{breakdown.goals ?? 0} / 20</span>
        </div>
        <div className="dna-breakdown-item">
          <span className="dna-breakdown-label">Projects</span>
          <span className="dna-breakdown-val">{breakdown.projects ?? 0} / 10</span>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="dna-missing-items">
          <div className="dna-missing-title">Ways to complete your profile:</div>
          <div className="dna-missing-tags">
            {missing.map((item) => (
              <button
                key={item}
                type="button"
                className="dna-missing-tag-btn"
                onClick={() => onEditSection?.(item)}
              >
                + {item}
              </button>
            ))}
          </div>
        </div>
      )}

      {openQuestions.length > 0 && (
        <div className="dna-missing-items">
          <div className="dna-missing-title">Noticed while reading your resume:</div>
          <ul className="dna-open-questions">
            {openQuestions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {missing.length === 0 && (
        <div className="dna-complete-badge">
          <IconCheck size={16} /> All core sections are filled in.
        </div>
      )}
    </div>
  );
}
