import { useRef, useState } from 'react';
import { IconUpload, IconSparkles } from '../Icons.jsx';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function PrivacyNote({ compact }) {
  return (
    <p className={`dna-privacy-guarantee ${compact ? 'compact' : ''}`}>
      <span className="dot dot-on" aria-hidden />
      <span>
        The text of your resume is sent to Google Gemini to read it. The file itself is never saved – only the details
        you review and save are stored in your account, and you can delete them at any time.
      </span>
    </p>
  );
}

export default function ResumeUploadDropzone({ onUpload, onManualCreate, isUploading, compact = false }) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const take = (file) => {
    setError('');
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.pdf' && ext !== '.docx') return setError('Please upload a PDF or DOCX file.');
    if (file.size > MAX_FILE_SIZE) return setError('That file is over 5 MB. Please upload a smaller PDF or DOCX.');
    onUpload(file);
  };

  const pick = () => !isUploading && inputRef.current?.click();

  const dropzone = (
    <div
      className={`dna-dropzone ${compact ? 'compact' : ''} ${dragOver ? 'drag-over' : ''} ${isUploading ? 'is-uploading' : ''}`}
      role="button"
      tabIndex={isUploading ? -1 : 0}
      aria-disabled={isUploading}
      aria-label="Upload your resume (PDF or DOCX, up to 5 MB)"
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!isUploading) take(e.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="dna-dropzone-icon"><IconUpload size={compact ? 24 : 28} /></div>
      {isUploading ? (
        <div className="dna-upload-progress" aria-live="polite">
          <div className="dna-spinner" />
          <div className="dna-upload-text">Reading your resume…</div>
          <div className="dna-upload-sub">Usually 10–20 seconds. Nothing is saved until you review it.</div>
        </div>
      ) : (
        <div className="dna-dropzone-content">
          <div className="dna-dropzone-title"><strong>Choose a file</strong> or drop your resume here</div>
          <div className="dna-dropzone-sub">PDF or DOCX, up to 5 MB. Scanned images can’t be read.</div>
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="dna-compact-upload">
        {dropzone}
        {error && <div className="dna-error-box" role="alert">{error}</div>}
        <PrivacyNote compact />
      </div>
    );
  }

  return (
    <div className="career-dna-onboarding">
      <div className="dna-hero-card">
        <div className="dna-hero-badge"><IconSparkles size={14} /> Career DNA</div>
        <h2 className="dna-hero-title">Your resume tells us where you've been.</h2>
        <h2 className="dna-hero-title accent-text">Career DNA helps you decide where to go next.</h2>
        <p className="dna-hero-desc">
          Turn your resume into a profile you can check and correct. Career DNA then shows which skills your experience
          actually backs up, and how well you match the jobs you’re looking at.
        </p>
        {dropzone}
        {error && <div className="dna-error-box" role="alert">{error}</div>}
        <div className="dna-onboarding-actions">
          <span className="dna-or-divider">or</span>
          <button type="button" className="btn btn-secondary" onClick={onManualCreate} disabled={isUploading}>
            Build my profile by hand
          </button>
        </div>
        <PrivacyNote />
        <p className="muted text-sm dna-onboarding-hint">
          You don’t need Career DNA to use the rest of CareerPulse. Job fit checks work best once your skills and roles are filled in.
        </p>
      </div>
    </div>
  );
}
