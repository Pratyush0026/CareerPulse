import { IconMail, IconClose } from './Icons.jsx';

export default function SyncBanner({ summary, onClose, onSyncAgain, syncing }) {
  if (!summary) return null;
  const changed = summary.created + summary.updated;
  const stopped = Boolean(summary.stoppedReason);
  const waiting = summary.remaining || 0;
  const aiClassified = (summary.processed || 0) - (summary.skippedByRules || 0);

  return (
    <div className={`sync-banner ${stopped || waiting ? 'sync-banner-warn' : ''}`}>
      <div className="sync-banner-icon"><IconMail size={18} /></div>
      <span className="live-tag">{stopped ? 'Partial sync' : waiting ? 'More to sync' : 'Sync complete'}</span>
      <div className="sync-banner-text">
        <strong>
          {changed ? `${changed} application${changed === 1 ? '' : 's'} updated automatically` : 'No new application updates'}
        </strong>{' '}
        from your Gmail
        <span className="sync-banner-meta">
          {summary.processed ?? summary.emailsFetched} emails checked ({summary.skippedByRules || 0} job alerts skipped, {aiClassified} read by AI)
          {' · '}{summary.jobRelatedFound} job-related · {summary.created} new · {summary.updated} updated
          {summary.errors ? ` · ${summary.errors} errors (retried next sync)` : ''} · synced at{' '}
          {summary.at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </span>
        {(stopped || waiting > 0) && (
          <span className="sync-banner-warning">
            {waiting} older email{waiting === 1 ? '' : 's'} from the last 30 days still waiting.{' '}
            {stopped ? summary.stoppedReason : 'Click “Sync again” to continue.'}
          </span>
        )}
      </div>
      {waiting > 0 && !stopped && (
        <button className="btn btn-primary btn-sm" onClick={onSyncAgain} disabled={syncing}>Sync again</button>
      )}
      <button className="icon-btn" onClick={onClose} aria-label="Dismiss"><IconClose size={16} /></button>
    </div>
  );
}
