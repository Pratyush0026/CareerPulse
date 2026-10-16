import { useEffect } from 'react';
import { IconClose } from './Icons.jsx';

export default function ConfirmDialog({ dialog, onClose }) {
  // Enter is left to the browser so it presses whichever button has focus.
  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, onClose]);

  if (!dialog) return null;
  const { title, message, details, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', icon } = dialog;

  return (
    <div className="modal-backdrop" onMouseDown={() => onClose(false)}>
      <div className="modal dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="dialog-heading">
            {icon && <span className={`dialog-icon dialog-icon-${tone}`}>{icon}</span>}
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={() => onClose(false)} aria-label="Close"><IconClose size={18} /></button>
        </div>

        {message && <p className="dialog-message">{message}</p>}

        {details?.length > 0 && (
          <ul className="dialog-details">
            {details.map((d) => (
              <li key={d.text} className={d.ok === false ? 'no' : 'yes'}>
                <span aria-hidden>{d.ok === false ? '✕' : '✓'}</span> {d.text}
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onClose(false)}>{cancelLabel}</button>
          <button type="button" autoFocus className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={() => onClose(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
