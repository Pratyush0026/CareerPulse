import { NavLink } from 'react-router-dom';
import { IconDashboard, IconChart, IconBot, IconMail } from './Icons.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', Icon: IconDashboard },
  { to: '/insights', label: 'Insights', Icon: IconChart },
  { to: '/activity', label: 'AI Activity', Icon: IconBot },
];

export default function Sidebar({ status }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo" aria-hidden>
          <svg viewBox="0 0 32 32" width="22" height="22"><path d="M5 17h5l3-7 5 13 3-6h6" fill="none" stroke="#5eead4" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div>
          <div className="brand-name">CareerPulse</div>
          <div className="brand-sub">Job Tracker</div>
        </div>
      </div>

      <div className="nav-label">Workspace</div>
      <nav className="nav">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Icon size={17} /> {label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="gmail-card">
          <IconMail size={16} />
          <div>
            <div className="gmail-card-title">Gmail</div>
            <div className="gmail-card-sub">
              {status?.connected ? status.email : status?.needsReconnect ? 'Reconnect needed' : 'Not connected'}
            </div>
          </div>
          <span className={`dot ${status?.connected ? 'dot-on' : 'dot-off'}`} />
        </div>
        <div className="privacy-note">Read-only access · email content is never stored</div>
      </div>
    </aside>
  );
}
