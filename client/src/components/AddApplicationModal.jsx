import { useEffect, useState } from 'react';
import { STAGES, PLATFORMS } from '../constants.js';
import { IconClose } from './Icons.jsx';

const EMPTY = { company: '', role: '', stage: 'Applied', platform: 'unknown' };

export default function AddApplicationModal({ open, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(EMPTY);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.company.trim()) return;
    setSaving(true);
    try {
      await onSave({ ...form, company: form.company.trim(), role: form.role.trim() || null });
      onClose();
    } catch {
      // The error toast is already shown; keeping the modal open preserves what was typed.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <h2>Add application</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><IconClose size={18} /></button>
        </div>

        <label>
          Company *
          <input autoFocus required value={form.company} onChange={set('company')} placeholder="e.g. Swiggy" />
        </label>
        <label>
          Role
          <input value={form.role} onChange={set('role')} placeholder="e.g. Product Associate" />
        </label>
        <div className="form-row">
          <label>
            Stage
            <select value={form.stage} onChange={set('stage')}>
              {STAGES.map((s) => <option key={s.id}>{s.id}</option>)}
            </select>
          </label>
          <label>
            Platform
            <select value={form.platform} onChange={set('platform')}>
              {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !form.company.trim()}>
            {saving ? 'Saving…' : 'Add application'}
          </button>
        </div>
      </form>
    </div>
  );
}
