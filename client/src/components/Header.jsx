import { timeAgo } from '../constants.js';
import { IconSync, IconPlus, IconMail } from './Icons.jsx';
import AccountMenu from './AccountMenu.jsx';

export default function Header({
  status,
  syncing,
  lastSyncAt,
  onSync,
  onAdd,
  onConnect,
  onSwitch,
  onSignOut,
  onDisconnect,
}) {
  return (
    <header className="topbar">
      <div className="title-block">
        <h1>CareerPulse – Job Tracker</h1>
        <p>Your applications, auto-updated from Gmail by AI</p>
      </div>

      <div className="topbar-actions">
        <AccountMenu status={status} onSwitch={onSwitch} onSignOut={onSignOut} onDisconnect={onDisconnect} />
        {status.connected ? (
          <div className="sync-control">
            <button className="btn btn-secondary" onClick={onSync} disabled={syncing}>
              {syncing ? <span className="spinner" /> : <IconSync size={16} />}
              {syncing ? 'Syncing…' : 'Sync Gmail'}
            </button>
            <span className="last-sync" title={lastSyncAt ? new Date(lastSyncAt).toLocaleString('en-IN') : undefined}>
              {lastSyncAt ? `Synced ${timeAgo(lastSyncAt)}` : 'Never synced'}
            </span>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={onConnect}>
            <IconMail size={16} /> Reconnect Gmail
          </button>
        )}
        <button className="btn btn-primary" onClick={onAdd}>
          <IconPlus size={16} /> Add Application
        </button>
      </div>
    </header>
  );
}
