import { useEffect } from 'react';
import { IconClose } from './Icons.jsx';

const ICONS = {
  success: <path d="m5 12 5 5 9-10" />,
  error: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></>,
  warning: <><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17v.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.5v.5" /></>,
};

// Toasts with an action (like Undo) stay up a little longer.
const DURATION = { success: 4000, info: 4500, warning: 7000, error: 8000 };

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const ms = (DURATION[toast.type] || 4500) + (toast.action ? 2000 : 0);
    const timer = setTimeout(() => onDismiss(toast.id), ms);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div className={`toast toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
      <span className="toast-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[toast.type] || ICONS.info}
        </svg>
      </span>
      <div className="toast-body">
        {toast.title && <div className="toast-title">{toast.title}</div>}
        <div className="toast-message">{toast.message}</div>
      </div>
      {toast.action && (
        <button
          className="toast-action"
          onClick={() => {
            toast.action.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        <IconClose size={14} />
      </button>
    </div>
  );
}

export default function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}
