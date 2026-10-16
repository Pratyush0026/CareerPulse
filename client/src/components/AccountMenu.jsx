import { useEffect, useRef, useState } from 'react';
import { IconChevron } from './Icons.jsx';

export default function AccountMenu({ status, onSwitch, onSignOut, onDisconnect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (fn) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="account" ref={ref}>
      <button className="account-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <span className="account-avatar">{(status.email || '?').charAt(0).toUpperCase()}</span>
        <span className="account-email">{status.email}</span>
        <span className={`dot ${status.connected ? 'dot-on' : 'dot-off'}`} title={status.connected ? 'Gmail connected' : 'Gmail not connected'} />
        <IconChevron size={16} className={`chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">
            Signed in as
            <strong>{status.email}</strong>
            <span className={status.connected ? 'ok' : 'warn'}>{status.connected ? 'Gmail connected' : 'Gmail needs reconnecting'}</span>
          </div>
          <button role="menuitem" onClick={choose(onSwitch)}>Switch Gmail account</button>
          <button role="menuitem" onClick={choose(onSignOut)}>Sign out</button>
          <button role="menuitem" className="danger" onClick={choose(onDisconnect)}>Disconnect Gmail &amp; sign out</button>
        </div>
      )}
    </div>
  );
}
